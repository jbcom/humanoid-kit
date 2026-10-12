/**
 * Posing a skeleton: the rest skeleton (`RestBones`) and the world rotation and
 * head of every bone for a set of local rotations, parents before children.
 * Skinning (`skinPositions`, src/rig/pose.ts, and the dual quaternion blend in
 * src/rig/dual.ts) and the joint signals are built on it.
 */
import { mul, type Quat, rotate } from "./quat.ts";

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

/** Per bone, a rotation quaternion (x, y, z, w): `bones * 4`. */
export type BoneRotations = Float32Array;

/**
 * Reusable storage for a posed skeleton. Callers that sample a transient pose
 * many times (for example a constraint solver) own this storage and must not
 * share it across simultaneous reads.
 */
export interface PosedBonesScratch {
  readonly world: Float32Array;
  readonly heads: Float32Array;
}

/** Allocates one reusable posed-skeleton buffer for this rest rig. */
export function posedBonesScratch(rest: Pick<RestBones, "names">): PosedBonesScratch {
  return {
    world: new Float32Array(rest.names.length * 4),
    heads: new Float32Array(rest.names.length * 3),
  };
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
  return posedBonesInto(rest, rotations, posedBonesScratch(rest));
}

/**
 * Writes a posed skeleton into caller-owned storage. It has the same result as
 * `posedBones`, without allocating world/head typed arrays for each sample.
 */
export function posedBonesInto(
  rest: RestBones,
  rotations: BoneRotations,
  out: PosedBonesScratch,
): PosedBonesScratch {
  const n = rest.names.length;
  if (rotations.length !== n * 4)
    throw new RangeError("posed bones: rotations do not match the rest skeleton");
  if (out.world.length !== n * 4 || out.heads.length !== n * 3)
    throw new RangeError("posed bones: scratch does not match the rest skeleton");
  const { world, heads } = out;
  for (const b of rest.order) {
    const r = b * 4;
    const h = b * 3;
    const rx = rotations[r] as number;
    const ry = rotations[r + 1] as number;
    const rz = rotations[r + 2] as number;
    const rw = rotations[r + 3] as number;
    const p = rest.parents[b] as number;
    if (p < 0) {
      world[r] = rx;
      world[r + 1] = ry;
      world[r + 2] = rz;
      world[r + 3] = rw;
      heads[h] = rest.heads[h] as number;
      heads[h + 1] = rest.heads[h + 1] as number;
      heads[h + 2] = rest.heads[h + 2] as number;
      continue;
    }
    const pr = p * 4;
    const ph = p * 3;
    const px = world[pr] as number;
    const py = world[pr + 1] as number;
    const pz = world[pr + 2] as number;
    const pw = world[pr + 3] as number;
    world[r] = pw * rx + px * rw + py * rz - pz * ry;
    world[r + 1] = pw * ry - px * rz + py * rw + pz * rx;
    world[r + 2] = pw * rz + px * ry - py * rx + pz * rw;
    world[r + 3] = pw * rw - px * rx - py * ry - pz * rz;
    const x = (rest.heads[h] as number) - (rest.heads[ph] as number);
    const y = (rest.heads[h + 1] as number) - (rest.heads[ph + 1] as number);
    const z = (rest.heads[h + 2] as number) - (rest.heads[ph + 2] as number);
    const tx = 2 * (py * z - pz * y);
    const ty = 2 * (pz * x - px * z);
    const tz = 2 * (px * y - py * x);
    heads[h] = (heads[ph] as number) + x + pw * tx + (py * tz - pz * ty);
    heads[h + 1] = (heads[ph + 1] as number) + y + pw * ty + (pz * tx - px * tz);
    heads[h + 2] = (heads[ph + 2] as number) + z + pw * tz + (px * ty - py * tx);
  }
  return out;
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
export function boneTransforms(
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
