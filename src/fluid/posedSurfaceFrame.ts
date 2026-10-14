/** Internal adapter from the renderer-matching CPU skinning path to fluid transport. */
import type { PosedBody } from "../foundation/posed.ts";
import { posedSurface } from "../foundation/posed.ts";
import type { HumanoidModel } from "../model/humanoidModel.ts";
import type { Recipe } from "../recipe/recipe.ts";
import type { PosedSurfaceFrame } from "./attachedField.ts";
import { type FluidState, FluidStateError, type FluidSurfaceAnchor } from "./state.ts";

/**
 * Posed model-local coordinates, before React's ground lift or any world transform.
 * This matches `skinPositions`/`skinNormals`, the renderer's CPU reference.
 */
export function fluidFrameFromPosedBody(
  state: FluidState,
  model: HumanoidModel,
  body: PosedBody,
): PosedSurfaceFrame {
  if (
    model.assets.manifest.topology !== state.topology.topology ||
    model.assets.manifest.body.sha256 !== state.topology.bodySha256
  )
    throw new FluidStateError("fluid state does not bind to this model assets body");
  const modelIndex = model.bodyIndex(body.surface);
  if (
    body.index.length !== state.topology.triangleCount * 3 ||
    body.index.length !== modelIndex.length ||
    body.index.some((vertex, index) => vertex !== modelIndex[index]) ||
    body.vertexCount * 3 !== body.positions.length ||
    body.normals.length !== body.positions.length
  )
    throw new FluidStateError("posed body does not match fluid state surface topology");
  return {
    topology: state.topology.topology,
    bodySha256: state.topology.bodySha256,
    surface: body.surface,
    positions: body.positions,
    normals: body.normals,
    index: body.index,
  };
}

/** Builds the frame through `foundation/posed.ts`, never from unskinned evaluation positions. */
export function fluidFrameFromPose(
  state: FluidState,
  model: HumanoidModel,
  recipe: Recipe,
  pose: string,
): PosedSurfaceFrame {
  return fluidFrameFromPosedBody(state, model, posedSurface(model, recipe, pose));
}

/** Resolves one stable fluid anchor on this frame's actually skinned surface. */
export function fluidAnchorPoint(
  frame: PosedSurfaceFrame,
  anchor: FluidSurfaceAnchor,
): [number, number, number] {
  if (frame.topology !== anchor.topology || frame.bodySha256 !== anchor.bodySha256)
    throw new FluidStateError("fluid anchor does not match posed fluid frame topology");
  if (
    !Number.isSafeInteger(anchor.triangle) ||
    anchor.triangle < 0 ||
    anchor.triangle >= frame.index.length / 3 ||
    anchor.barycentric.length !== 3 ||
    anchor.barycentric.some((weight) => !Number.isFinite(weight) || weight < 0) ||
    Math.abs(anchor.barycentric[0] + anchor.barycentric[1] + anchor.barycentric[2] - 1) > 1e-9
  )
    throw new FluidStateError("fluid anchor is invalid for posed fluid frame");
  const at = anchor.triangle * 3;
  const vertices = [frame.index[at], frame.index[at + 1], frame.index[at + 2]] as const;
  return [0, 1, 2].map((axis) =>
    vertices.reduce<number>(
      (sum, vertex, index) =>
        sum +
        (frame.positions[(vertex as number) * 3 + axis] as number) *
          (anchor.barycentric[index] as number),
      0,
    ),
  ) as [number, number, number];
}
