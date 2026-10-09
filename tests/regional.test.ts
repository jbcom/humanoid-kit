import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isOverridden,
  REGIONAL_MACROS,
  regionalValue,
  withRegionalValue,
} from "../src/editor/regional.ts";
import { BODY_REGIONS } from "../src/makehuman/regions.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";

const region = fc.constantFrom(...BODY_REGIONS);
const key = fc.constantFrom(...REGIONAL_MACROS);
const unit = fc.double({ min: -0.5, max: 1.5, noNaN: true });

describe("regional overrides", () => {
  it("inherits the figure's value until overridden", () => {
    const r = createRecipe({ macros: { gender: 0.2 } });
    expect(regionalValue(r, "head", "gender")).toBe(0.2);
    expect(isOverridden(r, "head", "gender")).toBe(false);
  });

  it("sets, clamps, reads back and stays a valid recipe; the input is untouched", () => {
    fc.assert(
      fc.property(region, key, unit, (g, k, v) => {
        const r = createRecipe();
        const before = structuredClone(r);
        const next = withRegionalValue(r, g, k, v);
        expect(regionalValue(next, g, k)).toBeCloseTo(Math.min(1, Math.max(0, v)), 9);
        expect(isOverridden(next, g, k)).toBe(true);
        expect(recipeProblems(next)).toEqual([]);
        expect(r).toEqual(before);
      }),
    );
  });

  it("keeps a region's ethnic values summing to one", () => {
    fc.assert(
      fc.property(region, unit, unit, (g, a, b) => {
        let r = withRegionalValue(createRecipe(), g, "asian", a);
        r = withRegionalValue(r, g, "african", b);
        const sum = ["african", "asian", "caucasian"].reduce(
          (s, k) => s + regionalValue(r, g, k as "asian"),
          0,
        );
        expect(sum).toBeCloseTo(1, 9);
      }),
    );
  });

  it("clears back to inheriting and drops empty regions", () => {
    let r = withRegionalValue(createRecipe(), "pelvis", "gender", 0.8);
    r = withRegionalValue(r, "pelvis", "gender", null);
    expect(r.regionalMacros).toEqual({});
    r = withRegionalValue(r, "head", "caucasian", 0.9);
    r = withRegionalValue(r, "head", "asian", null);
    expect(r.regionalMacros).toEqual({});
  });
});
