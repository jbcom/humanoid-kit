/**
 * Skinning by dual quaternions and its blend with linear skinning
 * (docs/ARCHITECTURE.md, "Skinning artefacts"): the CPU reference of the
 * renderer's shader (`src/render/dualSkinning.ts`), for grounding, anchors,
 * picking and tests.
 *
 * Linear blend skinning averages the bones' matrices, and the average of two
 * rotations is not a rotation: a vertex between a bone and one twisted against
 * it is pulled toward the limb's axis (the candy wrapper), and a bent joint
 * loses volume. A rigid motion is a unit dual quaternion (a rotation `q` and
 * `d = ½ t q`, for translation `t`; Kavan, Collins, Žára & O'Sullivan 2008);
 * blending those and renormalising always gives a rigid motion, so a vertex
 * follows the bones it is weighted to along the shortest rotation between them.
 * Dual quaternions bulge a bent joint, though, so each bone says how much of
 * each scheme it takes (`SKIN_DUAL_SHARE`) and a vertex mixes the two results
 * by the mean of its bones' shares.
 */
import { type BoneRotations, posedBones, type RestBones } from "./bones.ts";
import { addFold, addFoldNormal, foldFlexion, folds, type HipFold, hipFlexion } from "./hipFold.ts";
import { mul, type Quat, rotate } from "./quat.ts";

/** Floats per bone in `dualBones`: the rotation (x, y, z, w), then the dual part (x, y, z, w). */
export const DUAL_STRIDE = 8;

type SkinIndex = Uint8Array | Uint16Array;
/** The share of dual quaternion skinning: one per bone, or one for all (0 linear, 1 dual quaternion). */
export type DualShare = number | ArrayLike<number>;

/**
 * Each bone's skinning transform (rest to posed, as a point moves with the
 * bone) as a unit dual quaternion: `bones * DUAL_STRIDE`.
 */
export function dualBones(
  rest: RestBones,
  rotations: BoneRotations,
  out: Float32Array = new Float32Array(rest.names.length * DUAL_STRIDE),
): Float32Array {
  const { world, heads } = posedBones(rest, rotations);
  for (let b = 0; b < rest.names.length; b++) {
    const q: Quat = [
      world[b * 4] as number,
      world[b * 4 + 1] as number,
      world[b * 4 + 2] as number,
      world[b * 4 + 3] as number,
    ];
    // A point p moves to R(p - head) + posedHead = R p + t.
    const r = rotate(
      q,
      rest.heads[b * 3] as number,
      rest.heads[b * 3 + 1] as number,
      rest.heads[b * 3 + 2] as number,
    );
    const half = mul(
      [
        (heads[b * 3] as number) - r[0],
        (heads[b * 3 + 1] as number) - r[1],
        (heads[b * 3 + 2] as number) - r[2],
        0,
      ],
      q,
    );
    out.set(q, b * DUAL_STRIDE);
    out.set([half[0] * 0.5, half[1] * 0.5, half[2] * 0.5, half[3] * 0.5], b * DUAL_STRIDE + 4);
  }
  return out;
}

/** Texels per bone in the renderer's bone texture: rotation, dual part, share. */
export const DUAL_TEXELS = 3;

/**
 * The renderer's bone texture, `bones * DUAL_TEXELS` RGBA texels: each bone's
 * dual quaternion (`dualBones`) and its share of dual quaternion skinning (the
 * third texel's first place; the rest of it is zero).
 */
export function dualBoneTexels(
  rest: RestBones,
  rotations: BoneRotations,
  share: DualShare,
  out: Float32Array = new Float32Array(rest.names.length * DUAL_TEXELS * 4),
): Float32Array {
  const dual = dualBones(rest, rotations);
  for (let b = 0; b < rest.names.length; b++) {
    out.set(dual.subarray(b * DUAL_STRIDE, (b + 1) * DUAL_STRIDE), b * DUAL_TEXELS * 4);
    out[b * DUAL_TEXELS * 4 + 8] = typeof share === "number" ? share : (share[b] as number);
    out[b * DUAL_TEXELS * 4 + 9] = 0;
    out[b * DUAL_TEXELS * 4 + 10] = 0;
    out[b * DUAL_TEXELS * 4 + 11] = 0;
  }
  return out;
}

/**
 * A pose prepared for skinning many vertices: each bone's dual quaternion, and
 * the rotation matrix and translation of the same motion for the linear half.
 */
export interface SkinPose {
  dual: Float32Array;
  /** Each bone's rotation as a row-major 3×3 matrix (`bones * 9`). */
  matrix: Float32Array;
  /** Each bone's translation (`bones * 3`), recovered from its dual quaternion: t = 2 d q*. */
  trans: Float32Array;
  share: DualShare;
}

export function skinPose(rest: RestBones, rotations: BoneRotations, share: DualShare): SkinPose {
  const dual = dualBones(rest, rotations);
  const n = dual.length / DUAL_STRIDE;
  const matrix = new Float32Array(n * 9);
  const trans = new Float32Array(n * 3);
  for (let b = 0; b < n; b++) {
    const o = b * DUAL_STRIDE;
    const x = dual[o] as number;
    const y = dual[o + 1] as number;
    const z = dual[o + 2] as number;
    const w = dual[o + 3] as number;
    matrix.set(
      [
        1 - 2 * (y * y + z * z),
        2 * (x * y - z * w),
        2 * (x * z + y * w),
        2 * (x * y + z * w),
        1 - 2 * (x * x + z * z),
        2 * (y * z - x * w),
        2 * (x * z - y * w),
        2 * (y * z + x * w),
        1 - 2 * (x * x + y * y),
      ],
      b * 9,
    );
    // t = 2 d q*, the vector part of the product.
    const m = mul(
      [dual[o + 4] as number, dual[o + 5] as number, dual[o + 6] as number, dual[o + 7] as number],
      [-x, -y, -z, w],
    );
    trans[b * 3] = 2 * m[0];
    trans[b * 3 + 1] = 2 * m[1];
    trans[b * 3 + 2] = 2 * m[2];
  }
  return { dual, matrix, trans, share };
}

/** What `blend` finds, read straight after it: the rotation (x, y, z, w) and translation (x, y, z). */
const motion = new Float64Array(7);

/**
 * The rigid motion a vertex follows under dual quaternion skinning: its bones'
 * dual quaternions summed by weight (each flipped to the side of the first, so
 * the blend takes the shorter rotation), then renormalised. Writes the rotation
 * and the translation to `motion`.
 */
function blend(dual: Float32Array, skinIndex: SkinIndex, skinWeight: Float32Array, v: number) {
  let rx = 0;
  let ry = 0;
  let rz = 0;
  let rw = 0;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  let dw = 0;
  let pivot = -1;
  for (let k = 0; k < 4; k++) {
    const w = skinWeight[v * 4 + k] as number;
    if (w === 0) continue;
    const o = (skinIndex[v * 4 + k] as number) * DUAL_STRIDE;
    if (pivot < 0) pivot = o;
    const along =
      (dual[pivot] as number) * (dual[o] as number) +
      (dual[pivot + 1] as number) * (dual[o + 1] as number) +
      (dual[pivot + 2] as number) * (dual[o + 2] as number) +
      (dual[pivot + 3] as number) * (dual[o + 3] as number);
    const side = along < 0 ? -w : w;
    rx += side * (dual[o] as number);
    ry += side * (dual[o + 1] as number);
    rz += side * (dual[o + 2] as number);
    rw += side * (dual[o + 3] as number);
    dx += side * (dual[o + 4] as number);
    dy += side * (dual[o + 5] as number);
    dz += side * (dual[o + 6] as number);
    dw += side * (dual[o + 7] as number);
  }
  const inv = 1 / Math.hypot(rx, ry, rz, rw);
  rx *= inv;
  ry *= inv;
  rz *= inv;
  rw *= inv;
  dx *= inv;
  dy *= inv;
  dz *= inv;
  dw *= inv;
  motion[0] = rx;
  motion[1] = ry;
  motion[2] = rz;
  motion[3] = rw;
  // t = 2 d q*. (A blend's dual part is not quite orthogonal to its rotation,
  // as a rigid motion's is; the part that is not along q only reaches the
  // product's scalar, which is dropped, so the translation needs no correction.)
  motion[4] = 2 * (rw * dx - dw * rx - (dy * rz - dz * ry));
  motion[5] = 2 * (rw * dy - dw * ry - (dz * rx - dx * rz));
  motion[6] = 2 * (rw * dz - dw * rz - (dx * ry - dy * rx));
}

/** The share of dual quaternion skinning vertex `v` takes: its bones' shares, by weight. */
function shareOf(pose: SkinPose, skinIndex: SkinIndex, skinWeight: Float32Array, v: number) {
  if (typeof pose.share === "number") return pose.share;
  let a = 0;
  for (let k = 0; k < 4; k++)
    a += (skinWeight[v * 4 + k] as number) * (pose.share[skinIndex[v * 4 + k] as number] as number);
  return Math.min(1, Math.max(0, a));
}

/**
 * Vertex `v` at (x, y, z) under the renderer's skinning: skinned linearly and by
 * dual quaternions and mixed by its dual share. Writes into `out` at `at`.
 */
export function skinVertex(
  pose: SkinPose,
  skinIndex: SkinIndex,
  skinWeight: Float32Array,
  v: number,
  x: number,
  y: number,
  z: number,
  out: number[] | Float32Array,
  at = 0,
): void {
  const a = shareOf(pose, skinIndex, skinWeight, v);
  let lx = 0;
  let ly = 0;
  let lz = 0;
  if (a < 1) {
    const { matrix, trans } = pose;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[v * 4 + k] as number;
      if (w === 0) continue;
      const b = skinIndex[v * 4 + k] as number;
      const m = b * 9;
      lx +=
        w *
        ((matrix[m] as number) * x +
          (matrix[m + 1] as number) * y +
          (matrix[m + 2] as number) * z +
          (trans[b * 3] as number));
      ly +=
        w *
        ((matrix[m + 3] as number) * x +
          (matrix[m + 4] as number) * y +
          (matrix[m + 5] as number) * z +
          (trans[b * 3 + 1] as number));
      lz +=
        w *
        ((matrix[m + 6] as number) * x +
          (matrix[m + 7] as number) * y +
          (matrix[m + 8] as number) * z +
          (trans[b * 3 + 2] as number));
    }
  }
  if (a === 0) {
    out[at] = lx;
    out[at + 1] = ly;
    out[at + 2] = lz;
    return;
  }
  blend(pose.dual, skinIndex, skinWeight, v);
  const [qx, qy, qz, qw] = motion as unknown as [number, number, number, number];
  // v + 2w (q × v) + 2 q × (q × v), as `rotate` does.
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  const dx = x + qw * tx + (qy * tz - qz * ty) + (motion[4] as number);
  const dy = y + qw * ty + (qz * tx - qx * tz) + (motion[5] as number);
  const dz = z + qw * tz + (qx * ty - qy * tx) + (motion[6] as number);
  out[at] = (1 - a) * lx + a * dx;
  out[at + 1] = (1 - a) * ly + a * dy;
  out[at + 2] = (1 - a) * lz + a * dz;
}

/** The figure's root rotation, which the hip fold's displacements turn with. */
function rootTurn(rest: RestBones, rotations: BoneRotations): Quat {
  const root = rest.parents.indexOf(-1);
  return [
    rotations[root * 4] as number,
    rotations[root * 4 + 1] as number,
    rotations[root * 4 + 2] as number,
    rotations[root * 4 + 3] as number,
  ];
}

/**
 * The renderer's skinning of `positions` (base-mesh vertices) by `rotations`:
 * each vertex skinned linearly and by dual quaternions, the two mixed by the
 * mean of its bones' `share`. A share of 0 is linear blend skinning, of 1 dual
 * quaternion skinning.
 */
export function skinPositionsBlended(
  rest: RestBones,
  rotations: BoneRotations,
  positions: Float32Array,
  skinIndex: SkinIndex,
  skinWeight: Float32Array,
  out: Float32Array,
  share: DualShare,
  fold?: HipFold,
): Float32Array {
  const pose = skinPose(rest, rotations, share);
  const count = positions.length / 3;
  // The hip fold's displacement is read at the flexion of the hip on the vertex's side (`foldSides`), and turns with the figure's root.
  const hips = fold ? hipFlexion(rest, rotations) : null;
  const folding = fold !== undefined && hips !== null && folds(hips);
  const turn = rootTurn(rest, rotations);
  const shown = new Float32Array(3);
  for (let v = 0; v < count; v++) {
    skinVertex(
      pose,
      skinIndex,
      skinWeight,
      v,
      positions[v * 3] as number,
      positions[v * 3 + 1] as number,
      positions[v * 3 + 2] as number,
      out,
      v * 3,
    );
    if (!folding) continue;
    const flexion = foldFlexion(fold, v, hips);
    if (flexion === null) continue;
    shown.fill(0);
    addFold(fold, v, flexion, shown, 0);
    const [dx, dy, dz] = rotate(turn, shown[0] as number, shown[1] as number, shown[2] as number);
    out[v * 3] = (out[v * 3] as number) + dx;
    out[v * 3 + 1] = (out[v * 3 + 1] as number) + dy;
    out[v * 3 + 2] = (out[v * 3 + 2] as number) + dz;
  }
  return out;
}

/** Dual quaternion skinning of `positions`: `skinPositionsBlended` with every bone at share 1. */
export const skinPositionsDual = (
  rest: RestBones,
  rotations: BoneRotations,
  positions: Float32Array,
  skinIndex: SkinIndex,
  skinWeight: Float32Array,
  out: Float32Array,
): Float32Array => skinPositionsBlended(rest, rotations, positions, skinIndex, skinWeight, out, 1);

/**
 * The normal at vertex `v` that goes with `skinVertex`: the linear and dual
 * quaternion normals mixed by the same share, then made unit length.
 */
export function skinNormal(
  pose: SkinPose,
  skinIndex: SkinIndex,
  skinWeight: Float32Array,
  v: number,
  x: number,
  y: number,
  z: number,
  out: number[] | Float32Array,
  at = 0,
): void {
  const a = shareOf(pose, skinIndex, skinWeight, v);
  let nx = 0;
  let ny = 0;
  let nz = 0;
  if (a < 1) {
    const { matrix } = pose;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[v * 4 + k] as number;
      if (w === 0) continue;
      const m = (skinIndex[v * 4 + k] as number) * 9;
      const s = (1 - a) * w;
      nx +=
        s *
        ((matrix[m] as number) * x + (matrix[m + 1] as number) * y + (matrix[m + 2] as number) * z);
      ny +=
        s *
        ((matrix[m + 3] as number) * x +
          (matrix[m + 4] as number) * y +
          (matrix[m + 5] as number) * z);
      nz +=
        s *
        ((matrix[m + 6] as number) * x +
          (matrix[m + 7] as number) * y +
          (matrix[m + 8] as number) * z);
    }
  }
  if (a > 0) {
    blend(pose.dual, skinIndex, skinWeight, v);
    const [qx, qy, qz, qw] = motion as unknown as [number, number, number, number];
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    nx += a * (x + qw * tx + (qy * tz - qz * ty));
    ny += a * (y + qw * ty + (qz * tx - qx * tz));
    nz += a * (z + qw * tz + (qx * ty - qy * tx));
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  out[at] = nx / len;
  out[at + 1] = ny / len;
  out[at + 2] = nz / len;
}

/** The normals of `skinPositionsBlended`'s vertices. */
export function skinNormalsBlended(
  rest: RestBones,
  rotations: BoneRotations,
  normals: Float32Array,
  skinIndex: SkinIndex,
  skinWeight: Float32Array,
  out: Float32Array,
  share: DualShare,
  fold?: HipFold,
): Float32Array {
  const pose = skinPose(rest, rotations, share);
  const count = normals.length / 3;
  // As the shader: the fold's turn added to the skinned normal, made a unit vector again.
  const hips = fold ? hipFlexion(rest, rotations) : null;
  const folding = fold !== undefined && hips !== null && folds(hips);
  const turn = rootTurn(rest, rotations);
  const shown = new Float32Array(3);
  for (let v = 0; v < count; v++) {
    skinNormal(
      pose,
      skinIndex,
      skinWeight,
      v,
      normals[v * 3] as number,
      normals[v * 3 + 1] as number,
      normals[v * 3 + 2] as number,
      out,
      v * 3,
    );
    if (!folding) continue;
    const flexion = foldFlexion(fold, v, hips);
    if (flexion === null) continue;
    shown.fill(0);
    addFoldNormal(fold, v, flexion, shown, 0);
    const [dx, dy, dz] = rotate(turn, shown[0] as number, shown[1] as number, shown[2] as number);
    const x = (out[v * 3] as number) + dx;
    const y = (out[v * 3 + 1] as number) + dy;
    const z = (out[v * 3 + 2] as number) + dz;
    const len = Math.hypot(x, y, z) || 1;
    out[v * 3] = x / len;
    out[v * 3 + 1] = y / len;
    out[v * 3 + 2] = z / len;
  }
  return out;
}

/** The normals of `skinPositionsDual`'s vertices. */
export const skinNormalsDual = (
  rest: RestBones,
  rotations: BoneRotations,
  normals: Float32Array,
  skinIndex: SkinIndex,
  skinWeight: Float32Array,
  out: Float32Array,
): Float32Array => skinNormalsBlended(rest, rotations, normals, skinIndex, skinWeight, out, 1);
