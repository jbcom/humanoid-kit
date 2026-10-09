import { describe, expect, it } from "vitest";
import { recipeContributions } from "../src/makehuman/recipeMorph.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { assertValidRecipe, recipeProblems } from "../src/recipe/validate.ts";
import { DEFAULT_HAIR_COLOUR, HAIR_COLOURS } from "../src/surface/hairTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();

describe("the recipe's optional hair", () => {
  it("is absent from a recipe that never asked for hair, so saved recipes are unchanged", () => {
    const r = createRecipe();
    expect("hair" in r).toBe(false);
    expect(Object.keys(JSON.parse(JSON.stringify(r))).sort()).toEqual([
      "eyes",
      "macros",
      "modifiers",
      "regionalMacros",
      "skin",
      "version",
    ]);
  });

  it("fills the default colour around a style, and no style around a colour", () => {
    expect(createRecipe({ hair: { style: "short02" } }).hair).toEqual({
      style: "short02",
      colour: DEFAULT_HAIR_COLOUR,
    });
    expect(createRecipe({ hair: { colour: { eumelanin: 0.1 } } }).hair).toEqual({
      style: null,
      colour: { ...DEFAULT_HAIR_COLOUR, eumelanin: 0.1 },
    });
  });

  it("copies its input, so editing the recipe never edits a preset", () => {
    const colour = { ...HAIR_COLOURS.red } as NonNullable<Recipe["hair"]>["colour"];
    const r = createRecipe({ hair: { style: "bob02", colour } });
    (r.hair as NonNullable<Recipe["hair"]>).colour.eumelanin = 1;
    expect(colour.eumelanin).toBe(HAIR_COLOURS.red?.eumelanin);
    const o = createRecipe({ hair: { colour: { override: [0.1, 0.2, 0.3] } } });
    ((o.hair as NonNullable<Recipe["hair"]>).colour.override as number[])[0] = 0.9;
    const again = createRecipe({ hair: { colour: { override: [0.1, 0.2, 0.3] } } });
    expect(again.hair?.colour.override).toEqual([0.1, 0.2, 0.3]);
  });

  it("round-trips through JSON", () => {
    const r = createRecipe({
      hair: { style: "long01", colour: { ...HAIR_COLOURS.ginger, override: [0.2, 0.1, 0.4] } },
    });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("does not change what the body evaluates to", () => {
    const bald = createRecipe();
    const haired = createRecipe({ hair: { style: "short02" } });
    expect(recipeContributions(haired, assets.modifiers)).toEqual(
      recipeContributions(bald, assets.modifiers),
    );
  });
});

describe("hair validation", () => {
  const withHair = (hair: unknown) => ({ ...createRecipe(), hair });

  it("accepts a recipe with no hair, a style, no style, and every named colour", () => {
    expect(recipeProblems(createRecipe())).toEqual([]);
    expect(recipeProblems(createRecipe({ hair: { style: "bob02" } }))).toEqual([]);
    expect(recipeProblems(createRecipe({ hair: { style: null } }))).toEqual([]);
    for (const colour of Object.values(HAIR_COLOURS))
      expect(recipeProblems(createRecipe({ hair: { style: "x", colour } }))).toEqual([]);
  });

  it("names every problem with a hair field instead of clamping it", () => {
    const colour = { eumelanin: 2, pheomelanin: Number.NaN, grey: -0.1, override: [1, 2] };
    const p = recipeProblems(withHair({ style: "", colour, extra: 1 }));
    expect(p).toContain("hair.style must be null or a non-empty string");
    expect(p).toContain("hair.colour.eumelanin must be a number in [0, 1]");
    expect(p).toContain("hair.colour.pheomelanin must be a number in [0, 1]");
    expect(p).toContain("hair.colour.grey must be a number in [0, 1]");
    expect(p).toContain("hair.colour.override must be null or three numbers in [0, 1]");
    expect(p).toContain("hair.extra is not a hair field");
  });

  it("rejects a hair that is not an object or has no colour", () => {
    expect(recipeProblems(withHair("short02"))).toContain("hair must be an object");
    expect(recipeProblems(withHair(null))).toContain("hair must be an object");
    expect(recipeProblems(withHair({ style: "a" }))).toContain("hair.colour missing");
    expect(() => assertValidRecipe(withHair({ style: 3, colour: DEFAULT_HAIR_COLOUR }))).toThrow(
      /hair.style/,
    );
  });
});
