/**
 * The renderer's skinning: linear blend skinning mixed with dual quaternion
 * skinning by each vertex's share (docs/ARCHITECTURE.md, "Skinning artefacts").
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
import type { BoneRotations, RestBones } from "../rig/pose.ts";

/** The bone texture's uniform, in every patched shader. */
export const DUAL_BONES_UNIFORM = "hkDualBones";

/**
 * A figure's bones as dual quaternions, shared by the materials that skin by
 * them: `update` writes a pose, and the textures follow on the next frame.
 */
export class DualBones {
  readonly texture: DataTexture;
  readonly data: Float32Array;
  private readonly share: DualShare;
  /** The pose last written, for the CPU reference (`pose`). */
  private posed: { rest: RestBones; rotations: BoneRotations } | null = null;
  private cached: SkinPose | null = null;

  /** `share`: each bone's share of dual quaternion skinning (`skinDualShare`). */
  constructor(bones: number, share: DualShare) {
    this.share = share;
    this.data = new Float32Array(bones * DUAL_TEXELS * 4);
    // Until posed, every bone is the identity motion, so no frame ever skins by zeros.
    for (let b = 0; b < bones; b++) this.data[b * DUAL_TEXELS * 4 + 3] = 1;
    this.texture = new DataTexture(this.data, bones * DUAL_TEXELS, 1, RGBAFormat, FloatType);
    // Fetched texel by texel (texelFetch), never filtered.
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  /** Poses the bones: `rotations` over the skeleton `rest`. */
  update(rest: RestBones, rotations: BoneRotations): void {
    dualBoneTexels(rest, rotations, this.share, this.data);
    this.posed = { rest, rotations };
    this.cached = null;
    this.texture.needsUpdate = true;
  }

  /** The pose last written, prepared for skinning on the CPU (null before the first). */
  pose(): SkinPose | null {
    if (!this.cached && this.posed)
      this.cached = skinPose(this.posed.rest, this.posed.rotations, this.share);
    return this.cached;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** What a vertex shader patch needs from a three shader object. */
export interface PatchableShader {
  vertexShader: string;
  uniforms: Record<string, { value: unknown }>;
}

/**
 * GLSL for the blend, mirroring `blend` and `skinVertex` in src/rig/dual.ts:
 * the motion a vertex follows under dual quaternion skinning, and its share.
 */
export const DUAL_SKINNING_FUNCTIONS = /* glsl */ `
#ifdef USE_SKINNING
uniform highp sampler2D ${DUAL_BONES_UNIFORM};
vec3 hkQRotate( vec4 q, vec3 v ) {
	return v + 2.0 * cross( q.xyz, cross( q.xyz, v ) + q.w * v );
}
// The rotation q and translation t of the vertex's blended dual quaternion, and its share of the scheme.
void hkDualMotion( vec4 index, vec4 weight, out vec4 q, out vec3 t, out float share ) {
	vec4 r = vec4( 0.0 );
	vec4 d = vec4( 0.0 );
	vec4 pivot = vec4( 0.0 );
	bool pivoted = false;
	share = 0.0;
	for ( int k = 0; k < 4; k ++ ) {
		float w = weight[ k ];
		if ( w == 0.0 ) continue;
		int j = int( index[ k ] ) * ${DUAL_TEXELS};
		vec4 bq = texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( j, 0 ), 0 );
		vec4 bd = texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( j + 1, 0 ), 0 );
		share += w * texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( j + 2, 0 ), 0 ).x;
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
}
#endif
`;

/** The blend of the vertex's position, after three's linear skinning has run. */
const POSITION = /* glsl */ `
#ifdef USE_SKINNING
	vec3 hkRestPosition = transformed;
#endif
#include <skinning_vertex>
#ifdef USE_SKINNING
	#ifndef HK_DUAL_MOTION
		vec4 hkQ;
		vec3 hkT;
		float hkShare;
		hkDualMotion( skinIndex, skinWeight, hkQ, hkT, hkShare );
	#endif
	if ( hkShare > 0.0 ) transformed = mix( transformed, hkQRotate( hkQ, hkRestPosition ) + hkT, hkShare );
#endif
`;

/** The blend of the vertex's normal; the motion it finds is the position's too. */
const NORMAL = /* glsl */ `
#ifdef USE_SKINNING
	vec3 hkRestNormal = objectNormal;
	vec4 hkQ;
	vec3 hkT;
	float hkShare;
	hkDualMotion( skinIndex, skinWeight, hkQ, hkT, hkShare );
	#define HK_DUAL_MOTION
#endif
#include <skinnormal_vertex>
#ifdef USE_SKINNING
	if ( hkShare > 0.0 ) objectNormal = mix( objectNormal, hkQRotate( hkQ, hkRestNormal ), hkShare );
#endif
`;

/** Makes a three vertex shader skin by `bones`: call it from an `onBeforeCompile`. */
export function patchDualSkinning(shader: PatchableShader, bones: DualBones): void {
  const needs = ["#include <common>", "#include <skinning_vertex>"];
  for (const chunk of needs)
    if (!shader.vertexShader.includes(chunk))
      throw new Error(`dual skinning: three's ${chunk} chunk moved`);
  shader.uniforms[DUAL_BONES_UNIFORM] = { value: bones.texture };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${DUAL_SKINNING_FUNCTIONS}`)
    .replace("#include <skinnormal_vertex>", NORMAL)
    .replace("#include <skinning_vertex>", POSITION);
}

/** Part of the program's cache key: a shader patched for dual skinning differs from one that is not. */
export const DUAL_SKINNING_KEY = "dual-skinning-1";

/**
 * Makes `material` skin by `bones`, for materials this library does not make
 * (clothing, hair): it follows the body's dual quaternion skinning instead of
 * three's linear skinning alone, so it does not part from the skin at a joint.
 */
export function applyDualSkinning(material: Material, bones: DualBones): void {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    patchDualSkinning(shader as unknown as PatchableShader, bones);
  };
  material.customProgramCacheKey = () => `${key.call(material)}|${DUAL_SKINNING_KEY}`;
  material.needsUpdate = true;
}

/**
 * The depth materials a skinned mesh casts shadows with: three's own would
 * skin linearly, and a shadow must follow the surface it is cast from.
 */
export function dualShadowMaterials(bones: DualBones): {
  depth: MeshDepthMaterial;
  distance: MeshDistanceMaterial;
} {
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  const distance = new MeshDistanceMaterial();
  applyDualSkinning(depth, bones);
  applyDualSkinning(distance, bones);
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
