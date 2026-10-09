import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { labFromLinear, lchFromLab } from "../src/surface/cielab.ts";
import {
  areolaAlbedo,
  lipAlbedo,
  luminance,
  MELANIN_FREE_RED_REFLECTANCE,
  measuredSkinLightness,
  type Rgb,
  skinAlbedo,
} from "../src/surface/skinTone.ts";

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

/**
 * The natural tone whose skin measures CIELAB lightness `L` the way ISSA
 * measured it, specular included (melanin found by bisection).
 */
const toneAtLightness = (L: number) => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (measuredSkinLightness(tone(m)) > L) lo = m;
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

  it("is darker than the skin as measured, and reaches its lightness at the deep end", () => {
    for (let m = 0; m <= 1.0001; m += 0.05) {
      const skin = measuredSkinLightness(tone(m));
      const lip = labFromLinear(lipAlbedo(tone(m), 0.5))[0];
      // (within the CIELAB round trip's rounding)
      expect(lip).toBeLessThanOrEqual(skin + 0.01);
    }
    // The deepest skin measures L* 30 and its lip sits among the darkest measured
    // lips (cluster L* 28.5, African group 33.1 ± 5.0), not 7-16 L* below them.
    const deepest = labFromLinear(lipAlbedo(tone(1), 0.5))[0];
    expect(measuredSkinLightness(tone(1))).toBeCloseTo(30, 0);
    expect(deepest).toBeGreaterThanOrEqual(28.5);
    expect(deepest - measuredSkinLightness(tone(1))).toBeLessThan(0.5);
  });

  it("moves within the measured spread as the slider moves, at every depth", () => {
    for (const skinL of [55, 30]) {
      const t = toneAtLightness(skinL);
      const [L0, C0] = lch(lipAlbedo(t, 0));
      const [L1, C1] = lch(lipAlbedo(t, 1));
      expect(L0 - L1, `L* span at skin ${skinL}`).toBeCloseTo(8, 0);
      expect(C1 - C0, `C* span at skin ${skinL}`).toBeCloseTo(8, 0);
    }
  });

  it("darkens and reddens a non-natural colour by fixed factors (no human data applies)", () => {
    const blue: Rgb = [0.06, 0.11, 0.36];
    const lip = lipAlbedo({ ...tone(0), override: blue }, 0.5);
    expect(luminance(lip)).toBeLessThan(luminance(blue));
    expect(lip[0] / lip[2]).toBeGreaterThan(blue[0] / blue[2]);
  });
});

describe("areolaAlbedo", () => {
  const redDensity = (rgb: readonly number[]) => -Math.log10(rgb[0] as number);
  const melaninDensity = (rgb: readonly number[]) =>
    redDensity(rgb) - redDensity([MELANIN_FREE_RED_REFLECTANCE]);

  it("carries twice the skin's melanin at the default depth, at every tone (Dean et al. 2005)", () => {
    for (let m = 0; m <= 1.0001; m += 0.1) {
      // Haemoglobin aside: compare at the neutral redness the areola adds to.
      const skin = skinAlbedo({ ...tone(m), haemoglobin: 0.75 });
      const areola = areolaAlbedo(tone(m), 0.5);
      expect(melaninDensity(areola) / melaninDensity(skin), `melanin ${m}`).toBeCloseTo(2, 1);
    }
  });

  it("stays visibly darker than the skin at every tone, deepest skin included", () => {
    for (let m = 0; m <= 1.0001; m += 0.1) {
      const gap =
        labFromLinear(skinAlbedo(tone(m)))[0] - labFromLinear(areolaAlbedo(tone(m), 0.5))[0];
      expect(gap, `melanin ${m}`).toBeGreaterThan(3);
    }
  });

  it("deepens with depth, from no extra melanin at 0", () => {
    const L = (m: number, d: number) => labFromLinear(areolaAlbedo(tone(m), d))[0];
    for (const m of [0.1, 0.5, 0.9]) {
      expect(L(m, 0)).toBeGreaterThan(L(m, 0.5));
      expect(L(m, 0.5)).toBeGreaterThan(L(m, 1));
      const skin = skinAlbedo({ ...tone(m), haemoglobin: 0.75 });
      expect(melaninDensity(areolaAlbedo(tone(m), 0))).toBeCloseTo(melaninDensity(skin), 2);
    }
  });
});
