/**
 * The joints a figure's skin is folded at (docs/ARCHITECTURE.md, "The hip
 * fold", "The knee fold"), and what reads each one in a pose: how far its two
 * sides are flexed and opened, and the bone whose turn each side's
 * displacements follow.
 */
import { type BoneRotations, boneTransforms, IDENTITY_POSE, type RestBones } from "./bones.ts";
import { HIP_FOLD, hipFlexion, hipRotation } from "./hipFold.ts";
import type { FoldJoint, JointFlexion } from "./jointFold.ts";
import { KNEE_FOLD, kneeFlexion, kneeRotation } from "./kneeFold.ts";
import type { Quat } from "./quat.ts";

/**
 * Both sides of `joint` flexed `degrees` and opened `opening` degrees, every
 * other bone at rest: the poses a fold is solved at.
 */
export function jointRotations(
  joint: FoldJoint,
  rest: RestBones,
  degrees: number,
  opening: number,
): Float32Array {
  const rotations = IDENTITY_POSE(rest.names.length);
  (["L", "R"] as const).forEach((side, i) => {
    const b = rest.names.indexOf(`${joint.bone}.${side}`);
    if (b < 0) return;
    rotations.set(
      joint.name === "hip" ? hipRotation(degrees, opening, i ? -1 : 1) : kneeRotation(degrees),
      b * 4,
    );
  });
  return rotations;
}

/** Every joint a figure is folded at, in the order its folds are kept and drawn. */
export const FOLD_JOINTS = [HIP_FOLD, KNEE_FOLD] as const satisfies readonly FoldJoint[];

/** A fold joint's name. */
export type FoldJointName = (typeof FOLD_JOINTS)[number]["name"];

/** How far `joint`'s two sides are flexed and opened in a pose. */
export function foldFlexion(
  joint: FoldJoint,
  rest: RestBones,
  rotations: BoneRotations,
): JointFlexion {
  return joint.name === "hip" ? hipFlexion(rest, rotations) : kneeFlexion(rest, rotations);
}

/**
 * The bones (left, right) whose turn `joint`'s displacements follow on each
 * side: its `above` bone of that side, or the root for both.
 */
export function turnBones(joint: FoldJoint, rest: RestBones): [number, number] {
  const root = rest.parents.indexOf(-1);
  if (!joint.above) return [root, root];
  const of = (side: string) => {
    const b = rest.names.indexOf(`${joint.above}.${side}`);
    return b < 0 ? root : b;
  };
  return [of("L"), of("R")];
}

/** The world rotations in the pose of `joint`'s turn bones (`turnBones`): left, right. */
export function jointTurns(
  joint: FoldJoint,
  rest: RestBones,
  rotations: BoneRotations,
): [Quat, Quat] {
  const [l, r] = turnBones(joint, rest);
  // The root's turn is its own rotation: no parent to carry it.
  const world = joint.above === null ? rotations : boneTransforms(rest, rotations).world;
  const q = (b: number): Quat => [
    world[b * 4] as number,
    world[b * 4 + 1] as number,
    world[b * 4 + 2] as number,
    world[b * 4 + 3] as number,
  ];
  return [q(l), q(r)];
}
