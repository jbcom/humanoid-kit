import { describe, expect, it } from "vitest";
import { curveAt, parseCurve } from "../src/format/assetFormat.ts";
import { withAnatomyDefaults } from "../src/recipe/anatomy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";

// The pack's data, not the core's: generic ids stand in for the anatomy's modifiers.
const DEFAULTS = { "part/size": "0,0.1;0.4,0.1;0.6,0.7;1,0.7", "part/other": "0.4,0;0.6,0.6" };

describe("an adult figure's anatomy when its recipe sets none", () => {
  it("follows the gender macro through the pack's curve", () => {
    const at = (gender: number) =>
      withAnatomyDefaults(createRecipe({ macros: { age: 30, gender } }), DEFAULTS).modifiers;
    expect(at(0)).toEqual({ "part/size": 0.1 });
    expect(at(1)).toEqual({ "part/size": 0.7, "part/other": 0.6 });
    expect(at(0.5)["part/size"]).toBeCloseTo(0.4);
    expect(at(0.5)["part/other"]).toBeCloseTo(0.3);
  });

  it("lets a value the recipe sets win, zero included", () => {
    const r = createRecipe({ macros: { age: 30, gender: 1 }, modifiers: { "part/size": 0 } });
    expect(withAnatomyDefaults(r, DEFAULTS).modifiers).toEqual({
      "part/size": 0,
      "part/other": 0.6,
    });
  });

  it("never touches a figure under 18", () => {
    for (const age of [6, 14, 17.9]) {
      const r = createRecipe({ macros: { age, gender: 1 } });
      expect(withAnatomyDefaults(r, DEFAULTS)).toBe(r);
    }
  });

  it("leaves the recipe as it is without the pack's defaults", () => {
    const r = createRecipe({ macros: { age: 30, gender: 1 } });
    expect(withAnatomyDefaults(r, undefined)).toBe(r);
  });
});

describe("a default's curve", () => {
  it("holds its end values and interpolates between points", () => {
    const c = parseCurve("0,0;1,1");
    expect(curveAt(c, -1)).toBe(0);
    expect(curveAt(c, 0.25)).toBeCloseTo(0.25);
    expect(curveAt(c, 2)).toBe(1);
  });

  it("is refused when it is not ascending numeric points", () => {
    for (const bad of ["1,0", "0,0;0,1", "a,b;1,1", "1,0;0,1"])
      expect(() => parseCurve(bad)).toThrow();
  });
});
