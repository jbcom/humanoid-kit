import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recipeContributions } from "../src/makehuman/recipeMorph.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  assertValidRecipe,
  RecipeValidationError,
  recipeProblems,
} from "../src/recipe/validate.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const bad = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  undefined,
  "0.5",
  null,
);

describe("recipe validation", () => {
  it("accepts a freshly created recipe", () => {
    expect(recipeProblems(createRecipe())).toEqual([]);
  });

  it("rejects any non-finite macro, modifier or skin value instead of evaluating NaN", () => {
    fc.assert(
      fc.property(fc.constantFrom("gender", "age", "muscle", "breastSize"), bad, (key, value) => {
        const r = createRecipe() as unknown as { macros: Record<string, unknown> };
        r.macros[key] = value;
        expect(() => assertValidRecipe(r)).toThrow(RecipeValidationError);
        expect(() => recipeContributions(r as never, assets.modifiers)).toThrow(
          RecipeValidationError,
        );
      }),
    );
    const m = createRecipe({ modifiers: { "nose/nose-scale-horiz-decr|incr": Number.NaN } });
    expect(() => recipeContributions(m, assets.modifiers)).toThrow(RecipeValidationError);
    const s = createRecipe() as unknown as { skin: Record<string, unknown> };
    s.skin.flush = Number.NaN;
    expect(recipeProblems(s)).toContain("skin.flush must be a finite number");
  });

  it("rejects unknown regions, regional age and unknown macros", () => {
    const r = createRecipe() as unknown as {
      regionalMacros: Record<string, Record<string, unknown>>;
      macros: Record<string, unknown>;
    };
    r.regionalMacros.tail = { gender: 1 };
    r.regionalMacros.head = { age: 60, size: 2 };
    r.macros.size = 1;
    const p = recipeProblems(r);
    expect(p).toContain("regionalMacros.tail is not a body region");
    expect(p).toContain("regionalMacros.head.age: age applies to the whole figure");
    expect(p).toContain("regionalMacros.head.size is not a macro");
    expect(p).toContain("macros.size is not a macro");
  });

  it("rejects structurally broken recipes, listing every problem", () => {
    expect(recipeProblems(null)).toEqual(["recipe is not an object"]);
    expect(recipeProblems("recipe")).toEqual(["recipe is not an object"]);
    expect(recipeProblems({})).toEqual([
      "version must be 1",
      "macros missing",
      "regionalMacros missing",
      "modifiers missing",
      "skin missing",
      "eyes missing",
    ]);
    const r = createRecipe() as unknown as Record<string, unknown> & {
      regionalMacros: Record<string, unknown>;
      eyes: Record<string, unknown>;
    };
    r.regionalMacros.head = 3;
    r.regionalMacros.legs = { muscle: Number.NaN };
    r.eyes.iris = [0.1, 2, 0.1];
    r.eyes.scleraWarmth = "warm";
    const p = recipeProblems(r);
    expect(p).toContain("regionalMacros.head must be an object");
    expect(p).toContain("regionalMacros.legs.muscle must be a finite number");
    expect(p).toContain("eyes.iris must be three numbers in [0, 1]");
    expect(p).toContain("eyes.scleraWarmth must be a finite number");
  });

  it("rejects a malformed skin override", () => {
    expect(recipeProblems(createRecipe({ skin: { override: [0.2, 0.3] as never } }))).toContain(
      "skin.override must be null or three numbers in [0, 1]",
    );
    expect(recipeProblems(createRecipe({ skin: { override: [0.2, 0.3, 0.4] } }))).toEqual([]);
  });
});
