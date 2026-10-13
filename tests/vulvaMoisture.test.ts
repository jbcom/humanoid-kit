/**
 * The vulva's surface moisture (#82): a region-distinct wetness of the skin, its own
 * signal (`genitalMoisture`), independent of arousal, that lowers the skin's roughness
 * and raises its specular over the vulva layer's own soft mask, so it has no edge of
 * its own and nothing at 0. Adult-only, by the age policy and by the anatomy gate.
 */
import { describe, expect, it } from "vitest";
import { ADULT_ONLY_SIGNALS, AgePolicyError, assertSignalPolicy } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { paintStopTable, STOP_TABLE_WIDTH, surfaceChange } from "../src/surface/layers.ts";
import {
  GENITAL_MOISTURE_SIGNAL,
  VULVA_LAYER,
  VULVA_MOISTURE_LAYER,
  VULVA_MOISTURE_ROUGHNESS,
  VULVA_MOISTURE_SPECULAR,
} from "../src/surface/regions/adult.ts";
import { ADULT_SKIN_LAYERS, SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const tone = { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null };
const input = (signals: Record<string, number>, adult = true, vulva = 1) => ({
  tone,
  flush: 0.4,
  lips: 0.5,
  areola: 0.5,
  signals,
  adult,
  anatomy: { vulva },
});

describe("the vulva's moisture", () => {
  it("is a surface layer of the vulva, after its colour, among the adult layers", () => {
    expect(VULVA_MOISTURE_LAYER.kind).toBe("surface");
    expect(VULVA_MOISTURE_LAYER.adult).toEqual({ feature: "vulva", spec: "vulva-skin" });
    expect(ADULT_SKIN_LAYERS.indexOf(VULVA_MOISTURE_LAYER)).toBeGreaterThan(
      ADULT_SKIN_LAYERS.indexOf(VULVA_LAYER),
    );
  });

  it("follows its own signal, and nothing else: none at 0, none from arousal", () => {
    const p = (signals: Record<string, number>) => VULVA_MOISTURE_LAYER.paint(input(signals));
    expect(p({}).strength).toBe(0);
    expect(p({ arousal: 1 }).strength).toBe(0);
    expect(p({ heat: 1, exertion: 1, cold: 1, fear: 1, blush: 1 }).strength).toBe(0);
    expect(p({ [GENITAL_MOISTURE_SIGNAL]: 0.4 }).strength).toBeCloseTo(0.4, 9);
    expect(p({ [GENITAL_MOISTURE_SIGNAL]: 3 }).strength).toBe(1);
    expect(p({ [GENITAL_MOISTURE_SIGNAL]: -1 }).strength).toBe(0);
  });

  it("makes the skin glossier and more specular, within what the material can take", () => {
    expect(VULVA_MOISTURE_ROUGHNESS).toBeLessThan(0);
    // The skin's base roughness and the shader's floor (as the sweat layer's bound).
    expect(0.52 + VULVA_MOISTURE_ROUGHNESS).toBeGreaterThanOrEqual(0.03);
    expect(VULVA_MOISTURE_SPECULAR).toBeGreaterThan(0);
    const p = VULVA_MOISTURE_LAYER.paint(input({ [GENITAL_MOISTURE_SIGNAL]: 1 }));
    expect(p.roughness).toBe(VULVA_MOISTURE_ROUGHNESS);
    expect(p.specular).toBe(VULVA_MOISTURE_SPECULAR);
  });

  it("changes the material inside the vulva's mask and nowhere outside it", () => {
    const layer = SKIN_LAYERS.indexOf(VULVA_MOISTURE_LAYER);
    const table = paintStopTable(SKIN_LAYERS, input({ [GENITAL_MOISTURE_SIGNAL]: 1 }));
    const row = layer * STOP_TABLE_WIDTH * 4;
    expect(table[row]).toBe(1);
    // A surface row: the kind code 4.
    expect(table[row + 1]).toBe(4);
    const at = (mask: number) =>
      surfaceChange(
        table,
        SKIN_LAYERS.map((_, l) => [l === layer ? mask : 0, 0] as [number, number]),
      );
    expect(at(1).roughness).toBeCloseTo(VULVA_MOISTURE_ROUGHNESS, 3);
    expect(at(1).specular).toBeCloseTo(VULVA_MOISTURE_SPECULAR, 3);
    expect(at(0)).toEqual({ roughness: 0, specular: 0 });
  });

  it("is painted only for an adult whose recipe applies the vulva", () => {
    const layer = SKIN_LAYERS.indexOf(VULVA_MOISTURE_LAYER);
    const row = layer * STOP_TABLE_WIDTH * 4;
    const signals = { [GENITAL_MOISTURE_SIGNAL]: 1 };
    expect(paintStopTable(SKIN_LAYERS, input(signals, false))[row]).toBe(0);
    expect(paintStopTable(SKIN_LAYERS, input(signals, true, 0))[row]).toBe(0);
    expect(paintStopTable(SKIN_LAYERS, input(signals, true, 0.5))[row]).toBeCloseTo(0.5, 6);
  });

  it("is an adult-only signal: refused for a figure under 18, never clamped", () => {
    expect(ADULT_ONLY_SIGNALS).toContain(GENITAL_MOISTURE_SIGNAL);
    const minor = createRecipe({ macros: { age: 15 } });
    expect(() => assertSignalPolicy(minor, { [GENITAL_MOISTURE_SIGNAL]: 0.2 })).toThrow(
      AgePolicyError,
    );
    expect(() => assertSignalPolicy(minor, { [GENITAL_MOISTURE_SIGNAL]: 0 })).not.toThrow();
  });

  it("lies over the vulva's own soft mask, so it has no edge of its own", () => {
    const assets = loadFixtureAssets(true);
    const wet = VULVA_MOISTURE_LAYER.fields(assets).mask;
    const colour = VULVA_LAYER.fields(assets).mask;
    expect(Array.from(wet)).toEqual(Array.from(colour));
    // The mask fades: it takes values between none and all, not only the two.
    const between = Array.from(wet).filter((m) => m > 0.05 && m < 0.95).length;
    expect(between).toBeGreaterThan(0);
    expect(VULVA_MOISTURE_LAYER.available?.(assets)).toBe(true);
  });
});
