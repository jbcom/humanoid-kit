/**
 * A transient, true-rendered hand-frame sampler for an arm constraint solve.
 * Its effector is the hand's grip by default (hand-to-hand contact) or any
 * other affordance or landmark of the hand, such as a finger pad touching the
 * figure's own body (`solveSiteContact`), which also reads the touched site
 * from the same candidate pose.
 *
 * It deliberately has no live figure, scene object, state handle or global
 * cache. A factory belongs to one immutable evaluated-geometry generation; its
 * candidate rotations are held only in caller-owned solve buffers.
 */
import { SKIN_INFLUENCES } from "../format/assetFormat.ts";
import {
  type FrameOut,
  LANDMARK_IDS,
  type LandmarkId,
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
  /** Which arm the solve moves, and whose hand `effector` defaults to. */
  readonly side: "L" | "R";
  /**
   * The touching point `frame` samples: a core affordance id, or a landmark id
   * (a finger pad, the palm). Defaults to the side's grip, `hand.L` or `hand.R`,
   * which is what hand-to-hand contact closes on.
   */
  readonly effector?: string;
  /**
   * That side's finger bones (`finger1-1` to `finger5-3`) the candidate poses may
   * also change: a contact's hand shape, blended by its weight. None by default.
   */
  readonly fingerBones?: readonly number[];
  /** The drawn skinning path: mixed by default, or linear for a custom material. */
  readonly skinMode?: "mixed" | "linear";
  /** The source pose's fixed joint folds (`LiveFigure.folds`): none when it shows none. */
  readonly folds?: readonly SkinFold[];
}

export interface ArmSkinnedFrameSampler {
  /** The evaluation identity this sampler was constructed for. */
  readonly generation: object;
  /**
   * Replaces the copied source baseline for this same immutable geometry generation.
   * Recomputes dynamic skin shares while retaining geometry and skinning scratch.
   * Supplied folds remain fixed; rebuild the sampler if those folds change.
   * Invalid input leaves the previous baseline intact.
   */
  resetSource(generation: object, rotations: BoneRotations): void;
  /**
   * Writes the final skinned hand frame for `rotations`. `generation` must be
   * the caller's current evaluated-geometry identity, which makes stale use
   * explicit rather than silently sampling a previous body.
   */
  frame(generation: object, rotations: BoneRotations, out: FrameOut): FrameOut;
  /**
   * Writes the effector's frame into `effector` and landmark `site`'s into
   * `site`, both skinned once for the same `rotations`: a target on the
   * figure's own body that the arm's pose may move (docs/SELF-CONTACT.md, R4).
   */
  frames(
    generation: object,
    rotations: BoneRotations,
    effector: FrameOut,
    site: LandmarkId,
    siteOut: FrameOut,
  ): void;
}

const armNames = (side: "L" | "R") => [
  `shoulder01.${side}`,
  `upperarm01.${side}`,
  `upperarm02.${side}`,
  `lowerarm01.${side}`,
  `lowerarm02.${side}`,
  `wrist.${side}`,
];

/**
 * The affordance an effector id names: a core affordance's own (so `hand.R`
 * keeps its grip frame), else a landmark's, read as a contact at that landmark.
 */
const effectorOf = (id: string): Affordance => {
  const found = CORE_AFFORDANCES.find((entry) => entry.id === id);
  if (found) return found;
  if ((LANDMARK_IDS as readonly string[]).includes(id))
    return { id, kind: "contact", at: { landmark: id as LandmarkId }, adult: false };
  throw new RangeError(`arm sampler: no affordance or landmark ${id}`);
};

const fingerName = (side: "L" | "R") => new RegExp(`^finger[1-5]-[1-3]\\.${side}$`);

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
    fingerBones = [],
    skinMode = "mixed",
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
  const ownFinger = fingerName(side);
  for (const bone of fingerBones)
    if (!Number.isInteger(bone) || !ownFinger.test(restBones.names[bone] ?? ""))
      throw new RangeError("arm sampler: allowed finger bones must be the same hand's fingers");
  const bones = restBones.names.length;
  if (input.sourceRotations.length !== bones * 4)
    throw new RangeError("arm sampler: source rotations do not match rest bones");
  for (const component of input.sourceRotations)
    if (!Number.isFinite(component))
      throw new RangeError("arm sampler: source rotations must be finite");
  if (
    rest.length !== restNormals.length ||
    rest.length / 3 !== skinIndex.length / SKIN_INFLUENCES ||
    skinIndex.length !== skinWeight.length
  )
    throw new RangeError("arm sampler: evaluated geometry and skin weights do not agree");
  const source = Float32Array.from(input.sourceRotations);
  // Arm constraints cannot change the thigh's dynamic share or the hip and knee
  // folds. The factory's exact-name restriction above is what makes this source
  // share and the source pose's folds safe to hold.
  const baseShare = skinDualShare(restBones.names);
  let share: DualShare = skinMode === "linear" ? 0 : poseShare(restBones, source, baseShare);
  const scratch = skinPoseScratch(restBones, share);
  const ups = landmarkUps(anchors, rest, restNormals);
  const allowed = new Uint8Array(bones);
  for (const bone of armBones) allowed[bone] = 1;
  for (const bone of fingerBones) allowed[bone] = 1;
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
  const affordance = effectorOf(input.effector ?? `hand.${side}`);
  /** Checks a candidate against the source's guarded bones, then skins it. */
  const pose = (currentGeneration: object, rotations: BoneRotations) => {
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
  };

  return {
    generation,
    resetSource(currentGeneration, rotations) {
      if (currentGeneration !== generation)
        throw new Error("arm sampler: evaluated geometry generation is stale");
      if (rotations.length !== source.length)
        throw new RangeError("arm sampler: source rotations do not match rest bones");
      for (const component of rotations)
        if (!Number.isFinite(component))
          throw new RangeError("arm sampler: source rotations must be finite");
      const nextShare = skinMode === "linear" ? 0 : poseShare(restBones, rotations, baseShare);
      source.set(rotations);
      share = nextShare;
    },
    frame(currentGeneration, rotations, out) {
      pose(currentGeneration, rotations);
      return affordanceFrameInto(affordance, read, out);
    },
    frames(currentGeneration, rotations, effector, site, siteOut) {
      pose(currentGeneration, rotations);
      affordanceFrameInto(affordance, read, effector);
      read(site, siteOut);
    },
  };
}
