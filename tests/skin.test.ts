import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildSkinMasks } from "../src/makehuman/skinMasks.ts";
import { luminance, skinAlbedo } from "../src/surface/skinTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const tone = (melanin: number, haemoglobin = 0.5, undertone = 0) => ({
  melanin,
  haemoglobin,
  undertone,
  override: null,
});

describe("skinAlbedo", () => {
  it("darkens monotonically as melanin rises", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        fc.double({ min: 0.001, max: 0.01, noNaN: true }),
        (m, d) => {
          expect(luminance(skinAlbedo(tone(m + d)))).toBeLessThan(luminance(skinAlbedo(tone(m))));
        },
      ),
    );
  });

  it("stays inside [0, 1] for every input", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 2, noNaN: true }),
        fc.double({ min: -1, max: 2, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        (m, h, u) => {
          for (const c of skinAlbedo(tone(m, h, u))) expect(c >= 0 && c <= 1).toBe(true);
        },
      ),
    );
  });

  it("reddens with haemoglobin and returns an override unchanged", () => {
    const pale = skinAlbedo(tone(0.3, 0));
    const ruddy = skinAlbedo(tone(0.3, 1));
    expect(ruddy[0] / ruddy[1]).toBeGreaterThan(pale[0] / pale[1]);
    expect(skinAlbedo({ ...tone(0.3), override: [0.1, 0.3, 0.6] })).toEqual([0.1, 0.3, 0.6]);
  });
});

describe("buildSkinMasks", () => {
  const assets = loadFixtureAssets();
  const masks = buildSkinMasks(assets);
  const P = assets.positions;
  const strong = (channel: number) => {
    const ys: number[] = [];
    const xs: number[] = [];
    for (let v = 0; v < assets.manifest.vertexCount; v++) {
      if ((masks[v * 3 + channel] as number) > 0.8) {
        xs.push(P[v * 3] as number);
        ys.push(P[v * 3 + 1] as number);
      }
    }
    return {
      count: ys.length,
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      maxAbsX: Math.max(...xs.map(Math.abs)),
    };
  };

  it("finds the lips at the mouth and nowhere else", () => {
    const lips = strong(0);
    expect(lips.count).toBeGreaterThan(20);
    // The mouth sits roughly 0.62–0.66 m above the base mesh origin and is narrow.
    expect(lips.minY).toBeGreaterThan(0.6);
    expect(lips.maxY).toBeLessThan(0.68);
    expect(lips.maxAbsX).toBeLessThan(0.04);
  });

  it("finds nipples and areolae on the chest, one each side", () => {
    const areola = strong(2);
    expect(areola.count).toBeGreaterThan(10);
    expect(areola.minY).toBeGreaterThan(0.3);
    expect(areola.maxY).toBeLessThan(0.5);
    expect(areola.maxAbsX).toBeGreaterThan(0.05);
  });

  it("keeps every mask value in [0, 1]", () => {
    for (const v of masks) expect(v >= 0 && v <= 1).toBe(true);
  });
});
