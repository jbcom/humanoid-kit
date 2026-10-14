import { describe, expect, it } from "vitest";
import type { ShapeModifierEntry } from "../src/format/assetFormat.ts";
import { RecipeError, recipeContributions } from "../src/makehuman/recipeMorph.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { RecipeValidationError } from "../src/recipe/validate.ts";
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

  it("keeps recipes without breastPresence exactly on the legacy source-frame path", () => {
    const legacy = createRecipe({ macros: { gender: 0.73, age: 19, breastSize: 0.8 } });
    const explicitAbsence = createRecipe({
      macros: { gender: 0.73, age: 19, breastSize: 0.8 },
      regionalMacros: { breastL: {} },
    });
    expect(recipeContributions(explicitAbsence, assets.modifiers)).toEqual(
      recipeContributions(legacy, assets.modifiers),
    );
  });

  it("validates malformed breastPresence before direct contribution evaluation", () => {
    const misplaced = createRecipe() as unknown as {
      regionalMacros: Record<string, Record<string, unknown>>;
    };
    misplaced.regionalMacros.head = { breastPresence: 0.5 };
    expect(() => recipeContributions(misplaced as never, assets.modifiers)).toThrow(
      RecipeValidationError,
    );
    expect(() => recipeContributions(misplaced as never, assets.modifiers)).toThrow(
      /only to breastL or breastR/,
    );

    const outOfRange = createRecipe() as unknown as {
      regionalMacros: Record<string, Record<string, unknown>>;
    };
    outOfRange.regionalMacros.breastR = { breastPresence: 1.01 };
    expect(() => recipeContributions(outOfRange as never, assets.modifiers)).toThrow(
      RecipeValidationError,
    );
    expect(() => recipeContributions(outOfRange as never, assets.modifiers)).toThrow(
      /must be a number in \[0, 1\]/,
    );
  });

  it("leaves breastPresence out of macro contributions for the source-derived foundation", () => {
    const legacy = createRecipe({
      macros: { gender: 1, age: 30, breastSize: 0.8, breastFirmness: 0.7 },
    });
    const explicit = createRecipe({
      macros: { gender: 1, age: 30, breastSize: 0.8, breastFirmness: 0.7 },
      regionalMacros: { breastL: { breastPresence: 1 }, breastR: { breastPresence: 0 } },
    });
    expect(recipeContributions(explicit, assets.modifiers)).toEqual(
      recipeContributions(legacy, assets.modifiers),
    );
  });
});
