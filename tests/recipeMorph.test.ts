import { describe, expect, it } from "vitest";
import type { ShapeModifierEntry } from "../src/format/assetFormat.ts";
import { RecipeError, recipeContributions } from "../src/makehuman/recipeMorph.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const nose = "nose/nose-scale-horiz-decr|incr";
const oval = "head/head-oval";

describe("recipeContributions", () => {
  it("drives a two-sided modifier's low target for negative values and its high target for positive", () => {
    const m = assets.modifiers.get(nose) as ShapeModifierEntry;
    const lo = recipeContributions(createRecipe({ modifiers: { [nose]: -0.4 } }), assets.modifiers);
    const hi = recipeContributions(createRecipe({ modifiers: { [nose]: 0.4 } }), assets.modifiers);
    expect(lo.find((c) => c.target === m.lo)?.weight).toBeCloseTo(0.4);
    expect(hi.find((c) => c.target === m.hi)?.weight).toBeCloseTo(0.4);
  });

  it("clamps values to [-1, 1] and skips zeros", () => {
    const m = assets.modifiers.get(nose) as ShapeModifierEntry;
    const c = recipeContributions(
      createRecipe({ modifiers: { [nose]: 3, [oval]: 0 } }),
      assets.modifiers,
    );
    expect(c.find((x) => x.target === m.hi)?.weight).toBe(1);
    expect(c.some((x) => x.target.startsWith("head/head-oval"))).toBe(false);
  });

  it("rejects unknown modifiers and negative values on one-sided ones", () => {
    expect(() =>
      recipeContributions(createRecipe({ modifiers: { "nose/made-up": 0.5 } }), assets.modifiers),
    ).toThrow(RecipeError);
    expect(() =>
      recipeContributions(createRecipe({ modifiers: { [oval]: -0.5 } }), assets.modifiers),
    ).toThrow(/one-sided/);
  });

  it("honours a pack's adultOnly flag even for an id the age policy does not recognise", () => {
    // A third-party adult pack need not use MakeHuman's id prefixes.
    const extra: ShapeModifierEntry = {
      id: "thirdparty/feature",
      group: "thirdparty",
      lo: null,
      hi: "head/head-oval",
      adultOnly: true,
    };
    const modifiers = new Map([...assets.modifiers, [extra.id, extra]]);
    const minor = createRecipe({ macros: { age: 12 }, modifiers: { [extra.id]: 0.5 } });
    expect(() => recipeContributions(minor, modifiers)).toThrow(/adult-only/);
    const adult = createRecipe({ macros: { age: 30 }, modifiers: { [extra.id]: 0.5 } });
    expect(recipeContributions(adult, modifiers).some((c) => c.target === "head/head-oval")).toBe(
      true,
    );
  });
});
