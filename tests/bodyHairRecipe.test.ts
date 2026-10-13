import { describe, expect, it } from "vitest";
import { recipeContributions } from "../src/makehuman/recipeMorph.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();

describe("the recipe's optional body hair", () => {
  it("is absent unless asked for, so a recipe serialises exactly as before", () => {
    const r = createRecipe({ macros: { age: 40, gender: 1 } });
    expect("bodyHair" in r).toBe(false);
    expect(Object.keys(JSON.parse(JSON.stringify(r))).sort()).toEqual([
      "eyes",
      "macros",
      "modifiers",
      "regionalMacros",
      "skin",
      "version",
    ]);
  });

  it("keeps only the fields given and copies them", () => {
    const density = { chest: 0.5 };
    const r = createRecipe({ bodyHair: { density } });
    expect(r.bodyHair).toEqual({ density: { chest: 0.5 } });
    density.chest = 2;
    expect(r.bodyHair?.density?.chest).toBe(0.5);
    expect(createRecipe({ bodyHair: { beard: "goatee" } }).bodyHair).toEqual({ beard: "goatee" });
  });

  it("round-trips through JSON and validates", () => {
    const r = createRecipe({
      macros: { age: 30 },
      bodyHair: { density: { legs: 0, face: 1.5, pubic: 1 }, beard: "full" },
    });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(recipeProblems(r)).toEqual([]);
  });

  it("lists every structural problem", () => {
    const r = {
      ...createRecipe(),
      bodyHair: { density: { chest: 3, elbows: 1, legs: -1 }, beard: "mutton", colour: 1 },
    };
    expect(recipeProblems(r).sort()).toEqual(
      [
        "bodyHair.colour is not a body hair field",
        "bodyHair.density.chest must be a number in [0, 2]",
        "bodyHair.density.elbows is not a body hair group",
        "bodyHair.density.legs must be a number in [0, 2]",
        "bodyHair.beard must be one of none, stubble, moustache, goatee, imperial, mutton-chops, chin-curtain, full, forked, longstreet",
      ].sort(),
    );
    expect(recipeProblems({ ...createRecipe(), bodyHair: 1 })).toEqual([
      "bodyHair must be an object",
    ]);
  });

  it("takes a beard with its continuous controls, and copies it", () => {
    const beard = { style: "forked" as const, length: 0.2, volume: 1.4, grey: 0.3, fork: 0.9 };
    const r = createRecipe({ bodyHair: { beard } });
    expect(r.bodyHair?.beard).toEqual(beard);
    beard.length = 0.5;
    expect(r.bodyHair?.beard).toEqual({ ...beard, length: 0.2 });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(recipeProblems(r)).toEqual([]);
  });

  it("lists every problem with a beard's controls", () => {
    const styles =
      "one of none, stubble, moustache, goatee, imperial, mutton-chops, chin-curtain, full, forked, longstreet";
    const bad = (beard: unknown) => recipeProblems({ ...createRecipe(), bodyHair: { beard } });
    expect(
      bad({
        style: "mutton",
        length: -1,
        volume: 3,
        grey: 2,
        fork: -0.1,
        part: "x",
        colour: 1,
      }).sort(),
    ).toEqual(
      [
        "bodyHair.beard.colour is not a beard field",
        `bodyHair.beard.style must be ${styles}`,
        "bodyHair.beard.length must be a number of metres, at least 0",
        "bodyHair.beard.volume must be a number in [0, 2]",
        "bodyHair.beard.grey must be a number in [0, 1]",
        "bodyHair.beard.fork must be a number in [0, 1]",
        "bodyHair.beard.part must be a number in [0, 1]",
      ].sort(),
    );
    expect(bad([1])).toEqual([`bodyHair.beard must be ${styles}, or an object with a style`]);
    expect(bad({ style: "full" })).toEqual([]);
  });

  it("does not change what the body evaluates to", () => {
    const plain = createRecipe({ macros: { age: 30 } });
    const hairy = createRecipe({ macros: { age: 30 }, bodyHair: { beard: "full" } });
    expect(recipeContributions(hairy, assets.modifiers)).toEqual(
      recipeContributions(plain, assets.modifiers),
    );
  });
});
