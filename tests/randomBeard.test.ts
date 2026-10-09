import { describe, expect, it } from "vitest";
import { BEARD_ODDS, randomBeard, randomRecipe } from "../src/editor/randomize.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { BEARD_STYLES } from "../src/surface/bodyHair.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const modifiers = loadFixtureAssets().modifiers;

describe("random beards", () => {
  it("draw every style by odds that sum to one", () => {
    expect(Object.values(BEARD_ODDS).reduce((s, x) => s + x, 0)).toBeCloseTo(1);
    expect(new Set(Array.from({ length: 1000 }, (_, i) => randomBeard(i / 1000)))).toEqual(
      new Set(BEARD_STYLES),
    );
  });

  it("come last, so a seed's figure is the same with and without them", () => {
    for (const seed of [1, 7, 42, 1234]) {
      const plain = randomRecipe(createRecipe(), seed, modifiers);
      const bearded = randomRecipe(createRecipe(), seed, modifiers, { beards: true });
      const { bodyHair, ...rest } = bearded;
      expect(rest).toEqual(plain);
      expect(BEARD_STYLES).toContain(bodyHair?.beard);
    }
  });

  it("are the same for the same seed, and keep the recipe's densities", () => {
    const base = createRecipe({ bodyHair: { density: { legs: 0 } } });
    const a = randomRecipe(base, 99, modifiers, { beards: true });
    expect(randomRecipe(base, 99, modifiers, { beards: true })).toEqual(a);
    expect(a.bodyHair?.density).toEqual({ legs: 0 });
    // Without beards on offer, the recipe's body hair is kept as it is.
    expect(randomRecipe(base, 99, modifiers).bodyHair).toEqual(base.bodyHair);
  });
});
