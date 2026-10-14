import { describe, expect, it } from "vitest";
import { fluidFrameFromPose } from "../src/fluid/posedSurfaceFrame.ts";
import { FluidState } from "../src/fluid/state.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyManifest, loadFixtureAssets } from "./fixtures.ts";

describe("fluid posed surface adapter", () =>
  it("uses renderer-matching posed local coordinates and the model index", () => {
    const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 0 });
    const recipe = createRecipe({ macros: { age: 25 } });
    const index = model.bodyIndex("base");
    const state = new FluidState({
      figureId: "f",
      seed: 1,
      fixedStepSeconds: 1 / 60,
      topology: {
        topology: bodyManifest.topology,
        bodySha256: bodyManifest.body.sha256,
        triangleCount: index.length / 3,
      },
      recipe,
      assets: loadFixtureAssets(),
    });
    const frame = fluidFrameFromPose(state, model, recipe, "flexed");
    const posed = posedSurface(model, recipe, "flexed");
    expect(frame.index).toBe(index);
    expect(frame.positions).toEqual(posed.positions);
    expect(frame.positions).not.toEqual(model.evaluate(recipe).positions);
  }));
