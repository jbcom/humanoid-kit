import { describe, expect, it } from "vitest";
import { RecipeError } from "../src/makehuman/recipeMorph.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { assertValidRecipe, RecipeValidationError } from "../src/recipe/validate.ts";
import { hairManifest, loadHairFixtureAssets } from "./hairFixtures.ts";

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

  it("keeps all five authored assets separate from the body across adult age and macro variation", () => {
    const ids = hairManifest.styles
      .filter((style) => style.kind === "facial")
      .map((style) => style.id);
    expect(ids).toHaveLength(5);
    for (const macros of [
      { age: 18, gender: 0, height: 0.15 },
      { age: 45, gender: 1, height: -0.2 },
      { age: 90, gender: 0.35, height: 0.05 },
    ]) {
      const plain = createRecipe({ macros });
      const worn = model.evaluate(createRecipe({ macros, hair: { style: null }, facialHair: ids }));
      expect(
        worn.facialHair.map((hair) => hair.id),
        JSON.stringify(macros),
      ).toEqual(ids);
      for (const hair of worn.facialHair)
        expect(hair.positions.length, `${JSON.stringify(macros)} ${hair.id}`).toBe(
          model.hairTopology(hair.id).vertexCount * 3,
        );
      // Selecting facial geometry does not deform, replace, or otherwise perturb the body.
      expect(Array.from(worn.positions), JSON.stringify(macros)).toEqual(
        Array.from(model.evaluate(plain).positions),
      );
    }
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
