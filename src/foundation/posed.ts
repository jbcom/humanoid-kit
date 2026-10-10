/**
 * The body posed on the CPU exactly as the renderer draws it (docs/ARCHITECTURE.md,
 * "The foundation harness"): the recipe evaluated, the skeleton fitted to it,
 * the render surface skinned by `skinPositions`, the CPU reference of the
 * shader's blend of linear and dual quaternion skinning with its
 * pose-dependent shares, and its normals by `skinNormals`, the same blend. A
 * corrective added to the renderer is added here, or the foundation measures
 * a body nobody draws.
 */
import type { HumanoidModel } from "../model/humanoidModel.ts";
import type { Recipe } from "../recipe/recipe.ts";
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
   * Each render vertex's representative among those at its rest position: the
   * lowest index of them. Vertices a UV seam splits share one, so `weld` gives
   * the surface's connectivity, and its seams are where two differ.
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
}

/** The lowest render index at each rest position: the seams' duplicates share one. */
function weldOf(rest: Float32Array): Uint32Array {
  const n = rest.length / 3;
  const first = new Map<string, number>();
  const out = new Uint32Array(n);
  for (let v = 0; v < n; v++) {
    const key = `${rest[v * 3]},${rest[v * 3 + 1]},${rest[v * 3 + 2]}`;
    const known = first.get(key);
    if (known === undefined) first.set(key, v);
    out[v] = known ?? v;
  }
  return out;
}

/** The body of `recipe` in `pose`: `REST_POSE`, or a whole-body pose of the body pack by name. */
export function posedSurface(model: HumanoidModel, recipe: Recipe, pose: string): PosedBody {
  const ev = model.evaluate(recipe);
  const topology = ev.surface === "adult" ? model.adultSurface() : model.topology().body;
  if (!topology) throw new Error("an adult evaluation without the adult surface");
  const rig = rigData(model.assets);
  const bones = restBones(model.assets, ev.control);
  const rotations =
    pose === REST_POSE ? IDENTITY_POSE(rig.bones.length) : bodyPoseRotations(rig, pose);
  const { skinIndex, skinWeight } = topology;
  const n = ev.positions.length;
  return {
    surface: ev.surface,
    index: topology.index,
    rest: Float32Array.from(ev.positions),
    restNormals: Float32Array.from(ev.normals),
    positions: skinPositions(
      bones,
      rotations,
      ev.positions,
      skinIndex,
      skinWeight,
      new Float32Array(n),
    ),
    normals: skinNormals(bones, rotations, ev.normals, skinIndex, skinWeight, new Float32Array(n)),
    weld: weldOf(ev.positions),
    vertexCount: topology.vertexCount,
    skinIndex,
    skinWeight,
    bones,
    rotations,
    heads: posedBoneHeads(bones, rotations),
    control: Float32Array.from(ev.control),
  };
}
