/**
 * The renderer's skinning: linear blend skinning mixed with dual quaternion
 * skinning by each vertex's share (docs/ARCHITECTURE.md, "Skinning artefacts"),
 * and the hip fold added to the skinned vertex ("The hip fold").
 *
 * Three skins on the GPU from a texture of bone matrices. This keeps that
 * (it is the linear half, and carries morph targets and bind matrices) and adds
 * a second texture, `DualBones`: each bone's dual quaternion and its share of
 * dual quaternion skinning, computed on the CPU from the same bone rotations as
 * `skinPositionsBlended`, the reference this shader is tested against. The
 * vertex shader blends the vertex's bones' dual quaternions, skins by the
 * result, and mixes it with three's linear result by the vertex's share.
 *
 * The rig's skinned meshes are bound at the identity in the figure's own space,
 * so a dual quaternion built from the rest heads and rotations is the bone's
 * whole skinning transform; a mesh bound any other way is not supported.
 */
import {
  DataTexture,
  FloatType,
  type Material,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  NearestFilter,
  RGBADepthPacking,
  RGBAFormat,
  type SkinnedMesh,
  type Vector3,
  type Vector4,
} from "three";
import {
  DUAL_TEXELS,
  type DualShare,
  dualBoneTexels,
  type SkinPose,
  skinPose,
  skinVertex,
} from "../rig/dual.ts";
import { FOLD_KEYS, HIP_FOLD, hipPose, type SurfaceFold } from "../rig/hipFold.ts";
import type { BoneRotations, RestBones } from "../rig/pose.ts";
import { poseShare } from "../rig/skinShare.ts";

/** The bone texture's uniform, in every patched shader. */
export const DUAL_BONES_UNIFORM = "hkDualBones";
/** The hip fold texture's uniform: a row per vertex the fold moves, two texels per key (the displacement, the normal's change). */
export const FOLD_UNIFORM = "hkFoldTexture";
/** Which texel of the bone texture holds the root's rotation (after every bone's own). */
export const ROOT_UNIFORM = "hkRootTexel";
/** The vertex attribute holding a vertex's row in the fold texture, or -1. */
export const FOLD_SLOT_ATTRIBUTE = "hkFoldSlot";

/** A texture of no fold: one row, all zeros, that no vertex refers to. */
export const noFoldTexture = (): DataTexture => {
  const t = new DataTexture(
    new Float32Array(FOLD_KEYS * 8),
    FOLD_KEYS * 2,
    1,
    RGBAFormat,
    FloatType,
  );
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
};

/**
 * A figure's bones as dual quaternions, shared by the materials that skin by
 * them: `update` writes a pose, and the textures follow on the next frame.
 */
export class DualBones {
  readonly texture: DataTexture;
  readonly data: Float32Array;
  /** How many bones. */
  readonly bones: number;
  /** The hip fold's texture, in a holder the shaders share, so that `setFold` can replace it. */
  readonly fold: { value: DataTexture } = { value: noFoldTexture() };
  /** The table's share per bone (`skinDualShare`); a pose's own shares come from it (`poseShare`). */
  private readonly share: Float32Array;
  /** The pose last written, for the CPU reference (`pose`), with the shares it was written with. */
  private posed: { rest: RestBones; rotations: BoneRotations; share: Float32Array } | null = null;
  private cached: SkinPose | null = null;

  /** `share`: each bone's share of dual quaternion skinning (`skinDualShare`). */
  constructor(bones: number, share: DualShare) {
    this.bones = bones;
    this.share =
      typeof share === "number" ? new Float32Array(bones).fill(share) : Float32Array.from(share);
    // After every bone's texels, one more: the root's rotation, which the fold turns with.
    const texels = bones * DUAL_TEXELS + 1;
    this.data = new Float32Array(texels * 4);
    // Until posed, every bone is the identity motion, so no frame ever skins by zeros.
    for (let b = 0; b < bones; b++) this.data[b * DUAL_TEXELS * 4 + 3] = 1;
    this.data[bones * DUAL_TEXELS * 4 + 3] = 1;
    this.texture = new DataTexture(this.data, texels, 1, RGBAFormat, FloatType);
    // Fetched texel by texel (texelFetch), never filtered.
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  /** Poses the bones: `rotations` over the skeleton `rest`. */
  update(rest: RestBones, rotations: BoneRotations): void {
    // A bone that swings changes its share (the thigh's, so a flexed hip does not bulge).
    const share = poseShare(rest, rotations, this.share);
    dualBoneTexels(rest, rotations, share, this.data, hipPose(rest, rotations));
    const root = rest.parents.indexOf(-1);
    if (root >= 0)
      this.data.set(rotations.subarray(root * 4, root * 4 + 4), this.bones * DUAL_TEXELS * 4);
    this.posed = { rest, rotations, share };
    this.cached = null;
    this.texture.needsUpdate = true;
  }

  /**
   * Sets the hip fold of the surface being drawn (`surfaceFold`), or none: its
   * rows are what the geometry's `FOLD_SLOT_ATTRIBUTE` points into.
   */
  setFold(fold: SurfaceFold | null): void {
    const old = this.fold.value;
    if (!fold || fold.rows === 0) this.fold.value = noFoldTexture();
    else {
      const t = new DataTexture(fold.data, FOLD_KEYS * 2, fold.rows, RGBAFormat, FloatType);
      t.minFilter = NearestFilter;
      t.magFilter = NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      this.fold.value = t;
    }
    old.dispose();
  }

  /** The pose last written, prepared for skinning on the CPU (null before the first). */
  pose(): SkinPose | null {
    if (!this.cached && this.posed)
      this.cached = skinPose(this.posed.rest, this.posed.rotations, this.posed.share);
    return this.cached;
  }

  dispose(): void {
    this.texture.dispose();
    this.fold.value.dispose();
  }
}

/** What a vertex shader patch needs from a three shader object. */
export interface PatchableShader {
  vertexShader: string;
  uniforms: Record<string, { value: unknown }>;
}

/** A GLSL float literal. */
const glFloat = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);

/**
 * GLSL for the blend, mirroring `blend` and `skinVertex` in src/rig/dual.ts:
 * the motion a vertex follows under dual quaternion skinning, its share of the
 * scheme, and the flexion of the thigh bones it holds.
 */
export const DUAL_SKINNING_FUNCTIONS = /* glsl */ `
#ifdef USE_SKINNING
uniform highp sampler2D ${DUAL_BONES_UNIFORM};
vec3 hkQRotate( vec4 q, vec3 v ) {
	return v + 2.0 * cross( q.xyz, cross( q.xyz, v ) + q.w * v );
}
// The rotation q and translation t of the vertex's blended dual quaternion, its share of the scheme, and the mean flexion (degrees) of the thigh bones it holds (-1000 when it holds none).
void hkDualMotion( vec4 index, vec4 weight, out vec4 q, out vec3 t, out float share, out float flexion ) {
	vec4 r = vec4( 0.0 );
	vec4 d = vec4( 0.0 );
	vec4 pivot = vec4( 0.0 );
	bool pivoted = false;
	share = 0.0;
	float held = 0.0;
	float bent = 0.0;
	for ( int k = 0; k < 4; k ++ ) {
		float w = weight[ k ];
		if ( w == 0.0 ) continue;
		int j = int( index[ k ] ) * ${DUAL_TEXELS};
		vec4 bq = texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( j, 0 ), 0 );
		vec4 bd = texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( j + 1, 0 ), 0 );
		vec4 bs = texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( j + 2, 0 ), 0 );
		share += w * bs.x;
		held += w * bs.z;
		bent += w * bs.z * bs.y;
		if ( ! pivoted ) {
			pivot = bq;
			pivoted = true;
		}
		float side = dot( pivot, bq ) < 0.0 ? - w : w;
		r += side * bq;
		d += side * bd;
	}
	float inverse = 1.0 / length( r );
	r *= inverse;
	d *= inverse;
	q = r;
	t = 2.0 * ( r.w * d.xyz - d.w * r.xyz - cross( d.xyz, r.xyz ) );
	share = clamp( share, 0.0, 1.0 );
	flexion = held > 0.0 ? bent / held : - 1000.0;
}
#endif
`;

/**
 * GLSL for the hip fold, mirroring `addFold` in src/rig/hipFold.ts: a vertex's
 * displacement at the flexion it has, from the fold texture's row (its slot),
 * turned with the root.
 */
export const FOLD_FUNCTIONS = /* glsl */ `
#ifdef USE_SKINNING
uniform highp sampler2D ${FOLD_UNIFORM};
uniform int ${ROOT_UNIFORM};
vec3 hkFoldKey( int key, int slot, int part ) {
	return texelFetch( ${FOLD_UNIFORM}, ivec2( key * 2 + part, slot ), 0 ).xyz;
}
// part 0: the vertex's displacement; part 1: what its normal gains.
vec3 hkFoldValue( float slotValue, float flexion, int part ) {
	float t = ( flexion - ${glFloat(HIP_FOLD.from)} ) / ${glFloat(HIP_FOLD.step)};
	if ( ! ( t > 0.0 ) ) return vec3( 0.0 );
	int slot = int( slotValue + 0.5 );
	float i = floor( t );
	vec3 d;
	if ( i >= ${glFloat(FOLD_KEYS)} ) d = hkFoldKey( ${FOLD_KEYS - 1}, slot, part );
	else {
		int key = int( i );
		vec3 to = hkFoldKey( key, slot, part );
		vec3 was = key == 0 ? vec3( 0.0 ) : hkFoldKey( key - 1, slot, part );
		d = mix( was, to, t - i );
	}
	return hkQRotate( texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( ${ROOT_UNIFORM}, 0 ), 0 ), d );
}
vec3 hkFoldDisplacement( float slotValue, float flexion ) {
	return hkFoldValue( slotValue, flexion, 0 );
}
vec3 hkFoldNormal( float slotValue, float flexion ) {
	return hkFoldValue( slotValue, flexion, 1 );
}
#endif
`;

/** The blend of the vertex's position, after three's linear skinning has run; with the fold, the fold after it. */
const position = (fold: boolean): string => /* glsl */ `
#ifdef USE_SKINNING
	vec3 hkRestPosition = transformed;
#endif
#include <skinning_vertex>
#ifdef USE_SKINNING
	#ifndef HK_DUAL_MOTION
		vec4 hkQ;
		vec3 hkT;
		float hkShare;
		float hkFlexion;
		hkDualMotion( skinIndex, skinWeight, hkQ, hkT, hkShare, hkFlexion );
	#endif
	if ( hkShare > 0.0 ) transformed = mix( transformed, hkQRotate( hkQ, hkRestPosition ) + hkT, hkShare );
	${fold ? `if ( ${FOLD_SLOT_ATTRIBUTE} >= 0.0 ) transformed += hkFoldDisplacement( ${FOLD_SLOT_ATTRIBUTE}, hkFlexion );` : ""}
#endif
`;

/** The blend of the vertex's normal; the motion it finds is the position's too. */
const normal = (fold: boolean): string => /* glsl */ `
#ifdef USE_SKINNING
	vec3 hkRestNormal = objectNormal;
	vec4 hkQ;
	vec3 hkT;
	float hkShare;
	float hkFlexion;
	hkDualMotion( skinIndex, skinWeight, hkQ, hkT, hkShare, hkFlexion );
	#define HK_DUAL_MOTION
#endif
#include <skinnormal_vertex>
#ifdef USE_SKINNING
	if ( hkShare > 0.0 ) objectNormal = mix( objectNormal, hkQRotate( hkQ, hkRestNormal ), hkShare );
	${fold ? `if ( ${FOLD_SLOT_ATTRIBUTE} >= 0.0 ) objectNormal = normalize( objectNormal + hkFoldNormal( ${FOLD_SLOT_ATTRIBUTE}, hkFlexion ) );` : ""}
#endif
`;

/**
 * Makes a three vertex shader skin by `bones`: call it from an
 * `onBeforeCompile`. With `fold`, the shader adds the hip fold too, for a
 * geometry that carries `FOLD_SLOT_ATTRIBUTE` (the body's).
 */
export function patchDualSkinning(shader: PatchableShader, bones: DualBones, fold = false): void {
  const needs = ["#include <common>", "#include <skinning_vertex>"];
  for (const chunk of needs)
    if (!shader.vertexShader.includes(chunk))
      throw new Error(`dual skinning: three's ${chunk} chunk moved`);
  shader.uniforms[DUAL_BONES_UNIFORM] = { value: bones.texture };
  if (fold) {
    shader.uniforms[FOLD_UNIFORM] = bones.fold;
    shader.uniforms[ROOT_UNIFORM] = { value: bones.bones * DUAL_TEXELS };
  }
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>\n${DUAL_SKINNING_FUNCTIONS}${fold ? `attribute float ${FOLD_SLOT_ATTRIBUTE};\n${FOLD_FUNCTIONS}` : ""}`,
    )
    .replace("#include <skinnormal_vertex>", normal(fold))
    .replace("#include <skinning_vertex>", position(fold));
}

/** Part of the program's cache key: a shader patched for dual skinning differs from one that is not. */
export const DUAL_SKINNING_KEY = "dual-skinning-3";

/**
 * Makes `material` skin by `bones`, for materials this library does not make
 * (clothing, hair): it follows the body's dual quaternion skinning instead of
 * three's linear skinning alone, so it does not part from the skin at a joint.
 * With `fold`, for a geometry with `FOLD_SLOT_ATTRIBUTE` (the body's), the hip
 * fold too.
 */
export function applyDualSkinning(material: Material, bones: DualBones, fold = false): void {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    patchDualSkinning(shader as unknown as PatchableShader, bones, fold);
  };
  material.customProgramCacheKey = () =>
    `${key.call(material)}|${DUAL_SKINNING_KEY}${fold ? "-fold" : ""}`;
  material.needsUpdate = true;
}

/**
 * The depth materials a skinned mesh casts shadows with: three's own would
 * skin linearly, and a shadow must follow the surface it is cast from (with
 * `fold`, the body's, its fold too).
 */
export function dualShadowMaterials(
  bones: DualBones,
  fold = false,
): {
  depth: MeshDepthMaterial;
  distance: MeshDistanceMaterial;
} {
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  const distance = new MeshDistanceMaterial();
  applyDualSkinning(depth, bones, fold);
  applyDualSkinning(distance, bones, fold);
  return { depth, distance };
}

/**
 * Makes the mesh's own CPU skinning (its bounds and ray picking, which three
 * does with linear skinning alone) follow the dual quaternion pose, as the
 * shader does.
 */
export function followDualSkinning(mesh: SkinnedMesh, bones: DualBones): void {
  const index = new Uint16Array(4);
  const weight = new Float32Array(4);
  const out: [number, number, number] = [0, 0, 0];
  const skin = (vertex: number, target: Vector3 | Vector4): Vector3 | Vector4 => {
    const pose = bones.pose();
    if (!pose) return target;
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    for (let k = 0; k < 4; k++) {
      index[k] = skinIndex.getComponent(vertex, k);
      weight[k] = skinWeight.getComponent(vertex, k);
    }
    skinVertex(pose, index, weight, 0, target.x, target.y, target.z, out);
    target.x = out[0];
    target.y = out[1];
    target.z = out[2];
    return target;
  };
  mesh.applyBoneTransform = skin as SkinnedMesh["applyBoneTransform"];
}
