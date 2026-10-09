/**
 * The rig: MakeHuman's default skeleton fitted to a morphed body, posed from
 * BVH rotations, and a CPU reference of the linear blend skinning the renderer
 * performs (docs/ARCHITECTURE.md, "Skeleton, poses and expressions").
 *
 * Rest frames are axis-aligned, as BVH's are: each bone sits at its head joint
 * with no rest rotation, so a BVH rotation is about world-aligned axes at the
 * joint, composed down the hierarchy.
 */
import {
  AssetFormatError,
  type BvhJoint,
  type HumanoidAssets,
  jointPosition,
} from "../format/assetFormat.ts";

export interface RestBones {
  /** Bone names, in the manifest's order (the order skin weights index). */
  names: string[];
  /** Parent index per bone; -1 for the root. */
  parents: Int16Array;
  /** Head joint per bone, over the morphed control mesh (`names.length * 3`). */
  heads: Float32Array;
  /** Bone indices with every parent before its children. */
  order: Int16Array;
}

/**
 * What posing needs from the pack, small enough to send to the main thread:
 * the bone names in skin-weight order, the facial pose units and the
 * whole-body poses.
 */
export interface RigData {
  bones: readonly string[];
  faceUnits: HumanoidAssets["manifest"]["faceUnits"];
  poses: HumanoidAssets["manifest"]["poses"];
}

export const rigData = (assets: HumanoidAssets): RigData => ({
  bones: assets.manifest.skeleton.bones.map((b) => b.name),
  faceUnits: assets.manifest.faceUnits,
  poses: assets.manifest.poses,
});

/** Per bone, a rotation quaternion (x, y, z, w): `bones * 4`. */
export type BoneRotations = Float32Array;

/** No rotation on any bone. */
export const IDENTITY_POSE = (bones: number): BoneRotations => {
  const q = new Float32Array(bones * 4);
  for (let b = 0; b < bones; b++) q[b * 4 + 3] = 1;
  return q;
};

/**
 * The rest skeleton from what an evaluation carries (its fitted bone heads)
 * and the rig's parents, without the packs: what a renderer has on hand.
 */
export function restBonesFrom(
  names: readonly string[],
  parents: Int16Array,
  heads: Float32Array,
): RestBones {
  const order: number[] = [];
  const placed = new Uint8Array(names.length);
  const place = (i: number, depth: number) => {
    if (placed[i]) return;
    if (depth > names.length) throw new AssetFormatError("the skeleton has a cycle");
    const p = parents[i] as number;
    if (p >= 0) place(p, depth + 1);
    placed[i] = 1;
    order.push(i);
  };
  for (let i = 0; i < names.length; i++) place(i, 0);
  return { names: [...names], parents, heads, order: Int16Array.from(order) };
}

/** The skeleton at rest on a body whose control vertices are `control`. */
export function restBones(assets: HumanoidAssets, control: Float32Array): RestBones {
  const bones = assets.manifest.skeleton.bones;
  const names = bones.map((b) => b.name);
  const index = new Map(names.map((n, i) => [n, i]));
  const parents = Int16Array.from(bones, (b) => {
    if (b.parent === null) return -1;
    const p = index.get(b.parent);
    if (p === undefined)
      throw new AssetFormatError(`bone ${b.name} has unknown parent ${b.parent}`);
    return p;
  });
  const heads = new Float32Array(bones.length * 3);
  bones.forEach((b, i) => {
    jointPosition(assets, control, b.head, heads, i * 3);
  });
  return restBonesFrom(names, parents, heads);
}

/** What grounding a posed figure needs, sent once with the rig. */
export interface RigSkin {
  /** Four bone indices and weights per base vertex (the pack's skin). */
  skinIndex: Uint8Array;
  skinWeight: Float32Array;
  /** Base vertices of the visible body (helpers and hidden faces excluded). */
  bodyVertices: Uint32Array;
}

/** Points skinned to the rig, at rest: a garment's render vertices and their skin. */
export interface SkinnedPoints {
  /** Rest positions, xyz per point. */
  positions: Float32Array;
  /** Four bone indices and weights per point. */
  skinIndex: ArrayLike<number>;
  skinWeight: Float32Array;
}

/**
 * The lift that puts a posed figure's lowest point on y = 0: the
 * evaluation's `groundOffset` for the pose, from its control mesh and bone
 * heads. The lowest point is the body's, or that of anything it wears
 * (`worn`: soles reach below the foot inside them), posed with it.
 */
export function posedGroundOffset(
  rest: RestBones,
  rotations: BoneRotations,
  control: Float32Array,
  skin: RigSkin,
  worn: readonly SkinnedPoints[] = [],
): number {
  const posed = skinPositions(
    rest,
    rotations,
    control,
    skin.skinIndex,
    skin.skinWeight,
    new Float32Array(control.length),
  );
  let minY = Number.POSITIVE_INFINITY;
  for (const v of skin.bodyVertices) minY = Math.min(minY, posed[v * 3 + 1] as number);
  return Math.max(-minY, wornGroundOffset(rest, rotations, worn));
}

/**
 * The lift that puts the lowest of `worn` (garments, posed with the rig) on
 * y = 0; negative infinity when nothing is worn, so it never raises a figure
 * that stands on its own feet (`Math.max` with the body's).
 */
export function wornGroundOffset(
  rest: RestBones,
  rotations: BoneRotations,
  worn: readonly SkinnedPoints[],
): number {
  let minY = Number.POSITIVE_INFINITY;
  for (const w of worn) {
    const p = skinPositions(
      rest,
      rotations,
      w.positions,
      w.skinIndex,
      w.skinWeight,
      new Float32Array(w.positions.length),
    );
    for (let i = 1; i < p.length; i += 3) minY = Math.min(minY, p[i] as number);
  }
  return -minY;
}

type Quat = [number, number, number, number];

const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

const axisAngle = (axis: 0 | 1 | 2, radians: number): Quat => {
  const q: Quat = [0, 0, 0, Math.cos(radians / 2)];
  q[axis] = Math.sin(radians / 2);
  return q;
};

/** Rotates `v` by unit quaternion `q`. */
const rotate = (q: Quat, x: number, y: number, z: number): [number, number, number] => {
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
};

/** Rotation vector (axis × angle) of a unit quaternion, shortest arc. */
const log = (q: Quat): [number, number, number] => {
  const s = q[3] < 0 ? -1 : 1;
  const [x, y, z, w] = [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
  const sin = Math.hypot(x, y, z);
  if (sin < 1e-12) return [2 * x, 2 * y, 2 * z];
  const k = (2 * Math.atan2(sin, w)) / sin;
  return [x * k, y * k, z * k];
};

const exp = (r: [number, number, number]): Quat => {
  const angle = Math.hypot(r[0], r[1], r[2]);
  if (angle < 1e-12) return [r[0] / 2, r[1] / 2, r[2] / 2, 1];
  const s = Math.sin(angle / 2) / angle;
  return [r[0] * s, r[1] * s, r[2] * s, Math.cos(angle / 2)];
};

/**
 * MakeHuman's BVH files are Z-up with the figure facing -Y; the base mesh and
 * this rig are Y-up facing +Z. A BVH axis maps to the figure's axis with a sign:
 * X stays X, Y (front to back) is -Z, Z (up) is Y.
 */
const AXIS: Record<string, [0 | 1 | 2, 1 | -1]> = {
  Xrotation: [0, 1],
  Yrotation: [2, -1],
  Zrotation: [1, 1],
};

/**
 * One BVH frame's rotations per bone (identity for bones the BVH leaves out),
 * in the figure's axes. Channels compose in the order written: "Zrotation
 * Xrotation Yrotation" is Rz · Rx · Ry. Translation channels are ignored.
 */
function frameRotations(
  rig: RigData,
  joints: readonly BvhJoint[],
  frame: readonly number[],
): Map<number, Quat> {
  const index = new Map(rig.bones.map((name, i) => [name, i]));
  const out = new Map<number, Quat>();
  let k = 0;
  for (const j of joints) {
    let q: Quat = [0, 0, 0, 1];
    for (const c of j.channels) {
      const value = frame[k++] ?? 0;
      const axis = AXIS[c];
      if (axis !== undefined && value !== 0)
        q = mul(q, axisAngle(axis[0], (axis[1] * value * Math.PI) / 180));
    }
    const b = index.get(j.name);
    if (b !== undefined && q[3] < 1) out.set(b, q);
  }
  return out;
}

/** A whole-body pose from the pack (`RigData.poses`, e.g. `tpose`), per bone. */
export function bodyPoseRotations(
  rig: RigData,
  name: string,
  out: BoneRotations = IDENTITY_POSE(rig.bones.length),
): BoneRotations {
  const pose = rig.poses.find((p) => p.name === name);
  if (!pose) throw new AssetFormatError(`unknown body pose ${name}`);
  out.set(IDENTITY_POSE(out.length / 4));
  for (const [b, q] of frameRotations(rig, pose.joints, pose.frame)) out.set(q, b * 4);
  return out;
}

/** Applies `b` after `a` on every bone (a · b), into `out`: a body pose with an expression on top. */
export function composeRotations(
  a: BoneRotations,
  b: BoneRotations,
  out: BoneRotations = new Float32Array(a.length),
): BoneRotations {
  for (let i = 0; i < a.length; i += 4) {
    const q = mul(
      [a[i] as number, a[i + 1] as number, a[i + 2] as number, a[i + 3] as number],
      [b[i] as number, b[i + 1] as number, b[i + 2] as number, b[i + 3] as number],
    );
    out.set(q, i);
  }
  return out;
}

/**
 * An expression: the face units named in `weights`, blended in log space
 * (each bone's rotation vectors summed by weight, then exponentiated), so the
 * blend is order-independent and one unit at weight 1 is exactly that unit.
 */
export function faceUnitRotations(
  rig: RigData,
  weights: Readonly<Record<string, number>>,
  out: BoneRotations = IDENTITY_POSE(rig.bones.length),
): BoneRotations {
  const { names, frames } = rig.faceUnits;
  const sums = new Map<number, [number, number, number]>();
  // Summed in the pack's unit order, whatever the order of `weights`.
  const units = Object.keys(weights).map((unit) => {
    const f = names.indexOf(unit);
    if (f < 0) throw new AssetFormatError(`unknown face unit ${unit}`);
    return f;
  });
  for (const f of units.sort((a, b) => a - b)) {
    const w = weights[names[f] as string] as number;
    if (w === 0) continue;
    for (const [b, q] of frameRotations(rig, rig.faceUnits.joints, frames[f] as number[])) {
      const r = log(q);
      const s = sums.get(b) ?? [0, 0, 0];
      sums.set(b, [s[0] + r[0] * w, s[1] + r[1] * w, s[2] + r[2] * w]);
    }
  }
  out.set(IDENTITY_POSE(out.length / 4));
  for (const [b, r] of sums) out.set(exp(r), b * 4);
  return out;
}

/** Each bone's rotation as a rotation vector (axis × angle): `bones * 3`. */
export function rotationVectors(rotations: BoneRotations): Float32Array {
  const n = rotations.length / 4;
  const out = new Float32Array(n * 3);
  for (let b = 0; b < n; b++)
    out.set(
      log([
        rotations[b * 4] as number,
        rotations[b * 4 + 1] as number,
        rotations[b * 4 + 2] as number,
        rotations[b * 4 + 3] as number,
      ]),
      b * 3,
    );
  return out;
}

/**
 * Linear blend skinning of `positions` (base-mesh vertices) by `rotations`,
 * exactly as the renderer's skinned mesh does: each bone's world transform is
 * its parent's, then the offset to its head, then its rotation; a vertex
 * follows its four weighted bones relative to their rest heads.
 */
export function skinPositions(
  rest: RestBones,
  rotations: BoneRotations,
  positions: Float32Array,
  skinIndex: ArrayLike<number>,
  skinWeight: Float32Array,
  out: Float32Array,
): Float32Array {
  const { world, origin } = boneTransforms(rest, rotations);
  const count = positions.length / 3;
  for (let v = 0; v < count; v++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[v * 4 + k] as number;
      if (w === 0) continue;
      const b = skinIndex[v * 4 + k] as number;
      const q: Quat = [
        world[b * 4] as number,
        world[b * 4 + 1] as number,
        world[b * 4 + 2] as number,
        world[b * 4 + 3] as number,
      ];
      const p = rotate(
        q,
        (positions[v * 3] as number) - (rest.heads[b * 3] as number),
        (positions[v * 3 + 1] as number) - (rest.heads[b * 3 + 1] as number),
        (positions[v * 3 + 2] as number) - (rest.heads[b * 3 + 2] as number),
      );
      x += w * (p[0] + (origin[b * 3] as number));
      y += w * (p[1] + (origin[b * 3 + 1] as number));
      z += w * (p[2] + (origin[b * 3 + 2] as number));
    }
    out[v * 3] = x;
    out[v * 3 + 1] = y;
    out[v * 3 + 2] = z;
  }
  return out;
}

/**
 * Each bone's head in the pose (`bones * 3`): where the joints are, for
 * anchors (hands, feet, face) and joint-angle signals.
 */
export function posedBoneHeads(rest: RestBones, rotations: BoneRotations): Float32Array {
  return boneTransforms(rest, rotations).origin;
}

/**
 * Each bone in the pose: its world rotation (`bones * 4`, from rest) and its
 * head (`bones * 3`).
 */
export function posedBones(
  rest: RestBones,
  rotations: BoneRotations,
): { world: Float32Array; heads: Float32Array } {
  const { world, origin } = boneTransforms(rest, rotations);
  return { world, heads: origin };
}

/** Rotates a vector by bone `b`'s world rotation in `world` (from `posedBones`). */
export function rotateByBone(
  world: Float32Array,
  b: number,
  v: readonly [number, number, number],
): [number, number, number] {
  return rotate(
    [
      world[b * 4] as number,
      world[b * 4 + 1] as number,
      world[b * 4 + 2] as number,
      world[b * 4 + 3] as number,
    ],
    v[0],
    v[1],
    v[2],
  );
}

/** Each bone's world rotation and head in the pose, parents before children. */
function boneTransforms(
  rest: RestBones,
  rotations: BoneRotations,
): { world: Float32Array; origin: Float32Array } {
  const n = rest.names.length;
  const world = new Float32Array(n * 4);
  const origin = new Float32Array(n * 3);
  for (const b of rest.order) {
    const r: Quat = [
      rotations[b * 4] as number,
      rotations[b * 4 + 1] as number,
      rotations[b * 4 + 2] as number,
      rotations[b * 4 + 3] as number,
    ];
    const p = rest.parents[b] as number;
    if (p < 0) {
      world.set(r, b * 4);
      origin.set(rest.heads.subarray(b * 3, b * 3 + 3), b * 3);
      continue;
    }
    const pq: Quat = [
      world[p * 4] as number,
      world[p * 4 + 1] as number,
      world[p * 4 + 2] as number,
      world[p * 4 + 3] as number,
    ];
    world.set(mul(pq, r), b * 4);
    const d = rotate(
      pq,
      (rest.heads[b * 3] as number) - (rest.heads[p * 3] as number),
      (rest.heads[b * 3 + 1] as number) - (rest.heads[p * 3 + 1] as number),
      (rest.heads[b * 3 + 2] as number) - (rest.heads[p * 3 + 2] as number),
    );
    origin[b * 3] = (origin[p * 3] as number) + d[0];
    origin[b * 3 + 1] = (origin[p * 3 + 1] as number) + d[1];
    origin[b * 3 + 2] = (origin[p * 3 + 2] as number) + d[2];
  }
  return { world, origin };
}
