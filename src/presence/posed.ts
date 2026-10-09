/**
 * Presence of a posed figure (docs/PRESENCE.md): the same description as
 * `presenceFromEvaluation`, from the skeleton's pose rather than the rest body.
 *
 * The control mesh is skinned once per evaluation and pose (the renderer's
 * linear blend skinning, on the CPU), which grounding already needs: the lift
 * that puts a crouching or kneeling figure's lowest point on the floor is the
 * lowest point of exactly this mesh. Anchors are the same joint centroids over
 * it, the footprint is whatever of the body touches the ground, and bounds are
 * its box. Framework-free.
 */
import type { Evaluation } from "../model/humanoidModel.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { type BoneRotations, type RigSkin, restBonesFrom, skinPositions } from "../rig/pose.ts";
import {
  FALLBACK_FOOT_RADIUS,
  figureTraits,
  type Placement,
  type PresenceJoints,
  placePresence,
  soleFootprints,
} from "./fromEvaluation.ts";
import type { FigurePresence, Vec3 } from "./presence.ts";

/** What posing a figure needs from the rig: the main thread has it from `ReadyInfo.rig`. */
export interface PosedRig {
  /** Bone names, in skin-weight order. */
  bones: readonly string[];
  parents: Int16Array;
  skin: RigSkin;
}

interface Skinned {
  skin: RigSkin;
  rotations: BoneRotations;
  posed: Float32Array;
}

const skinned = new WeakMap<Evaluation, Skinned>();

/**
 * The evaluation's control mesh in the pose, in the figure's own frame (not yet
 * lifted onto the floor). The result is cached on the evaluation: asking again
 * for the same pose returns the same array without skinning, so grounding and
 * presence share one pass. A different pose of the same evaluation overwrites
 * that array, so use the result before asking for another.
 */
export function posedControl(
  rig: PosedRig,
  evaluation: Evaluation,
  rotations: BoneRotations,
): Float32Array {
  const entry = skinned.get(evaluation);
  if (entry && entry.skin === rig.skin && entry.rotations === rotations) return entry.posed;
  const posed =
    entry?.skin === rig.skin ? entry.posed : new Float32Array(evaluation.control.length);
  skinPositions(
    restBonesFrom(rig.bones, rig.parents, evaluation.boneHeads),
    rotations,
    evaluation.control,
    rig.skin.skinIndex,
    rig.skin.skinWeight,
    posed,
  );
  skinned.set(evaluation, { skin: rig.skin, rotations, posed });
  return posed;
}

/** The lift (metres) that puts the posed body's lowest point on y = 0. */
export function groundOffsetOf(posed: Float32Array, bodyVertices: Uint32Array): number {
  let minY = Number.POSITIVE_INFINITY;
  for (let i = 0; i < bodyVertices.length; i++) {
    const y = posed[(bodyVertices[i] as number) * 3 + 1] as number;
    if (y < minY) minY = y;
  }
  return -minY;
}

interface Inset {
  min: Vec3;
  max: Vec3;
}

const insets = new WeakMap<Evaluation, Inset>();

/**
 * How far the rest figure's rendered surface (subdivided, with its
 * attachments) sits inside its control mesh's box, per side. A posed box of
 * control vertices is widened by it, so a pose that rotates nothing reports
 * exactly the rest figure's bounds; the box is not re-derived from the surface
 * for every pose, which would skin the whole subdivided body.
 */
function surfaceInset(rig: PosedRig, ev: Evaluation): Inset {
  const known = insets.get(ev);
  if (known) return known;
  const control = box(ev.control, rig.skin.bodyVertices);
  const surface: Inset = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const points of [ev.positions, ...ev.attachments.map((a) => a.positions)])
    for (let i = 0; i < points.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const c = points[i + k] as number;
        if (c < (surface.min[k] as number)) surface.min[k] = c;
        if (c > (surface.max[k] as number)) surface.max[k] = c;
      }
  const inset: Inset = {
    min: [0, 1, 2].map((k) => (surface.min[k] as number) - (control.min[k] as number)) as Vec3,
    max: [0, 1, 2].map((k) => (surface.max[k] as number) - (control.max[k] as number)) as Vec3,
  };
  insets.set(ev, inset);
  return inset;
}

function box(positions: Float32Array, vertices: Uint32Array): Inset {
  const out: Inset = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (let n = 0; n < vertices.length; n++) {
    const i = (vertices[n] as number) * 3;
    for (let k = 0; k < 3; k++) {
      const c = positions[i + k] as number;
      if (c < (out.min[k] as number)) out.min[k] = c;
      if (c > (out.max[k] as number)) out.max[k] = c;
    }
  }
  return out;
}

/**
 * A figure's presence in a pose: anchors from the posed joints, the ground
 * contact from whatever of the body touches the floor (a kneeling figure's
 * knees, not its feet), bounds from the posed body, and the rest as in
 * `presenceFromEvaluation`, all moved onto `placement`. `rotations` is the pose
 * as the renderer applies it (`bodyPoseRotations`, `composeRotations`).
 *
 * Skins the control mesh once per evaluation and pose (see `posedControl`), so
 * call it when the evaluation or the pose changes, not for a figure that only
 * moves: re-place the result with `placePresence` for that.
 */
export function presenceFromPose(input: {
  evaluation: Evaluation;
  recipe: Recipe;
  joints: PresenceJoints;
  rig: PosedRig;
  rotations: BoneRotations;
  placement: Placement;
}): FigurePresence {
  const { evaluation, recipe, joints, rig, rotations, placement } = input;
  const posed = posedControl(rig, evaluation, rotations);
  const body = rig.skin.bodyVertices;
  const lift = groundOffsetOf(posed, body);
  const traits = figureTraits(posed, lift, joints, recipe);

  const posedBox = box(posed, body);
  const inset = surfaceInset(rig, evaluation);
  const min = [0, 1, 2].map((k) => (posedBox.min[k] as number) + (inset.min[k] as number)) as Vec3;
  const max = [0, 1, 2].map((k) => (posedBox.max[k] as number) + (inset.max[k] as number)) as Vec3;
  min[1] += lift;
  max[1] += lift;

  const contact = soleFootprints(posed, lift, body);
  const feet: [number, number][] = [
    [traits.anchors.leftFoot[0], traits.anchors.leftFoot[2]],
    [traits.anchors.rightFoot[0], traits.anchors.rightFoot[2]],
  ];
  return placePresence(
    {
      id: "",
      position: [0, 0, 0],
      facing: [0, 0, 1],
      bounds: { min, max },
      footprint: contact ?? { points: feet, radius: FALLBACK_FOOT_RADIUS },
      ...traits,
    },
    placement,
  );
}
