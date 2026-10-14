import { describe, expect, it } from "vitest";
import { AttachedFluidField } from "../src/fluid/attachedField.ts";
import {
  fluidAnchorPoint,
  fluidFrameFromPose,
  fluidFrameFromPosedBody,
} from "../src/fluid/posedSurfaceFrame.ts";
import { FluidState, type FluidSurfaceAnchor } from "../src/fluid/state.ts";
import { REST_POSE } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyManifest, loadFixtureAssets } from "./fixtures.ts";
import { centreHeight, edgeNeighbours, lowestNeighbour } from "./posedFluidTransportProof.ts";

const pointDistance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );

function fluidState(model: HumanoidModel, recipe: ReturnType<typeof createRecipe>): FluidState {
  const index = model.bodyIndex("base");
  return new FluidState({
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
}

function mostMovedAnchor(
  rest: Float32Array,
  flexed: Float32Array,
  index: Uint32Array,
): FluidSurfaceAnchor {
  let vertex = 0;
  let distance = -1;
  for (let v = 0; v < rest.length / 3; v++) {
    const at = v * 3;
    const moved = Math.hypot(
      (flexed[at] as number) - (rest[at] as number),
      (flexed[at + 1] as number) - (rest[at + 1] as number),
      (flexed[at + 2] as number) - (rest[at + 2] as number),
    );
    if (moved > distance) {
      vertex = v;
      distance = moved;
    }
  }
  const at = index.indexOf(vertex);
  if (at < 0) throw new Error("the most moved render vertex has no fluid triangle");
  const corner = at % 3;
  return {
    kind: "surface",
    topology: bodyManifest.topology,
    bodySha256: bodyManifest.body.sha256,
    triangle: Math.floor(at / 3),
    barycentric: [corner === 0 ? 1 : 0, corner === 1 ? 1 : 0, corner === 2 ? 1 : 0],
  };
}

describe("fluid posed surface adapter", () => {
  it("transfers exact mass to the actual flexed downhill neighbour rather than the rest neighbour", () => {
    const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
    const recipe = createRecipe({ macros: { age: 25 } });
    const state = fluidState(model, recipe);
    const rest = fluidFrameFromPose(state, model, recipe, REST_POSE);
    const flexed = fluidFrameFromPose(state, model, recipe, "flexed");
    const neighbours = edgeNeighbours(rest.index);
    const triangle = neighbours.findIndex((_, candidate) => {
      const downhill = lowestNeighbour(flexed, neighbours, candidate);
      return downhill !== undefined && downhill !== lowestNeighbour(rest, neighbours, candidate);
    });
    expect(triangle, "the real pose changes a local downhill route").toBeGreaterThanOrEqual(0);
    const destination = lowestNeighbour(flexed, neighbours, triangle) as number;
    expect(centreHeight(flexed, destination)).toBeLessThan(centreHeight(flexed, triangle));
    const anchor: FluidSurfaceAnchor = {
      kind: "surface",
      topology: bodyManifest.topology,
      bodySha256: bodyManifest.body.sha256,
      triangle,
      barycentric: [1 / 3, 1 / 3, 1 / 3],
    };
    state.registerSource({ id: "posed-flow", materialId: "water", anchor, rateKgPerSecond: 0 });
    const field = new AttachedFluidField(state, rest, {
      maxCells: 2,
      mobilityPerSecond: 1,
      gravity: [0, -1, 0],
    });
    field.inject("posed-flow", anchor, "water", 0.0005);
    const before = state.snapshot();
    field.step(flexed, 0.5);
    expect(field.frame().find((cell) => cell.triangle === triangle)?.massKg).toBe(0.00025);
    expect(field.frame().find((cell) => cell.triangle === destination)?.massKg).toBe(0.00025);
    expect(field.coverageSnapshot(flexed).attachedKg).toBe(0.0005);
    expect(state.snapshot()).toEqual(before);
    field.step(flexed, 0);
    expect(state.snapshot()).toEqual(before);
  });
  it("uses renderer-matching posed local coordinates and the model index", () => {
    const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
    const recipe = createRecipe({ macros: { age: 25 } });
    const index = model.bodyIndex("base");
    const state = fluidState(model, recipe);
    const frame = fluidFrameFromPose(state, model, recipe, "flexed");
    const posed = posedSurface(model, recipe, "flexed");
    expect(frame.index).toBe(index);
    expect(frame.positions).toEqual(posed.positions);
    expect(frame.positions).not.toEqual(model.evaluate(recipe).positions);
  });

  it("moves an anchored fluid point with the renderer-equivalent flexed skin", () => {
    const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
    const recipe = createRecipe({ macros: { age: 25 } });
    const state = fluidState(model, recipe);
    const rest = fluidFrameFromPose(state, model, recipe, REST_POSE);
    const flexed = fluidFrameFromPose(state, model, recipe, "flexed");
    const anchor = mostMovedAnchor(rest.positions, flexed.positions, rest.index);
    const restPoint = fluidAnchorPoint(rest, anchor);
    const flexedPoint = fluidAnchorPoint(flexed, anchor);
    const displacement = pointDistance(restPoint, flexedPoint);
    expect(displacement).toBeGreaterThan(0.01);
    // The anchor is at one render vertex, so this is an exact skinned position,
    // not an independently evaluated rest-space approximation.
    const corner = anchor.barycentric.indexOf(1);
    const vertex = flexed.index[anchor.triangle * 3 + corner] as number;
    expect(flexedPoint).toEqual(Array.from(flexed.positions.subarray(vertex * 3, vertex * 3 + 3)));
    if (process.env.HK_FLUID_DEBUG_POINT === "1")
      console.info(
        "fluid-posed-point",
        JSON.stringify({ triangle: anchor.triangle, restPoint, flexedPoint, displacement }),
      );
  });

  it("rejects a body whose index is not the model's renderer topology", () => {
    const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
    const recipe = createRecipe({ macros: { age: 25 } });
    const state = fluidState(model, recipe);
    const body = posedSurface(model, recipe, "flexed");
    const index = Uint32Array.from(body.index);
    [index[0], index[1]] = [index[1] as number, index[0] as number];
    expect(() => fluidFrameFromPosedBody(state, model, { ...body, index })).toThrow(
      "surface topology",
    );
  });
});
