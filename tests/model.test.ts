import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });

const finite = (a: Float32Array) => a.every((x) => Number.isFinite(x));

describe("HumanoidModel", () => {
  it("evaluates the default recipe to finite, grounded geometry", () => {
    const ev = model.evaluate(createRecipe());
    expect(finite(ev.positions)).toBe(true);
    expect(finite(ev.normals)).toBe(true);
    expect(ev.groundOffset).toBeGreaterThan(0.7);
  });

  it("evaluates regional macro overrides to finite geometry that differs from the uniform recipe", () => {
    const uniform = model.evaluate(createRecipe({ macros: { gender: 0.15, age: 30 } }));
    const regional = model.evaluate(
      createRecipe({
        macros: { gender: 0.15, age: 30 },
        regionalMacros: { head: { gender: 0.95 }, chest: { gender: 0.9 } },
      }),
    );
    expect(finite(regional.positions)).toBe(true);
    let maxDiff = 0;
    for (let i = 0; i < uniform.positions.length; i++) {
      maxDiff = Math.max(
        maxDiff,
        Math.abs((uniform.positions[i] as number) - (regional.positions[i] as number)),
      );
    }
    expect(maxDiff).toBeGreaterThan(0.001);
  });
});
