import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { randomRecipe } from "../src/editor/randomize.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";
import { hairAlbedo } from "../src/surface/hairTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const modifiers = loadFixtureAssets().modifiers;
const STYLES = ["short02", "bob02", "long01", "afro01"];

describe("random hair", () => {
  it("keeps the base recipe's hair, or its absence, when no styles are on offer", () => {
    const none = createRecipe();
    expect("hair" in randomRecipe(none, 3, modifiers)).toBe(false);
    const worn = createRecipe({ hair: { style: "bob02", colour: { eumelanin: 0.2 } } });
    expect(randomRecipe(worn, 3, modifiers).hair).toEqual(worn.hair);
  });

  it("does not change the rest of the figure, so figures from before hair keep their seeds", () => {
    for (const seed of [1, 7, 99]) {
      const without = randomRecipe(createRecipe(), seed, modifiers);
      const withHair = randomRecipe(createRecipe(), seed, modifiers, { hairStyles: STYLES });
      const { hair: _hair, ...rest } = withHair;
      expect(rest).toEqual(without);
    }
  });

  it("picks a style on offer, or none, with a valid natural colour, deterministically", () => {
    const seen = new Set<string | null>();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
        const r = randomRecipe(createRecipe(), seed, modifiers, { hairStyles: STYLES });
        expect(recipeProblems(r)).toEqual([]);
        expect(r.hair).toBeDefined();
        const style = r.hair?.style ?? null;
        expect(style === null || STYLES.includes(style)).toBe(true);
        seen.add(style);
        expect(r.hair?.colour.override).toBeNull();
        expect(randomRecipe(createRecipe(), seed, modifiers, { hairStyles: STYLES })).toEqual(r);
      }),
      { numRuns: 80 },
    );
    // Every style and bald come up.
    expect(seen.size).toBe(STYLES.length + 1);
  });

  it("colours hair along the whole natural range, darker on deeper skin", () => {
    const lightness = (melaninAtLeast: boolean) => {
      let sum = 0;
      let n = 0;
      for (let seed = 0; seed < 600; seed++) {
        const r = randomRecipe(createRecipe(), seed, modifiers, { hairStyles: STYLES });
        if (r.skin.melanin >= 0.5 !== melaninAtLeast || !r.hair) continue;
        const a = hairAlbedo(r.hair.colour);
        sum += 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
        n++;
      }
      return sum / n;
    };
    expect(lightness(true)).toBeLessThan(lightness(false));
    const eumelanin = Array.from(
      { length: 300 },
      (_, seed) =>
        randomRecipe(createRecipe(), seed, modifiers, { hairStyles: STYLES }).hair?.colour
          .eumelanin ?? 0,
    );
    expect(Math.min(...eumelanin)).toBeLessThan(0.2);
    expect(Math.max(...eumelanin)).toBeGreaterThan(0.85);
  });
});
