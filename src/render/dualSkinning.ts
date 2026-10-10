/**
 * The renderer's skinning: linear blend skinning mixed with dual quaternion
 * skinning by each vertex's share (docs/ARCHITECTURE.md, "Skinning artefacts"),
 * and the joint folds added to the skinned vertex ("The hip fold", "The knee
 * fold").
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
  HalfFloatType,
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
  skinFolds,
  skinPose,
  skinPositionAt,
} from "../rig/dual.ts";
import { FOLD_JOINTS, type FoldJointName, foldFlexion, jointTurns } from "../rig/folds.ts";
import {
  type FoldJoint,
  type JointFold,
  renderFold,
  rowTexels,
  type SurfaceFold,
} from "../rig/jointFold.ts";
import { type BoneRotations, posedBones, type RestBones } from "../rig/pose.ts";
import { poseShare } from "../rig/skinShare.ts";

/** The bone texture's uniform, in every patched shader. */
export const DUAL_BONES_UNIFORM = "hkDualBones";
/**
 * A joint fold's texture uniform: a row per vertex the fold moves, two texels
 * per key and opening (the displacement, the normal's change),
 * `foldRowsPerLine` rows a line.
 */
export const foldUniform = (joint: FoldJoint): string => `hkFoldTexture_${joint.name}`;
/**
 * Which texel of the bone texture the folds' own begin at, after every bone's:
 * three a joint, in `FOLD_JOINTS`' order (`foldTexels`).
 */
export const FOLD_TEXELS_UNIFORM = "hkFoldTexels";
/** How much of the folds show, 0 to 1: they fade in when they arrive (`DualBones.advanceFold`). */
export const FOLD_BLEND_UNIFORM = "hkFoldBlend";
/** Seconds the folds take to fade in, so that a figure whose folds arrive late does not jump. */
export const FOLD_FADE = 0.15;
/** The vertex attribute holding a vertex's row in a joint fold's texture, or -1. */
export const foldSlotAttribute = (joint: FoldJoint): string => `hkFoldSlot_${joint.name}`;

/**
 * Texels the bone texture gives each fold joint after the bones', in order: the
 * left side's turn (a rotation), the right side's, and how far each side is
 * flexed and opened (left, right, left opening, right opening).
 */
export const FOLD_JOINT_TEXELS = 3;

/** The widest a fold texture's line may be: the texture size every WebGL 2 device takes. */
const FOLD_LINE_TEXELS_MAX = 2048;
/**
 * Fold rows laid side by side on one line of a fold texture. A row per line
 * made the texture as tall as the rows, and the adult surface's hip fold has
 * near ten thousand: past a GPU's largest texture (8192 on the render host) the
 * texture never uploads, and every vertex there read no fold, or garbage, three
 * centimetres from where the CPU put it. Lines of 2048 texels, the size every
 * WebGL 2 device takes, hold any fold of up to 2048 lines of rows: the hip's two
 * openings, 11 rows a line, 22528 rows (the adult surface's are near 15000,
 * 1350 lines); the knee's one, 20 a line.
 */
export const foldRowsPerLine = (joint: FoldJoint): number =>
  Math.floor(FOLD_LINE_TEXELS_MAX / rowTexels(joint));
/** Texels on a line of a joint's fold texture: whole rows (`rowTexels` each). */
export const foldLineTexels = (joint: FoldJoint): number =>
  foldRowsPerLine(joint) * rowTexels(joint);

/**
 * Where in `joint`'s fold texture row `row`'s key `key` at opening `opening`
 * lies, `part` 0 its displacement and 1 its normal's change: [x, y] in texels.
 * The layout's one definition; the shader's `hkFoldTexel` is this, and
 * `foldTexture` writes the rows where it says.
 */
export function foldTexel(
  joint: FoldJoint,
  row: number,
  opening: number,
  key: number,
  part: 0 | 1,
): [number, number] {
  const line = foldLineTexels(joint);
  const texel = row * rowTexels(joint) + (opening * joint.keys + key) * 2 + part;
  return [texel % line, Math.floor(texel / line)];
}

/**
 * A fold texture of `rows` rows of `joint` from their data
 * (`SurfaceFold.data`), padded out to whole lines: half floats, as the data
 * is, eight bytes a texel. As 32-bit floats an adult's hip fold took 48.4 MB
 * (18005 rows with its organ's own); as halves, 24.2.
 */
function foldTexture(joint: FoldJoint, data: Uint16Array, rows: number): DataTexture {
  const line = foldLineTexels(joint);
  const lines = Math.max(1, Math.ceil(rows / foldRowsPerLine(joint)));
  const texels = new Uint16Array(lines * line * 4);
  for (let row = 0; row < rows; row++)
    for (let opening = 0; opening < joint.openings; opening++)
      for (let key = 0; key < joint.keys; key++)
        for (const part of [0, 1] as const) {
          const [x, y] = foldTexel(joint, row, opening, key, part);
          const from = (((row * joint.openings + opening) * joint.keys + key) * 2 + part) * 4;
          texels.set(data.subarray(from, from + 4), (y * line + x) * 4);
        }
  const t = new DataTexture(texels, line, lines, RGBAFormat, HalfFloatType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** A texture of no fold of `joint`: one row, all zeros, that no vertex refers to. */
export const noFoldTexture = (joint: FoldJoint): DataTexture =>
  foldTexture(joint, new Uint16Array(rowTexels(joint) * 4), 1);

/**
 * A figure's bones as dual quaternions, shared by the materials that skin by
 * them: `update` writes a pose, and the textures follow on the next frame.
 */
export class DualBones {
  readonly texture: DataTexture;
  readonly data: Float32Array;
  /** How many bones. */
  readonly bones: number;
  /** Each fold joint's texture, in a holder the shaders share, so that `setFolds` can replace it. */
  readonly folds = Object.fromEntries(
    FOLD_JOINTS.map((joint) => [joint.name, { value: noFoldTexture(joint) }]),
  ) as Record<FoldJointName, { value: DataTexture }>;
  /** How much of the folds show (a uniform the shaders share): 1 once they have faded in. */
  readonly foldBlend: { value: number } = { value: 1 };
  /** The table's share per bone (`skinDualShare`); a pose's own shares come from it (`poseShare`). */
  private readonly share: Float32Array;
  /** The pose last written, for the CPU reference (`pose`), with the shares it was written with. */
  private posed: { rest: RestBones; rotations: BoneRotations; share: Float32Array } | null = null;
  private cached: SkinPose | null = null;
  private cachedLinear: SkinPose | null = null;
  private cachedSkeleton: PosedSkeleton | null = null;
  /** The folds set (`setFolds`) over their surface's render vertices, for the CPU reference. */
  private cpuFolds: JointFold[] = [];
  /** `cpuFolds` in the pose last written (`skinFolds`), once asked for: undefined until then. */
  private cachedFolds: SkinFold[] | undefined;
  /** Which body surface the folds set are for. */
  foldSurface: "base" | "adult" = "base";

  /** `share`: each bone's share of dual quaternion skinning (`skinDualShare`). */
  constructor(bones: number, share: DualShare) {
    this.bones = bones;
    this.share =
      typeof share === "number" ? new Float32Array(bones).fill(share) : Float32Array.from(share);
    // After every bone's texels, each fold joint's: its sides' turns, which its displacements turn with, and their flexions and openings, which it is read at.
    const texels = bones * DUAL_TEXELS + FOLD_JOINTS.length * FOLD_JOINT_TEXELS;
    this.data = new Float32Array(texels * 4);
    // Until posed, every bone is the identity motion, so no frame ever skins by zeros; and every fold's turns the identity.
    for (let b = 0; b < bones; b++) this.data[b * DUAL_TEXELS * 4 + 3] = 1;
    FOLD_JOINTS.forEach((_, j) => {
      const at = (bones * DUAL_TEXELS + j * FOLD_JOINT_TEXELS) * 4;
      this.data[at + 3] = 1;
      this.data[at + 7] = 1;
    });
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
    FOLD_JOINTS.forEach((joint, j) => {
      const at = (this.bones * DUAL_TEXELS + j * FOLD_JOINT_TEXELS) * 4;
      const [left, right] = jointTurns(joint, rest, rotations);
      const f = foldFlexion(joint, rest, rotations);
      this.data.set(left, at);
      this.data.set(right, at + 4);
      this.data.set([f.left, f.right, f.leftOpening, f.rightOpening], at + 8);
    });
    this.posed = { rest, rotations, share };
    this.cached = null;
    this.cachedLinear = null;
    this.cachedSkeleton = null;
    this.cachedFolds = undefined;
    this.texture.needsUpdate = true;
  }

  /**
   * Sets the joint folds of the surface being drawn (`HumanoidModel.folds`, one
   * per joint of `FOLD_JOINTS`), or none: each one's rows are what the
   * geometry's attribute of its joint (`foldSlotAttribute`) points into.
   * `surface` says which body surface they are for; the CPU reference keeps
   * them too (`skinFolds`), so what is skinned on the CPU is what the shader draws.
   */
  setFolds(folds: readonly SurfaceFold[] | null, surface: "base" | "adult" = "base"): void {
    const had = this.hasFold;
    const set = (folds ?? []).filter((f) => f.rows > 0);
    this.hasFold = set.length > 0;
    this.cpuFolds = set.map(renderFold);
    this.cachedFolds = undefined;
    this.foldSurface = surface;
    // Folds that arrive where there were none fade in; ones that replace others (the figure's shape changed) do not.
    this.foldBlend.value = this.hasFold && !had ? 0 : 1;
    for (const joint of FOLD_JOINTS) {
      const holder = this.folds[joint.name];
      const old = holder.value;
      const fold = set.find((f) => f.joint.name === joint.name);
      holder.value = fold ? foldTexture(joint, fold.data, fold.rows) : noFoldTexture(joint);
      old.dispose();
    }
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
   * The folds set, in the pose last written, at the share of them showing now
   * (`foldBlend`), for `skinPositionAt` on the render vertices of
   * `foldSurface`: those of joints the pose flexes far enough (none when none is set).
   */
  skinFolds(): readonly SkinFold[] {
    if (this.cachedFolds === undefined)
      this.cachedFolds = this.posed
        ? skinFolds(this.posed.rest, this.posed.rotations, this.cpuFolds)
        : [];
    for (const f of this.cachedFolds) f.blend = this.foldBlend.value;
    return this.cachedFolds;
  }

  dispose(): void {
    this.texture.dispose();
    for (const joint of FOLD_JOINTS) this.folds[joint.name].value.dispose();
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
 * GLSL for one joint's fold, mirroring `foldAngles` and `addFold` in
 * src/rig/jointFold.ts and `foldValue` in src/rig/dual.ts: a vertex's
 * displacement (or its normal's change) at the flexion and opening of the
 * joint on its side, from the joint's fold texture's row (its slot), turned
 * with that side's turn. `j` is the joint's place in `FOLD_JOINTS`.
 */
const jointFoldFunctions = (joint: FoldJoint, j: number): string => {
  const n = joint.name;
  const keys = joint.keys;
  const line = foldLineTexels(joint);
  const own = `${FOLD_TEXELS_UNIFORM} + ${j * FOLD_JOINT_TEXELS}`;
  return /* glsl */ `
uniform highp sampler2D ${foldUniform(joint)};
// foldTexel's layout (src/render/dualSkinning.ts): rows side by side, foldLineTexels a line.
ivec2 hkFoldTexel_${n}( int slot, int opening, int key, int part ) {
	int texel = slot * ${rowTexels(joint)} + ( opening * ${keys} + key ) * 2 + part;
	return ivec2( texel % ${line}, texel / ${line} );
}
vec3 hkFoldKey_${n}( int opening, int key, int slot, int part ) {
	return texelFetch( ${foldUniform(joint)}, hkFoldTexel_${n}( slot, opening, key, part ), 0 ).xyz;
}
// The flexion, opening (degrees) and side (1 left) row slot is read at (foldAngles): each side's flexion counted by twice its side's share, to all of it from half, the greater, with that side's opening.
vec3 hkFoldAngles_${n}( int slot ) {
	float side = texelFetch( ${foldUniform(joint)}, hkFoldTexel_${n}( slot, 0, 0, 0 ), 0 ).w;
	vec4 flexion = texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( ${own} + 2, 0 ), 0 );
	float left = min( 1.0, 2.0 * side ) * flexion.x;
	float right = min( 1.0, 2.0 * ( 1.0 - side ) ) * flexion.y;
	return left >= right ? vec3( left, flexion.z, 1.0 ) : vec3( right, flexion.w, 0.0 );
}
// Row slot's value at flexion and opening degrees, in the axes it was solved in. part 0: the vertex's displacement; part 1: what its normal gains.
vec3 hkFoldAt_${n}( int slot, float flexion, float opening, int part ) {
	float t = ( flexion - ${glFloat(joint.from)} ) / ${glFloat(joint.step)};
	if ( ! ( t > 0.0 ) ) return vec3( 0.0 );
	float i = min( floor( t ), ${glFloat(keys)} );
	float along = i >= ${glFloat(keys)} ? 1.0 : t - i;
	int hi = min( int( i ), ${keys - 1} );
	vec3 d[ ${joint.openings} ];
	for ( int o = 0; o < ${joint.openings}; o ++ ) {
		vec3 to = hkFoldKey_${n}( o, hi, slot, part );
		vec3 was = int( i ) == 0 || i >= ${glFloat(keys)} ? vec3( 0.0 ) : hkFoldKey_${n}( o, int( i ) - 1, slot, part );
		d[ o ] = i >= ${glFloat(keys)} ? to : was + ( to - was ) * along;
	}
	${
    joint.openings > 1
      ? `float open = clamp( opening / ${glFloat(joint.opened)}, 0.0, 1.0 );
	return d[ 0 ] * ( 1.0 - open ) + d[ 1 ] * open;`
      : "return d[ 0 ];"
  }
}
// Row slotValue's value at the angles it is read at, turned with its side's turn, as much as has faded in.
vec3 hkFoldValue_${n}( float slotValue, int part ) {
	int slot = int( slotValue + 0.5 );
	vec3 angles = hkFoldAngles_${n}( slot );
	vec3 d = hkFoldAt_${n}( slot, angles.x, angles.y, part );
	vec4 turn = texelFetch( ${DUAL_BONES_UNIFORM}, ivec2( ${own} + ( angles.z > 0.5 ? 0 : 1 ), 0 ), 0 );
	return hkQRotate( turn, d ) * ${FOLD_BLEND_UNIFORM};
}
`;
};

/** GLSL for every joint's fold (`jointFoldFunctions`), with the uniforms they share and the slot attributes they read. */
export const FOLD_FUNCTIONS = /* glsl */ `
#ifdef USE_SKINNING
uniform int ${FOLD_TEXELS_UNIFORM};
uniform float ${FOLD_BLEND_UNIFORM};
${FOLD_JOINTS.map((joint, j) => jointFoldFunctions(joint, j)).join("")}
#endif
`;

/** The blend of the vertex's position, after three's linear skinning has run; with the folds, each joint's after it. */
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
	${
    fold
      ? FOLD_JOINTS.map(
          (joint) =>
            `if ( ${foldSlotAttribute(joint)} >= 0.0 ) transformed += hkFoldValue_${joint.name}( ${foldSlotAttribute(joint)}, 0 );`,
        ).join("\n\t")
      : ""
  }
#endif
`;

/** The blend of the vertex's normal; the motion it finds is the position's too. With the folds, each joint's change added, and the sum made unit again. */
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
	${
    fold
      ? `bool hkTurned = false;
	${FOLD_JOINTS.map(
    (joint) =>
      `if ( ${foldSlotAttribute(joint)} >= 0.0 ) { objectNormal += hkFoldValue_${joint.name}( ${foldSlotAttribute(joint)}, 1 ); hkTurned = true; }`,
  ).join("\n\t")}
	if ( hkTurned ) objectNormal = normalize( objectNormal );`
      : ""
  }
#endif
`;

/**
 * Makes a three vertex shader skin by `bones`: call it from an
 * `onBeforeCompile`. With `fold`, the shader adds the joint folds too, for a
 * geometry that carries each joint's slot attribute (`foldSlotAttribute`: the body's).
 */
export function patchDualSkinning(shader: PatchableShader, bones: DualBones, fold = false): void {
  const needs = ["#include <common>", "#include <skinning_vertex>"];
  for (const chunk of needs)
    if (!shader.vertexShader.includes(chunk))
      throw new Error(`dual skinning: three's ${chunk} chunk moved`);
  shader.uniforms[DUAL_BONES_UNIFORM] = { value: bones.texture };
  if (fold) {
    for (const joint of FOLD_JOINTS) shader.uniforms[foldUniform(joint)] = bones.folds[joint.name];
    shader.uniforms[FOLD_TEXELS_UNIFORM] = { value: bones.bones * DUAL_TEXELS };
    shader.uniforms[FOLD_BLEND_UNIFORM] = bones.foldBlend;
  }
  const attributes = FOLD_JOINTS.map(
    (joint) => `attribute float ${foldSlotAttribute(joint)};\n`,
  ).join("");
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>\n${DUAL_SKINNING_FUNCTIONS}${fold ? `${attributes}${FOLD_FUNCTIONS}` : ""}`,
    )
    .replace("#include <skinnormal_vertex>", normal(fold))
    .replace("#include <skinning_vertex>", position(fold));
}

/** Part of the program's cache key: a shader patched for dual skinning differs from one that is not. */
export const DUAL_SKINNING_KEY = "dual-skinning-6";

/**
 * Makes `material` skin by `bones`, for materials this library does not make
 * (clothing, hair): it follows the body's dual quaternion skinning instead of
 * three's linear skinning alone, so it does not part from the skin at a joint.
 * With `fold`, for a geometry with each joint's slot attribute
 * (`foldSlotAttribute`: the body's), the joint folds too.
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
 * shader does; with `fold`, for a geometry with each joint's slot attribute
 * (`foldSlotAttribute`: the body's), the joint folds too, as much of them as shows.
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
    // As the shader: a vertex the geometry gives a row in a joint's fold (its attribute of the joint) takes it.
    const folding =
      fold &&
      FOLD_JOINTS.some(
        (joint) => (mesh.geometry.getAttribute(foldSlotAttribute(joint))?.getX(vertex) ?? -1) >= 0,
      )
        ? bones.skinFolds()
        : undefined;
    skinPositionAt(pose, index, weight, 0, target.x, target.y, target.z, out, 0, folding, vertex);
    target.x = out[0];
    target.y = out[1];
    target.z = out[2];
    return target;
  };
  mesh.applyBoneTransform = skin as SkinnedMesh["applyBoneTransform"];
}
