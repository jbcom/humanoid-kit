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
