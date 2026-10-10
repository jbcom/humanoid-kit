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
import type { PosedSkeleton } from "../foundation/landmarks.ts";
import {
  DUAL_TEXELS,
  type DualShare,
  dualBoneTexels,
  type SkinFold,
  type SkinPose,
  skinFold,
  skinPose,
  skinPositionAt,
} from "../rig/dual.ts";
import {
  FOLD_KEYS,
  FOLD_OPENINGS,
  FOLD_ROW_TEXELS,
  HIP_FOLD,
  type HipFold,
  hipFlexion,
  renderFold,
  type SurfaceFold,
} from "../rig/hipFold.ts";
import { type BoneRotations, posedBones, type RestBones } from "../rig/pose.ts";
import { poseShare } from "../rig/skinShare.ts";

/** The bone texture's uniform, in every patched shader. */
export const DUAL_BONES_UNIFORM = "hkDualBones";
/**
 * The hip fold texture's uniform: a row per vertex the fold moves, two texels per
 * key and opening (the displacement, the normal's change), `FOLD_ROWS_PER_LINE`
 * rows a line.
 */
export const FOLD_UNIFORM = "hkFoldTexture";
/**
 * Which texel of the bone texture holds the root's rotation (after every bone's
 * own); the next holds the hips' flexion and opening (`hipFlexion`: left, right,
 * left opening, right opening).
 */
export const ROOT_UNIFORM = "hkRootTexel";
/** How much of the hip fold shows, 0 to 1: it fades in when it arrives (`DualBones.advanceFold`). */
export const FOLD_BLEND_UNIFORM = "hkFoldBlend";
/** Seconds the fold takes to fade in, so that a figure whose fold arrives late does not jump. */
export const FOLD_FADE = 0.15;
/** The vertex attribute holding a vertex's row in the fold texture, or -1. */
export const FOLD_SLOT_ATTRIBUTE = "hkFoldSlot";

/** The widest a fold texture's line may be: the texture size every WebGL 2 device takes. */
const FOLD_LINE_TEXELS_MAX = 2048;
/**
 * Fold rows laid side by side on one line of the fold texture. A row per line
 * made the texture as tall as the rows, and the adult surface's fold has near ten
 * thousand: past a GPU's largest texture (8192 on the render host) the texture
 * never uploads, and every vertex there read no fold, or garbage, three
 * centimetres from where the CPU put it. Lines of 2048 texels, the size every
 * WebGL 2 device takes, hold any fold of up to 2048 lines of rows: with two
 * openings, 11 rows a line, 22528 rows (the adult surface's are near 15000,
 * 1350 lines).
 */
export const FOLD_ROWS_PER_LINE = Math.floor(FOLD_LINE_TEXELS_MAX / FOLD_ROW_TEXELS);
/** Texels on a line of the fold texture: whole rows (`FOLD_ROW_TEXELS` each). */
export const FOLD_LINE_TEXELS = FOLD_ROWS_PER_LINE * FOLD_ROW_TEXELS;

/**
 * Where in the fold texture row `row`'s key `key` at opening `opening` lies,
 * `part` 0 its displacement and 1 its normal's change: [x, y] in texels. The
 * layout's one definition; the shader's `hkFoldTexel` is this, and
 * `foldTexture` writes the rows where it says.
 */
export function foldTexel(
  row: number,
  opening: number,
  key: number,
  part: 0 | 1,
): [number, number] {
  const texel = row * FOLD_ROW_TEXELS + (opening * FOLD_KEYS + key) * 2 + part;
  return [texel % FOLD_LINE_TEXELS, Math.floor(texel / FOLD_LINE_TEXELS)];
}

/** A fold texture of `rows` rows from their data (`SurfaceFold.data`), padded out to whole lines. */
function foldTexture(data: Float32Array, rows: number): DataTexture {
  const lines = Math.max(1, Math.ceil(rows / FOLD_ROWS_PER_LINE));
  const texels = new Float32Array(lines * FOLD_LINE_TEXELS * 4);
  for (let row = 0; row < rows; row++)
    for (let opening = 0; opening < FOLD_OPENINGS; opening++)
      for (let key = 0; key < FOLD_KEYS; key++)
        for (const part of [0, 1] as const) {
          const [x, y] = foldTexel(row, opening, key, part);
          const from = (((row * FOLD_OPENINGS + opening) * FOLD_KEYS + key) * 2 + part) * 4;
          texels.set(data.subarray(from, from + 4), (y * FOLD_LINE_TEXELS + x) * 4);
        }
  const t = new DataTexture(texels, FOLD_LINE_TEXELS, lines, RGBAFormat, FloatType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** A texture of no fold: one row, all zeros, that no vertex refers to. */
export const noFoldTexture = (): DataTexture =>
  foldTexture(new Float32Array(FOLD_ROW_TEXELS * 4), 1);

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
  /** How much of the fold shows (a uniform the shaders share): 1 once it has faded in. */
  readonly foldBlend: { value: number } = { value: 1 };
  /** The table's share per bone (`skinDualShare`); a pose's own shares come from it (`poseShare`). */
  private readonly share: Float32Array;
  /** The pose last written, for the CPU reference (`pose`), with the shares it was written with. */
  private posed: { rest: RestBones; rotations: BoneRotations; share: Float32Array } | null = null;
  private cached: SkinPose | null = null;
  private cachedLinear: SkinPose | null = null;
  private cachedSkeleton: PosedSkeleton | null = null;
  /** The fold set (`setFold`) over its surface's render vertices, for the CPU reference; null for none. */
  private cpuFold: HipFold | null = null;
  /** `cpuFold` in the pose last written (`skinFold`), once asked for: undefined until then. */
  private cachedFold: SkinFold | null | undefined;
  /** Which body surface the fold set is for. */
  foldSurface: "base" | "adult" = "base";

  /** `share`: each bone's share of dual quaternion skinning (`skinDualShare`). */
  constructor(bones: number, share: DualShare) {
    this.bones = bones;
    this.share =
      typeof share === "number" ? new Float32Array(bones).fill(share) : Float32Array.from(share);
    // After every bone's texels, two more: the root's rotation, which the fold turns with, and the hips' flexion and opening, which it is read at.
    const texels = bones * DUAL_TEXELS + 2;
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
    dualBoneTexels(rest, rotations, share, this.data);
    const root = rest.parents.indexOf(-1);
    if (root >= 0)
      this.data.set(rotations.subarray(root * 4, root * 4 + 4), this.bones * DUAL_TEXELS * 4);
    const hips = hipFlexion(rest, rotations);
    this.data.set(
      [hips.left, hips.right, hips.leftOpening, hips.rightOpening],
      (this.bones * DUAL_TEXELS + 1) * 4,
    );
    this.posed = { rest, rotations, share };
    this.cached = null;
    this.cachedLinear = null;
    this.cachedSkeleton = null;
    this.cachedFold = undefined;
    this.texture.needsUpdate = true;
  }

  /**
   * Sets the hip fold of the surface being drawn (`surfaceFold`), or none: its
   * rows are what the geometry's `FOLD_SLOT_ATTRIBUTE` points into. `surface`
   * says which body surface it is for; the CPU reference keeps it too
   * (`skinFold`), so what is skinned on the CPU is what the shader draws.
   */
  setFold(fold: SurfaceFold | null, surface: "base" | "adult" = "base"): void {
    const old = this.fold.value;
    const had = this.hasFold;
    this.hasFold = !!fold && fold.rows > 0;
    this.cpuFold = fold && this.hasFold ? renderFold(fold) : null;
    this.cachedFold = undefined;
    this.foldSurface = surface;
    // A fold that arrives where there was none fades in; one that replaces another (the figure's shape changed) does not.
    this.foldBlend.value = this.hasFold && !had ? 0 : 1;
    if (!fold || fold.rows === 0) this.fold.value = noFoldTexture();
    else this.fold.value = foldTexture(fold.data, fold.rows);
    old.dispose();
  }

  /** Whether a fold is set. */
  private hasFold = false;

  /**
   * Carries the fold's fade on by `seconds`; true while it is not whole, so a
   * caller that renders on demand knows to draw another frame.
   */
  advanceFold(seconds: number): boolean {
    if (this.foldBlend.value >= 1) return false;
    this.foldBlend.value = Math.min(1, this.foldBlend.value + seconds / FOLD_FADE);
    return this.foldBlend.value < 1;
  }

  /** The pose last written, prepared for skinning on the CPU (null before the first). */
  pose(): SkinPose | null {
    if (!this.cached && this.posed)
      this.cached = skinPose(this.posed.rest, this.posed.rotations, this.posed.share);
    return this.cached;
  }

  /**
   * The same pose skinned linearly alone, as three skins a mesh whose material
   * does not follow these bones (a custom material): null before the first.
   */
  linearPose(): SkinPose | null {
    if (!this.cachedLinear && this.posed)
      this.cachedLinear = skinPose(this.posed.rest, this.posed.rotations, 0);
    return this.cachedLinear;
  }

  /** The pose's skeleton (`posedBones`): each bone's world rotation and posed head; null before the first. */
  skeleton(): PosedSkeleton | null {
    if (!this.cachedSkeleton && this.posed)
      this.cachedSkeleton = posedBones(this.posed.rest, this.posed.rotations);
    return this.cachedSkeleton;
  }

  /**
   * The fold set, in the pose last written, at the share of it showing now
   * (`foldBlend`), for `skinPositionAt` on the render vertices of
   * `foldSurface`: null when there is none, or the pose flexes no hip enough.
   */
  skinFold(): SkinFold | null {
    if (this.cachedFold === undefined)
      this.cachedFold = this.posed
        ? skinFold(this.posed.rest, this.posed.rotations, this.cpuFold)
        : null;
    if (this.cachedFold) this.cachedFold.blend = this.foldBlend.value;
    return this.cachedFold;
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
 * the motion a vertex follows under dual quaternion skinning, and its share of
 * the scheme.
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
		vec4 bs = texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( j + 2, 0 ), 0 );
		share += w * bs.x;
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

/**
 * GLSL for the hip fold, mirroring `foldAngles` and `addFold` in
 * src/rig/hipFold.ts: a vertex's displacement at the flexion and opening of the
 * hip on its side, from the fold texture's row (its slot), turned with the root.
 */
export const FOLD_FUNCTIONS = /* glsl */ `
#ifdef USE_SKINNING
uniform highp sampler2D ${FOLD_UNIFORM};
uniform int ${ROOT_UNIFORM};
uniform float ${FOLD_BLEND_UNIFORM};
// foldTexel's layout (src/render/dualSkinning.ts): rows side by side, FOLD_LINE_TEXELS a line.
ivec2 hkFoldTexel( int slot, int opening, int key, int part ) {
	int texel = slot * ${FOLD_ROW_TEXELS} + ( opening * ${FOLD_KEYS} + key ) * 2 + part;
	return ivec2( texel % ${FOLD_LINE_TEXELS}, texel / ${FOLD_LINE_TEXELS} );
}
vec3 hkFoldKey( int opening, int key, int slot, int part ) {
	return texelFetch( ${FOLD_UNIFORM}, hkFoldTexel( slot, opening, key, part ), 0 ).xyz;
}
// The flexion and opening (degrees) row slot is read at (foldAngles): each hip's flexion counted by twice its side's share, to all of it from half, the greater, with that hip's opening.
vec2 hkFoldAngles( int slot ) {
	float side = texelFetch( ${FOLD_UNIFORM}, hkFoldTexel( slot, 0, 0, 0 ), 0 ).w;
	vec4 hips = texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( ${ROOT_UNIFORM} + 1, 0 ), 0 );
	float left = min( 1.0, 2.0 * side ) * hips.x;
	float right = min( 1.0, 2.0 * ( 1.0 - side ) ) * hips.y;
	return left >= right ? vec2( left, hips.z ) : vec2( right, hips.w );
}
// Row slot's value at flexion and opening degrees, in the figure's own axes. part 0: the vertex's displacement; part 1: what its normal gains.
vec3 hkFoldAt( int slot, float flexion, float opening, int part ) {
	float t = ( flexion - ${glFloat(HIP_FOLD.from)} ) / ${glFloat(HIP_FOLD.step)};
	if ( ! ( t > 0.0 ) ) return vec3( 0.0 );
	float i = min( floor( t ), ${glFloat(FOLD_KEYS)} );
	float along = i >= ${glFloat(FOLD_KEYS)} ? 1.0 : t - i;
	int hi = min( int( i ), ${FOLD_KEYS - 1} );
	vec3 d[ ${FOLD_OPENINGS} ];
	for ( int o = 0; o < ${FOLD_OPENINGS}; o ++ ) {
		vec3 to = hkFoldKey( o, hi, slot, part );
		vec3 was = int( i ) == 0 || i >= ${glFloat(FOLD_KEYS)} ? vec3( 0.0 ) : hkFoldKey( o, int( i ) - 1, slot, part );
		d[ o ] = i >= ${glFloat(FOLD_KEYS)} ? to : was + ( to - was ) * along;
	}
	float open = clamp( opening / ${glFloat(HIP_FOLD.opened)}, 0.0, 1.0 );
	return d[ 0 ] * ( 1.0 - open ) + d[ 1 ] * open;
}
// Row slotValue's value at the angles it is read at, turned with the root, as much as has faded in.
vec3 hkFoldValue( float slotValue, int part ) {
	int slot = int( slotValue + 0.5 );
	vec2 angles = hkFoldAngles( slot );
	vec3 d = hkFoldAt( slot, angles.x, angles.y, part );
	return hkQRotate( texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( ${ROOT_UNIFORM}, 0 ), 0 ), d ) * ${FOLD_BLEND_UNIFORM};
}
vec3 hkFoldDisplacement( float slotValue ) {
	return hkFoldValue( slotValue, 0 );
}
vec3 hkFoldNormal( float slotValue ) {
	return hkFoldValue( slotValue, 1 );
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
		hkDualMotion( skinIndex, skinWeight, hkQ, hkT, hkShare );
	#endif
	if ( hkShare > 0.0 ) transformed = mix( transformed, hkQRotate( hkQ, hkRestPosition ) + hkT, hkShare );
	${fold ? `if ( ${FOLD_SLOT_ATTRIBUTE} >= 0.0 ) transformed += hkFoldDisplacement( ${FOLD_SLOT_ATTRIBUTE} );` : ""}
#endif
`;

/** The blend of the vertex's normal; the motion it finds is the position's too. */
const normal = (fold: boolean): string => /* glsl */ `
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
	${fold ? `if ( ${FOLD_SLOT_ATTRIBUTE} >= 0.0 ) objectNormal = normalize( objectNormal + hkFoldNormal( ${FOLD_SLOT_ATTRIBUTE} ) );` : ""}
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
    shader.uniforms[FOLD_BLEND_UNIFORM] = bones.foldBlend;
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
export const DUAL_SKINNING_KEY = "dual-skinning-5";

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
 * shader does; with `fold`, for a geometry with `FOLD_SLOT_ATTRIBUTE` (the
 * body's), the hip fold too, as much of it as shows.
 */
export function followDualSkinning(mesh: SkinnedMesh, bones: DualBones, fold = false): void {
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
    // As the shader: a vertex with a row in the fold (the geometry's slot) takes it.
    const slot = fold ? mesh.geometry.getAttribute(FOLD_SLOT_ATTRIBUTE)?.getX(vertex) : undefined;
    const folding = slot !== undefined && slot >= 0 ? bones.skinFold() : null;
    skinPositionAt(pose, index, weight, 0, target.x, target.y, target.z, out, 0, folding, vertex);
    target.x = out[0];
    target.y = out[1];
    target.z = out[2];
    return target;
  };
  mesh.applyBoneTransform = skin as SkinnedMesh["applyBoneTransform"];
}
