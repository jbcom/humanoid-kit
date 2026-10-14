import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const chestRecipe = (age: number) =>
  createRecipe({
    macros: { age, gender: 1, breastSize: 0.75, breastFirmness: 0.5 },
    regionalMacros: { breastL: { breastPresence: 1 }, breastR: { breastPresence: 1 } },
  });

describe("source chest cache", () => {
  it("bounds exact-age libraries without changing an evicted age's source result", () => {
    const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 0 });
    const first = Float32Array.from(model.evaluate(chestRecipe(25)).control);
    for (const age of [30, 35, 40]) model.evaluate(chestRecipe(age));

    const cache = (model as unknown as { chestCache: Map<number, unknown> }).chestCache;
    expect(cache.size).toBeLessThanOrEqual(3);
    expect(cache.has(25)).toBe(false);
    expect(model.evaluate(chestRecipe(25)).control).toEqual(first);
  });
});
