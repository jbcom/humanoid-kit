import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildSkinMasks } from "../src/makehuman/skinMasks.ts";
import { labFromLinear, lchFromLab } from "../src/surface/cielab.ts";
import {
  areolaAlbedo,
  lipAlbedo,
  luminance,
  type Rgb,
  skinAlbedo,
} from "../src/surface/skinTone.ts";
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

/** The natural tone whose skin has CIELAB lightness `L` (melanin found by bisection). */
const toneAtLightness = (L: number) => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (labFromLinear(skinAlbedo(tone(m)))[0] > L) lo = m;
    else hi = m;
  }
  return tone((lo + hi) / 2);
};
const lch = (rgb: Rgb) => lchFromLab(labFromLinear(rgb));

describe("lipAlbedo", () => {
  // Measured lip means (SpectraFace, D65/10°; Vergnaud 2024, Charton 2026) at
  // the same populations' median facial skin in ISSA. The model must sit within
  // one within-group SD of each (L* SD 3.2–5.0, C* SD 3.0–6.1).
  it("reproduces measured lip colour at each population's skin", () => {
    for (const [skinL, lipL, lipC, lipH, sdL, sdC] of [
      [61.9, 46.0, 26.6, 31.9, 3.3, 3.1], // Caucasian
      [59.5, 42.4, 25.0, 35.5, 3.2, 3.0], // Chinese
      [39.6, 33.1, 16.2, 36.8, 5.0, 6.1], // African
    ] as const) {
      const [L, C, h] = lch(lipAlbedo(toneAtLightness(skinL), 0.5));
      expect(Math.abs(L - lipL), `L* at skin ${skinL}`).toBeLessThanOrEqual(sdL);
      expect(Math.abs(C - lipC), `C* at skin ${skinL}`).toBeLessThanOrEqual(sdC);
      expect(Math.abs(h - lipH), `h at skin ${skinL}`).toBeLessThanOrEqual(5);
    }
  });

  it("is never lighter than the skin, and reaches its lightness at the deep end", () => {
    for (let m = 0; m <= 1.0001; m += 0.05) {
      const skin = labFromLinear(skinAlbedo(tone(m)))[0];
      const lip = labFromLinear(lipAlbedo(tone(m), 0.5))[0];
      // (within the CIELAB round trip's rounding)
      expect(lip).toBeLessThanOrEqual(skin + 0.01);
      // The old fixed multipliers put the deepest lip 9-13 L* below its skin.
      if (skin <= 31) expect(skin - lip).toBeLessThan(1);
    }
  });

  it("moves within the measured spread as the slider moves, darker and more saturated as it rises", () => {
    const t = toneAtLightness(55);
    const [L0, C0] = lch(lipAlbedo(t, 0));
    const [L1, C1] = lch(lipAlbedo(t, 1));
    expect(L0 - L1).toBeCloseTo(8, 0);
    expect(C1 - C0).toBeCloseTo(8, 0);
  });

  it("darkens and reddens a non-natural colour by fixed factors (no human data applies)", () => {
    const blue: Rgb = [0.06, 0.11, 0.36];
    const lip = lipAlbedo({ ...tone(0), override: blue }, 0.5);
    expect(luminance(lip)).toBeLessThan(luminance(blue));
    expect(lip[0] / lip[2]).toBeGreaterThan(blue[0] / blue[2]);
  });
});

describe("areolaAlbedo", () => {
  it("darkens along the measured melanin axis and converges on the skin at the deep end", () => {
    const gap = (m: number) =>
      labFromLinear(skinAlbedo(tone(m)))[0] - labFromLinear(areolaAlbedo(tone(m), 0.5))[0];
    expect(gap(0)).toBeGreaterThan(3);
    expect(gap(0.5)).toBeGreaterThan(0);
    expect(gap(1)).toBeLessThan(gap(0) / 3);
    for (let m = 0; m <= 1.0001; m += 0.1) expect(gap(m)).toBeGreaterThanOrEqual(-1e-6);
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
