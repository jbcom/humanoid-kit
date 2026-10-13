/**
 * The body posed on the CPU exactly as the renderer draws it (docs/ARCHITECTURE.md,
 * "The foundation harness"): the recipe evaluated, the skeleton fitted to it,
 * the render surface skinned by `skinPositions`, the CPU reference of the
 * shader's blend of linear and dual quaternion skinning with its
 * pose-dependent shares, and its normals by `skinNormals`, the same blend. A
 * corrective added to the renderer is added here, or the foundation measures
 * a body nobody draws.
 */
import type { AdultSurfaceTopology, HumanoidModel } from "../model/humanoidModel.ts";
import { skinOfEvaluation } from "../model/reservoirSkin.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { FOLD_JOINTS, foldFlexion } from "../rig/folds.ts";
import { flexedPast, renderFold, type SurfaceFold } from "../rig/jointFold.ts";
import {
  type BoneRotations,
  bodyPoseRotations,
  IDENTITY_POSE,
  posedBoneHeads,
  type RestBones,
  restBones,
  rigData,
  skinNormals,
  skinPositions,
} from "../rig/pose.ts";
import { REST_POSE } from "./permutations.ts";

/** A posed body surface: render vertices, their triangles, and the seams that split them. */
export interface PosedBody {
  /** Which body surface: the base, or the adult surface for a figure 18 or over. */
  readonly surface: "base" | "adult";
  /** Triangles over the render vertices, three indices each. */
  readonly index: Uint32Array;
  /** Render vertex positions at rest, model space. */
  readonly rest: Float32Array;
  /** Render vertex normals at rest. */
  readonly restNormals: Float32Array;
  /** Render vertex positions in the pose, model space (before the ground lift). */
  readonly positions: Float32Array;
  /** Render vertex normals in the pose, skinned as the renderer skins them. */
  readonly normals: Float32Array;
  /**
   * Each render vertex's representative among those a UV seam splits from one
   * surface vertex (`HumanoidModel.renderWeld`): the surface's connectivity, its
   * seams where two differ. Found by rest position instead, distinct vertices that
   * meet at rest were welded too: a closed canal's two lips, a collapsed
   * reservoir's rings on their loop, and their separating in a pose read as a
   * torn seam.
   */
  readonly weld: Uint32Array;
  /** Render vertex count. */
  readonly vertexCount: number;
  /** Four bone indices and weights per render vertex. */
  readonly skinIndex: Uint16Array;
  readonly skinWeight: Float32Array;
  /** The skeleton fitted to the figure at rest, and the pose's rotation per bone. */
  readonly bones: RestBones;
  readonly rotations: BoneRotations;
  /** Each bone's head in the pose, bones × 3. */
  readonly heads: Float32Array;
  /** Morphed control positions (base topology), as the evaluation gives them. */
  readonly control: Float32Array;
  /** The adult surface's canals (`AdultSurfaceTopology.canals`); null on the base surface. */
  readonly canals: AdultSurfaceTopology["canals"] | null;
}

/** The body of `recipe` in `pose`: `REST_POSE`, or a whole-body pose of the body pack by name. */
export function posedSurface(model: HumanoidModel, recipe: Recipe, pose: string): PosedBody {
  const rig = rigData(model.assets);
  const rotations =
    pose === REST_POSE ? IDENTITY_POSE(rig.bones.length) : bodyPoseRotations(rig, pose);
  return surfacePoser(model, recipe)(rotations);
}

/**
 * Poses `recipe`'s body in any rotations (a clip's frame, as the animator
 * writes it), evaluating the recipe once for every pose asked for: what
 * `posedSurface` does for a named pose.
 */
export function surfacePoser(
  model: HumanoidModel,
  recipe: Recipe,
): (rotations: BoneRotations) => PosedBody {
  const ev = model.evaluate(recipe);
  // The evaluation's arrays are the model's scratch: kept before anything else evaluates.
  const rest = Float32Array.from(ev.positions);
  const restNormals = Float32Array.from(ev.normals);
  const control = Float32Array.from(ev.control);
  const surface = ev.surface;
  const topology = surface === "adult" ? model.adultSurface() : model.topology().body;
  if (!topology) throw new Error("an adult evaluation without the adult surface");
  const bones = restBones(model.assets, control);
  // The weights this figure is skinned by: a reservoir its detail drew out moves with its root.
  const { skinIndex, skinWeight } = skinOfEvaluation(ev, topology);
  const weld = model.renderWeld(surface);
  let solved: ReturnType<typeof renderFold>[] | null = null;
  return (pose) => {
    const rotations = Float32Array.from(pose);
    // The folds as the renderer has them: asked for once a joint of the pose is flexed past its fold's start
    // (`<Humanoid>` asks so), and adding nothing in a pose that flexes none, which is not solved for.
    const flexed = FOLD_JOINTS.some((joint) =>
      flexedPast(joint, foldFlexion(joint, bones, rotations)),
    );
    if (flexed) solved ??= solvedFolds(model, recipe).map(renderFold);
    const folds = flexed ? (solved ?? []) : [];
    const n = rest.length;
    return {
      surface,
      index: topology.index,
      rest,
      restNormals,
      positions: skinPositions(
        bones,
        rotations,
        rest,
        skinIndex,
        skinWeight,
        new Float32Array(n),
        folds,
      ),
      normals: skinNormals(
        bones,
        rotations,
        restNormals,
        skinIndex,
        skinWeight,
        new Float32Array(n),
        folds,
      ),
      weld,
      vertexCount: topology.vertexCount,
      skinIndex,
      skinWeight,
      bones,
      rotations,
      heads: posedBoneHeads(bones, rotations),
      control,
      canals: "canals" in topology ? topology.canals : null,
    };
  };
}

/**
 * The figure's joint folds on its body surface (`HumanoidModel.folds`), solved
 * to the end at once: the renderer's correctives for a flexed hip and a bent
 * knee, which the posed body must carry as the drawn one does.
 */
export function solvedFolds(model: HumanoidModel, recipe: Recipe): SurfaceFold[] {
  const solve = model.folds(recipe);
  let step = solve.next();
  while (!step.done) step = solve.next();
  return step.value.folds;
}
