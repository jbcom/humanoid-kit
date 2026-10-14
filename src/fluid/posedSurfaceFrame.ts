/** Internal adapter from the renderer-matching CPU skinning path to fluid transport. */
import type { PosedBody } from "../foundation/posed.ts";
import { posedSurface } from "../foundation/posed.ts";
import type { HumanoidModel } from "../model/humanoidModel.ts";
import type { Recipe } from "../recipe/recipe.ts";
import type { PosedSurfaceFrame } from "./attachedField.ts";
import { type FluidState, FluidStateError } from "./state.ts";

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
  if (
    body.index.length !== state.topology.triangleCount * 3 ||
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
