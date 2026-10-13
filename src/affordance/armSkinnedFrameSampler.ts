/**
 * A transient, true-rendered hand-frame sampler for an arm constraint solve.
 *
 * It deliberately has no live figure, scene object, state handle or global
 * cache. A factory belongs to one immutable evaluated-geometry generation; its
 * candidate rotations are held only in caller-owned solve buffers.
 */
import {
  type FrameOut,
  landmarkFrameInto,
  landmarkUps,
  type SkinRenderVertex,
} from "../foundation/landmarks.ts";
import type { BoneRotations, RestBones } from "../rig/bones.ts";
import {
  type DualShare,
  NO_FOLDS,
  type SkinFold,
  skinNormalAt,
  skinPoseInto,
  skinPoseScratch,
  skinPositionAt,
} from "../rig/dual.ts";
import { poseShare, skinDualShare } from "../rig/skinShare.ts";
import { affordanceFrameInto, type LandmarkReader } from "./frames.ts";
import { type Affordance, CORE_AFFORDANCES } from "./registry.ts";

type SkinIndex = Uint8Array | Uint16Array;

export interface ArmSkinnedFrameSamplerInput {
  /** Identity of the immutable evaluated geometry this sampler borrows. */
  readonly generation: object;
  /** Evaluated render geometry and weights, borrowed unchanged for this sampler's lifetime. */
  readonly rest: Float32Array;
  readonly restNormals: Float32Array;
  readonly skinIndex: SkinIndex;
  readonly skinWeight: Float32Array;
  /** The worker's anchors for the same surface/evaluation generation. */
  readonly anchors: Parameters<typeof landmarkUps>[0];
  readonly restBones: RestBones;
  /** The source clip/body pose. The factory copies it to guard its baseline. */
  readonly sourceRotations: BoneRotations;
  /** The six consecutive MakeHuman bones the solver may change. */
  readonly armBones: readonly number[];
  /** Which rendered hand frame is sampled. */
  readonly side: "L" | "R";
  /** The source pose's fixed joint folds (`LiveFigure.folds`): none when it shows none. */
  readonly folds?: readonly SkinFold[];
}

export interface ArmSkinnedFrameSampler {
  /** The evaluation identity this sampler was constructed for. */
  readonly generation: object;
  /**
   * Writes the final skinned hand frame for `rotations`. `generation` must be
   * the caller's current evaluated-geometry identity, which makes stale use
   * explicit rather than silently sampling a previous body.
   */
  frame(generation: object, rotations: BoneRotations, out: FrameOut): FrameOut;
}

const armNames = (side: "L" | "R") => [
  `shoulder01.${side}`,
  `upperarm01.${side}`,
  `upperarm02.${side}`,
  `lowerarm01.${side}`,
  `lowerarm02.${side}`,
  `wrist.${side}`,
];

const hand = (side: "L" | "R"): Affordance => {
  const found = CORE_AFFORDANCES.find((entry) => entry.id === `hand.${side}`);
  if (!found) throw new Error(`arm sampler: hand.${side} affordance is unavailable`);
  return found;
};

/**
 * Creates one sampler for one solve/evaluation generation. It borrows the
 * evaluated arrays and anchors, which the caller must keep immutable and alive
 * through the solve, and copies only `sourceRotations` for its invariant check.
 */
export function createArmSkinnedFrameSampler(
  input: ArmSkinnedFrameSamplerInput,
): ArmSkinnedFrameSampler {
  const {
    generation,
    rest,
    restNormals,
    skinIndex,
    skinWeight,
    anchors,
    restBones,
    armBones,
    side,
    folds = NO_FOLDS,
  } = input;
  if (generation === null || typeof generation !== "object")
    throw new TypeError("arm sampler: generation must be an object identity");
  const expectedNames = armNames(side);
  if (armBones.length !== expectedNames.length)
    throw new RangeError("arm sampler: allowed arm bones must be the complete six-bone arm");
  armBones.forEach((bone, index) => {
    if (!Number.isInteger(bone) || restBones.names[bone] !== expectedNames[index])
      throw new RangeError("arm sampler: allowed bones must be one consecutive arm only");
  });
  const bones = restBones.names.length;
  if (input.sourceRotations.length !== bones * 4)
    throw new RangeError("arm sampler: source rotations do not match rest bones");
  for (const component of input.sourceRotations)
    if (!Number.isFinite(component))
      throw new RangeError("arm sampler: source rotations must be finite");
  if (
    rest.length !== restNormals.length ||
    rest.length / 3 !== skinIndex.length / 4 ||
    skinIndex.length !== skinWeight.length
  )
    throw new RangeError("arm sampler: evaluated geometry and skin weights do not agree");
  const source = Float32Array.from(input.sourceRotations);
  // Arm constraints cannot change the thigh's dynamic share or the hip and knee
  // folds. The factory's exact-name restriction above is what makes this source
  // share and the source pose's folds safe to hold.
  const share: DualShare = poseShare(restBones, source, skinDualShare(restBones.names));
  const scratch = skinPoseScratch(restBones, share);
  const ups = landmarkUps(anchors, rest, restNormals);
  const allowed = new Uint8Array(bones);
  for (const bone of armBones) allowed[bone] = 1;
  const skin: SkinRenderVertex = (vertex, position, normal) => {
    skinPositionAt(
      scratch.pose,
      skinIndex,
      skinWeight,
      vertex,
      rest[vertex * 3] as number,
      rest[vertex * 3 + 1] as number,
      rest[vertex * 3 + 2] as number,
      position,
      0,
      folds,
    );
    if (!normal) return;
    skinNormalAt(
      scratch.pose,
      skinIndex,
      skinWeight,
      vertex,
      restNormals[vertex * 3] as number,
      restNormals[vertex * 3 + 1] as number,
      restNormals[vertex * 3 + 2] as number,
      normal,
      0,
      folds,
    );
  };
  const read: LandmarkReader = (id, out) =>
    landmarkFrameInto(id, anchors, ups, skin, scratch.skeleton, out);
  const affordance = hand(side);

  return {
    generation,
    frame(currentGeneration, rotations, out) {
      if (currentGeneration !== generation)
        throw new Error("arm sampler: evaluated geometry generation is stale");
      if (rotations.length !== source.length)
        throw new RangeError("arm sampler: candidate rotations do not match rest bones");
      for (let bone = 0; bone < bones; bone++) {
        const at = bone * 4;
        for (let component = 0; component < 4; component++) {
          if (!Number.isFinite(rotations[at + component] as number))
            throw new RangeError("arm sampler: candidate rotations must be finite");
          if (allowed[bone]) continue;
          if (rotations[at + component] !== source[at + component])
            throw new RangeError("arm sampler: candidate changed a non-arm pose bone");
        }
      }
      skinPoseInto(restBones, rotations, share, scratch);
      return affordanceFrameInto(affordance, read, out);
    },
  };
}
