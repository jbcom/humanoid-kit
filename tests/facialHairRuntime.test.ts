import { describe, expect, it } from "vitest";
import { RecipeError } from "../src/makehuman/recipeMorph.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { assertValidRecipe, RecipeValidationError } from "../src/recipe/validate.ts";
import { loadHairFixtureAssets } from "./hairFixtures.ts";

const model = new HumanoidModel(loadHairFixtureAssets());

/**
 * Authored facial hair is a separate, multi-item slot: a moustache and beard
 * may be worn together, while an older recipe that omits it stays unchanged.
 */
const facial = (styles: readonly string[]) =>
  createRecipe({ hair: { style: null }, facialHair: styles } as never);

describe("the authored facial-hair runtime", () => {
  it("wears every selected CC0 facial asset through the bound hair pipeline", () => {
    const evaluation = model.evaluate(facial(["beard-viking", "moustache-viking"]));
    expect(evaluation.facialHair.map((worn) => worn.id)).toEqual([
      "beard-viking",
      "moustache-viking",
    ]);
    for (const worn of evaluation.facialHair)
      expect(worn.positions.length).toBe(model.hairTopology(worn.id).vertexCount * 3);
  });

  it("keeps recipes with no facial-hair field byte-for-byte compatible", () => {
    const plain = createRecipe({ hair: { style: "short02" } });
    expect(JSON.stringify(createRecipe(JSON.parse(JSON.stringify(plain))))).toBe(
      JSON.stringify(plain),
    );
    expect(model.evaluate(plain).facialHair).toEqual([]);
  });

  it("accepts only a non-empty, duplicate-free list of facial ids", () => {
    expect(() => assertValidRecipe(facial(["beard-faun"]))).not.toThrow();
    for (const bad of [[], ["beard-faun", "beard-faun"], [""], [7]]) {
      const recipe = { ...createRecipe(), facialHair: bad };
      expect(() => assertValidRecipe(recipe), JSON.stringify(bad)).toThrow(RecipeValidationError);
    }
  });

  it("rejects a missing or wrong-kind selected id before any surface is built", () => {
    expect(() => model.evaluate(facial(["short02"]))).toThrow(RecipeError);
    expect(() => model.evaluate(facial(["no-such-facial-style"]))).toThrow(RecipeError);
  });
});
