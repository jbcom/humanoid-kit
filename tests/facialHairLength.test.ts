import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { assertValidRecipe, RecipeValidationError } from "../src/recipe/validate.ts";
import { loadHairFixtureAssets } from "./hairFixtures.ts";

const model = new HumanoidModel(loadHairFixtureAssets());

const lowestY = (positions: Float32Array) => {
  let low = Number.POSITIVE_INFINITY;
  for (let i = 1; i < positions.length; i += 3) low = Math.min(low, positions[i] as number);
  return low;
};

describe("authored facial-beard length", () => {
  it("keeps the source mesh byte-for-byte placed at length one and lengthens only its free offsets", () => {
    const ordinary = createRecipe({ hair: { style: null }, facialHair: ["beard-viking"] });
    const one = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairLength: { "beard-viking": 1 },
    });
    const long = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairLength: { "beard-viking": 5 },
    });
    const ordinaryEvaluation = model.evaluate(ordinary);
    const oneEvaluation = model.evaluate(one);
    const longEvaluation = model.evaluate(long);
    const normalBeard = ordinaryEvaluation.facialHair[0];
    const oneBeard = oneEvaluation.facialHair[0];
    const longBeard = longEvaluation.facialHair[0];
    expect(Array.from(oneBeard?.positions ?? [])).toEqual(Array.from(normalBeard?.positions ?? []));
    expect(longBeard?.positions.length).toBe(normalBeard?.positions.length);
    expect(lowestY(longBeard?.positions ?? new Float32Array())).toBeLessThan(
      lowestY(normalBeard?.positions ?? new Float32Array()) - 0.15,
    );
    expect(Array.from(longEvaluation.positions)).toEqual(Array.from(ordinaryEvaluation.positions));
  });

  it("copies length settings and accepts only finite opt-in multipliers", () => {
    const lengths = { "beard-viking": 5 };
    const recipe = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairLength: lengths,
    });
    lengths["beard-viking"] = 2;
    expect(recipe.facialHairLength).toEqual({ "beard-viking": 5 });
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const candidate = { ...recipe, facialHairLength: { "beard-viking": bad } };
      expect(() => assertValidRecipe(candidate), String(bad)).toThrow(RecipeValidationError);
    }
  });

  it("does not lengthen an unselected style or a moustache", () => {
    expect(() =>
      model.evaluate(
        createRecipe({
          hair: { style: null },
          facialHair: ["beard-viking"],
          facialHairLength: { "beard-scruffy": 5 },
        }),
      ),
    ).toThrow(/not selected/);
    expect(() =>
      model.evaluate(
        createRecipe({
          hair: { style: null },
          facialHair: ["moustache-viking"],
          facialHairLength: { "moustache-viking": 5 },
        }),
      ),
    ).toThrow(/not a beard style/);
  });
});
