import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { facialHairColour } from "../src/recipe/facialHairColour.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";
import {
  agedHairColour,
  DEFAULT_HAIR_COLOUR,
  HAIR_COLOURS,
  type HairColour,
  hairTint,
} from "../src/surface/hairTone.ts";
import { loadHairFixtureAssets } from "./hairFixtures.ts";

const BEARD = "beard-viking";
const MOUSTACHE = "moustache-viking";
const BLACK = HAIR_COLOURS.black as HairColour;
const WHITE = HAIR_COLOURS.white as HairColour;
const RED = HAIR_COLOURS.red as HairColour;
const model = new HumanoidModel(loadHairFixtureAssets(), { subdivision: 0 });
const base = () =>
  createRecipe({ hair: { style: "short02", colour: BLACK }, facialHair: [BEARD, MOUSTACHE] });

describe("independent authored facial colours", () => {
  it("omits the new field by default and round-trips old recipe JSON exactly", () => {
    for (const recipe of [createRecipe(), base()]) {
      expect(recipe).not.toHaveProperty("facialHairColour");
      expect(JSON.stringify(createRecipe(JSON.parse(JSON.stringify(recipe))))).toBe(
        JSON.stringify(recipe),
      );
    }
  });

  it.each([18, 35, 55, 90])(
    "keeps the exact scalp fallback at age %s and ages overrides identically",
    (age) => {
      for (const recipe of [
        createRecipe({ macros: { age } }),
        createRecipe({ ...base(), macros: { age } }),
      ]) {
        expect(facialHairColour(recipe, BEARD)).toEqual(
          agedHairColour(recipe.hair?.colour ?? DEFAULT_HAIR_COLOUR, age, "scalp"),
        );
        const independent = createRecipe({ ...recipe, facialHairColour: { [BEARD]: RED } });
        expect(facialHairColour(independent, BEARD)).toEqual(agedHairColour(RED, age, "scalp"));
      }
    },
  );

  it("gives a dark scalp, grey beard and different moustache, with only the named tint changing", () => {
    const recipe = createRecipe({
      ...base(),
      facialHairColour: { [BEARD]: WHITE, [MOUSTACHE]: RED },
    });
    const changed = createRecipe({
      ...recipe,
      facialHairColour: { ...recipe.facialHairColour, [BEARD]: BLACK },
    });
    expect(hairTint(facialHairColour(recipe, BEARD))).not.toEqual(
      hairTint(facialHairColour(changed, BEARD)),
    );
    expect(facialHairColour(recipe, MOUSTACHE)).toEqual(facialHairColour(changed, MOUSTACHE));
    expect(recipe.hair).toEqual(changed.hair);
    expect(model.evaluate(recipe)).toEqual(model.evaluate(changed));
    expect(recipeProblems(recipe)).toEqual([]);
  });

  it("copies colours and RGB arrays and preserves them through JSON and structured cloning", () => {
    const rgb: [number, number, number] = [0.1, 0.4, 0.8];
    const input = { [BEARD]: { ...BLACK, override: rgb } };
    const recipe = createRecipe({ ...base(), facialHairColour: input });
    rgb[0] = 0.9;
    input[BEARD].grey = 1;
    expect(recipe.facialHairColour?.[BEARD]).toEqual({ ...BLACK, override: [0.1, 0.4, 0.8] });
    expect(createRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
    expect(structuredClone(recipe)).toEqual(recipe);
    expect(hairTint(facialHairColour(recipe, BEARD))).toEqual([0.25, 1, 2]);
  });

  it("rejects a selected facial entry without authored beard or moustache tags", () => {
    const entry = model.assets.hair?.styles.get(BEARD);
    if (!entry) throw new Error("native facial entry missing");
    const tags = entry.tags;
    try {
      entry.tags = [];
      expect(() =>
        model.evaluate(createRecipe({ ...base(), facialHairColour: { [BEARD]: WHITE } })),
      ).toThrow(/not a beard or moustache/);
    } finally {
      entry.tags = tags;
    }
  });

  it("rejects maps without selected ids and malformed pigments or RGB", () => {
    for (const map of [
      null,
      [],
      "white",
      { [BEARD]: null },
      { "": BLACK },
      { short02: BLACK },
      { [BEARD]: { ...BLACK, grey: Number.NaN } },
      { [BEARD]: { ...BLACK, eumelanin: 2 } },
      { [BEARD]: { ...BLACK, pheomelanin: -1 } },
      { [BEARD]: { ...BLACK, override: [1, 2, 0] } },
      { [BEARD]: { ...BLACK, override: [0, 1] } },
    ]) {
      const recipe = { ...base(), facialHairColour: map } as unknown as Recipe;
      expect(recipeProblems(recipe).length).toBeGreaterThan(0);
      expect(() => model.evaluate(recipe)).toThrow();
    }
    expect(() =>
      model.evaluate(
        createRecipe({ facialHair: ["short02"], facialHairColour: { short02: BLACK } }),
      ),
    ).toThrow(/scalp|facial/);
    expect(() =>
      model.evaluate(
        createRecipe({ facialHair: ["missing"], facialHairColour: { missing: BLACK } }),
      ),
    ).toThrow(/missing/);
  });
});
