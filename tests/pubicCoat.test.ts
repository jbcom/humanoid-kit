/**
 * Pubic hair: a coat region whose area is the adult anatomy pack's data
 * (`AdultAnatomySpec.coatRegions`), painted by the body hair model only for an
 * adult whose recipe asks for it. Without the pack it is nothing at all.
 */
import { describe, expect, it } from "vitest";
import {
  type AdultCoatRegionSpec,
  type HumanoidAssets,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { COAT_REGION_LIMIT, coatMasks, paintCoat } from "../src/surface/coat.ts";
import type { SkinPaintInput } from "../src/surface/layers.ts";
import { BODY_HAIR_COAT, PUBIC_REGION } from "../src/surface/regions/bodyHairCoat.ts";
import { adultPackData, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const SPEC: AdultCoatRegionSpec = {
  id: PUBIC_REGION.id,
  vertices: [10, 20, 30],
  mask: [1, 0.5, 0.25],
};

/** The shipped packs, the adult manifest's anatomy carrying `coatRegions`. */
function withRegions(coatRegions: unknown): HumanoidAssets {
  const adult = adultPackData();
  const manifest = {
    ...adult.manifest,
    anatomy: { ...adult.manifest.anatomy, coatRegions },
  } as typeof adult.manifest;
  return parseHumanoidAssets(bodyPackData(), { ...adult, manifest });
}

const input = (age: number, extra: Partial<SkinPaintInput> = {}): SkinPaintInput => ({
  tone: { melanin: 0.35, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0.45,
  lips: 0.55,
  areola: 0.5,
  signals: {},
  age,
  gender: 1,
  adult: age >= 18,
  ...extra,
});
const asked = { bodyHair: { density: { pubic: 1 } } };
const k = BODY_HAIR_COAT.indexOf(PUBIC_REGION);
const cover = (table: Float32Array) => table[k * 8] as number;

describe("pubic hair's coat region", () => {
  it("is the body hair coat's last region, and the coat holds no more", () => {
    expect(k).toBe(BODY_HAIR_COAT.length - 1);
    expect(BODY_HAIR_COAT.length).toBe(COAT_REGION_LIMIT);
    expect(PUBIC_REGION.adultOnly).toBe(true);
    expect(PUBIC_REGION.targets).toEqual([]);
  });

  it("has no area without the adult pack, or with a pack that gives it none", () => {
    for (const assets of [loadFixtureAssets(), loadFixtureAssets(true)])
      expect(PUBIC_REGION.mask(assets).every((m) => m === 0)).toBe(true);
  });

  it("takes its area from the pack: the spec's vertices at their mask, nothing elsewhere", () => {
    const assets = withRegions([SPEC]);
    const mask = PUBIC_REGION.mask(assets);
    expect(mask.length).toBe(assets.manifest.vertexCount);
    SPEC.vertices.forEach((v, i) => {
      expect(mask[v]).toBeCloseTo(SPEC.mask[i] as number, 6);
    });
    expect(mask.reduce((s, m) => s + m, 0)).toBeCloseTo(1.75, 6);
    const bytes = coatMasks(assets, BODY_HAIR_COAT);
    expect(bytes[10 * COAT_REGION_LIMIT + k]).toBe(255);
  });

  it("is painted only for an adult whose recipe asks for it", () => {
    expect(cover(paintCoat(BODY_HAIR_COAT, input(30, asked)))).toBeGreaterThan(0);
    // An adult whose recipe says nothing of it, a minor asking for it, and an
    // input that does not say the figure is an adult: none.
    expect(cover(paintCoat(BODY_HAIR_COAT, input(30)))).toBe(0);
    expect(cover(paintCoat(BODY_HAIR_COAT, input(16, asked)))).toBe(0);
    const { adult: _, ...unsaid } = input(30, asked);
    expect(cover(paintCoat(BODY_HAIR_COAT, unsaid as SkinPaintInput))).toBe(0);
  });

  it("refuses a pack whose regions are malformed", () => {
    const bad: [string, unknown][] = [
      ["unknown id", [{ ...SPEC, id: "hair-elsewhere" }]],
      ["lengths differ", [{ ...SPEC, mask: [1, 0.5] }]],
      ["not ascending", [{ ...SPEC, vertices: [20, 10, 30] }]],
      ["out of range", [{ ...SPEC, vertices: [10, 20, 1e9] }]],
      ["mask past 1", [{ ...SPEC, mask: [1, 0.5, 1.5] }]],
      ["twice", [SPEC, SPEC]],
    ];
    for (const [label, regions] of bad)
      expect(() => withRegions(regions), label).toThrow(/coat region/);
    expect(() => withRegions([SPEC])).not.toThrow();
  });
});
