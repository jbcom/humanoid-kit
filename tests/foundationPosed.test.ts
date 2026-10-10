/**
 * The posed body on the CPU (src/foundation/posed.ts): the rest pose leaves
 * every vertex where the evaluation put it, a pose moves the skin as it moves
 * the bones, and the seams' duplicates move together. That `skinPositions` is
 * what the shader draws is tests/browser/dualSkinning.test.ts's.
 */
import { describe, expect, it } from "vitest";
import { REST_POSE } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const recipe = createRecipe({ macros: { age: 25, gender: 1 } });

const maxY = (p: Float32Array) => {
  let m = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < p.length; i += 3) m = Math.max(m, p[i] as number);
  return m;
};

describe("the posed body", () => {
  it("is the evaluated body itself at rest", () => {
    const body = posedSurface(model, recipe, REST_POSE);
    let worst = 0;
    for (let i = 0; i < body.positions.length; i++)
      worst = Math.max(worst, Math.abs((body.positions[i] as number) - (body.rest[i] as number)));
    expect(worst).toBeLessThan(1e-6);
    expect(body.positions.length).toBe(body.vertexCount * 3);
    expect(body.index.reduce((m, i) => Math.max(m, i), 0)).toBeLessThan(body.vertexCount);
  });

  it("raises the hands above the head in the overhead pose", () => {
    const body = posedSurface(model, recipe, "overhead");
    expect(maxY(body.positions)).toBeGreaterThan(maxY(body.rest) + 0.05);
  });

  it("keeps the seams' duplicates together in a pose", () => {
    const body = posedSurface(model, recipe, "squat");
    let seams = 0;
    let worst = 0;
    for (let v = 0; v < body.vertexCount; v++) {
      const w = body.weld[v] as number;
      if (w === v) continue;
      seams++;
      for (let k = 0; k < 3; k++)
        worst = Math.max(
          worst,
          Math.abs((body.positions[v * 3 + k] as number) - (body.positions[w * 3 + k] as number)),
        );
    }
    expect(seams).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-6);
  });
});
