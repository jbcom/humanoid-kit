/**
 * The face as skin-state signals (docs/ARCHITECTURE.md, "Facial wrinkles"):
 * how much of each of a few expression keys a pose holds, 0 to 1, named
 * `face.<key>`. The way `flex.*` reads a pose's joints for the creases at the
 * elbow, these read its face for the lines of a brow, a cheek or a nose, from
 * the bones' rotations rather than from the unit weights, so they hold for an
 * animation that never named a unit.
 *
 * Each key is a pose of face units at full weight, and a pose's weights are the
 * least-squares share of each key in its bones' rotation vectors, jointly (as
 * for the occlusion keys, `occlusionKeyWeights`), so overlapping keys do not
 * read double. The keys were chosen not to overlap much: each reads 1 for its
 * own pose and under 0.05 for every other key's.
 */
import { type OcclusionKey, occlusionKeyBasis, occlusionKeyWeights } from "./occlusionKeys.ts";
import type { BoneRotations, RigData } from "./pose.ts";

const both = (name: string): Record<string, number> => ({
  [`Left${name}`]: 1,
  [`Right${name}`]: 1,
});

export const FACE_SIGNAL_KEYS: readonly OcclusionKey[] = [
  // The brows lifted, inner and outer: the forehead's horizontal lines.
  { id: "browRaise", faceUnits: { ...both("InnerBrowUp"), ...both("OuterBrowUp") } },
  // The brows drawn down: the vertical lines between them.
  { id: "browFurrow", faceUnits: both("BrowDown") },
  // The mouth's corners pulled up and back.
  { id: "smile", faceUnits: { MouthLeftPullUp: 1, MouthRightPullUp: 1 } },
  // The lower lids and cheeks raised: the lines fanning from the eyes' outer corners.
  { id: "squint", faceUnits: { ...both("LowerLidUp"), ...both("CheekUp") } },
  // The nose wrinkled: the lines across its bridge.
  { id: "noseWrinkle", faceUnits: { NoseWrinkler: 1 } },
  // The fold from nose to mouth deepened.
  { id: "nasolabial", faceUnits: { NasolabialDeepener: 1 } },
];

export type FaceSignalBasis = ReturnType<typeof occlusionKeyBasis>;

/** The keys' poses and the inverse of their Gram matrix; built once per rig. */
export function faceSignalBasis(rig: RigData): FaceSignalBasis {
  return occlusionKeyBasis(rig, FACE_SIGNAL_KEYS);
}

/** The signals `rotations` holds: `face.<key>` for each key, each 0 to 1. */
export function faceSignals(
  basis: FaceSignalBasis,
  rotations: BoneRotations,
): Record<string, number> {
  const w = occlusionKeyWeights(basis, rotations);
  return Object.fromEntries(FACE_SIGNAL_KEYS.map((k, i) => [`face.${k.id}`, w[i] as number]));
}
