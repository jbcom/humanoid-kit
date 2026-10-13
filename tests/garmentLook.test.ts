import { describe, expect, it } from "vitest";
import { GARMENT_DUST, garmentFinish, wornAlbedo } from "../src/model/garmentLook.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";
import type { Rgb } from "../src/surface/skinTone.ts";

/** Chroma: how far a colour is from the grey of its own mean. */
const chroma = (c: readonly number[]) => Math.max(...c) - Math.min(...c);
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((x, i) => x - (b[i] ?? 0)));

describe("a garment's look on a figure", () => {
  const base = { color: [0.6, 0.6, 0.6] as [number, number, number], roughness: 0.7 };

  it("leaves the pack's material exactly as it is when there is no look", () => {
    const plain = { ...base, fade: 0, dust: 0 };
    expect(garmentFinish(base, undefined)).toEqual(plain);
    expect(garmentFinish(base, {})).toEqual(plain);
    expect(wornAlbedo([0.2, 0.3, 0.4], plain)).toEqual([0.2, 0.3, 0.4]);
  });

  it("multiplies its tint into the pack's colour", () => {
    const { color } = garmentFinish(base, { tint: [0.5, 1, 0.25] });
    expect(color[0]).toBeCloseTo(0.3);
    expect(color[1]).toBeCloseTo(0.6);
    expect(color[2]).toBeCloseTo(0.15);
  });

  it("wears the cloth's own colour, not its tint: wear never changes the multiplier", () => {
    const sky = { tint: [0.25, 0.45, 0.75] as [number, number, number] };
    expect(garmentFinish(base, { ...sky, wear: 1 }).color).toEqual(garmentFinish(base, sky).color);
  });

  // The first version faded the tint, a multiplier: pulled toward the dust it
  // only darkened the cloth, so worn sky-blue trousers drew darker than new ones.
  it.each([
    ["dark dyed wool", [0.03, 0.05, 0.12]],
    ["light dyed wool", [0.35, 0.45, 0.7]],
  ])("fades %s toward its own grey and the dust, more the more it is worn", (_, texel) => {
    const at = (wear: number) => wornAlbedo(texel as Rgb, garmentFinish(base, { wear }));
    const [fresh, half, worn] = [at(0), at(0.5), at(1)];
    expect(chroma(half)).toBeLessThan(chroma(fresh));
    expect(chroma(worn)).toBeLessThan(chroma(half));
    expect(distance(half, GARMENT_DUST)).toBeLessThan(distance(fresh, GARMENT_DUST));
    expect(distance(worn, GARMENT_DUST)).toBeLessThan(distance(half, GARMENT_DUST));
    // Worn cloth is still the colour it was dyed, not the dust.
    expect(worn[2]).toBeGreaterThan(worn[0]);
  });

  it("lightens dark cloth as it wears", () => {
    const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const navy: Rgb = [0.03, 0.05, 0.12];
    const worn = wornAlbedo(navy, garmentFinish(base, { wear: 1 }));
    expect(luminance(worn)).toBeGreaterThan(luminance(navy));
  });

  it("roughens with wear unless the look sets its own roughness", () => {
    expect(garmentFinish(base, { wear: 1 }).roughness).toBeGreaterThan(base.roughness);
    expect(garmentFinish(base, { wear: 1 }).roughness).toBeLessThanOrEqual(1);
    expect(garmentFinish(base, { wear: 1, roughness: 0.3 }).roughness).toBe(0.3);
  });
});

describe("the recipe's optional outfit look", () => {
  it("is absent unless asked for", () => {
    expect("outfitLook" in createRecipe({ outfit: ["shoes01"] })).toBe(false);
  });

  it("is copied, round-trips through JSON and validates", () => {
    const tint: [number, number, number] = [0.25, 0.45, 0.75];
    const r = createRecipe({
      outfit: ["shoes01"],
      outfitLook: { shoes01: { tint, roughness: 0.9, wear: 0.4 } },
    });
    tint[0] = 9;
    expect(r.outfitLook?.shoes01?.tint).toEqual([0.25, 0.45, 0.75]);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(recipeProblems(r)).toEqual([]);
  });

  it("allows a look for a garment the figure does not wear", () => {
    const r = createRecipe({ outfit: ["shoes01"], outfitLook: { fedora: { wear: 1 } } });
    expect(recipeProblems(r)).toEqual([]);
  });

  it("rejects a look that is not a map of garment ids to finishes, listing every problem", () => {
    const bad = (outfitLook: unknown) =>
      recipeProblems({ ...createRecipe({}), outfitLook } as never);
    expect(bad([])).toEqual(["outfitLook must be an object of garment ids to looks"]);
    expect(bad({ a: 3 })).toEqual(["outfitLook.a must be an object"]);
    expect(bad({ a: { tint: [1, 1] } })).toEqual([
      "outfitLook.a.tint must be three finite numbers ≥ 0",
    ]);
    expect(bad({ a: { tint: [1, -1, 1] } })).toEqual([
      "outfitLook.a.tint must be three finite numbers ≥ 0",
    ]);
    expect(bad({ a: { roughness: 2, wear: -0.1 } })).toEqual([
      "outfitLook.a.roughness must be in [0, 1]",
      "outfitLook.a.wear must be in [0, 1]",
    ]);
    expect(bad({ a: { shine: 1 } })).toEqual(["outfitLook.a has unknown field shine"]);
  });
});
