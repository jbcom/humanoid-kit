import { describe, expect, it } from "vitest";
import {
  profileScale,
  SKIN_SCATTER,
  scatterDistance,
  singleScatterAlbedo,
  WAVELENGTH_RATIO,
  wrapFromScatter,
  wrappedDiffuse,
} from "../src/surface/scatter.ts";
import { MELANIN_ANCHORS, type Rgb } from "../src/surface/skinTone.ts";

/** ∫ f(N·L) over the sphere of normals, by the midpoint rule in μ = N·L (dΩ = 2π dμ). */
const overSphere = (f: (mu: number) => number, n = 200_000) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += f(-1 + ((i + 0.5) * 2) / n);
  return (s * 2 * Math.PI * 2) / n;
};

describe("the scatter model", () => {
  it("maps albedo to single-scattering albedo as Chiang, Kutz & Burley's fit does", () => {
    expect(singleScatterAlbedo(0)).toBe(0);
    // Monotonic over the albedo range, and below 1.
    let prev = -1;
    for (let a = 0; a <= 1.0001; a += 0.01) {
      const s = singleScatterAlbedo(a);
      expect(s).toBeGreaterThan(prev);
      expect(s).toBeLessThan(1);
      prev = s;
    }
    // Christensen & Burley's profile scale at the fit's anchor points.
    expect(profileScale(0.8)).toBeCloseTo(1.1, 12);
    expect(profileScale(0)).toBeCloseTo(1.9 + 3.5 * 0.64, 12);
  });

  it("scatters red furthest and blue least for a grey, and further for lighter colours", () => {
    const grey = scatterDistance([0.5, 0.5, 0.5]);
    expect(grey[0]).toBeGreaterThan(grey[1]);
    expect(grey[1]).toBeGreaterThan(grey[2]);
    const dark = scatterDistance([0.05, 0.05, 0.05]);
    const light = scatterDistance([0.8, 0.8, 0.8]);
    for (let k = 0; k < 3; k++) expect(light[k]).toBeGreaterThan(dark[k] as number);
    // Of the order of the mean free path: skin scatters over about a millimetre.
    for (const d of grey) expect(d).toBeGreaterThan(SKIN_SCATTER.mfp / 10);
    for (const d of grey) expect(d).toBeLessThan(SKIN_SCATTER.mfp * 2);
    expect(WAVELENGTH_RATIO[1]).toBeCloseTo(1, 2);
  });

  it("scatters pigmented skin as its unpigmented substrate does at full depth", () => {
    const substrate = MELANIN_ANCHORS[0] as Rgb;
    const deep = MELANIN_ANCHORS[MELANIN_ANCHORS.length - 1] as Rgb;
    const atDepth = scatterDistance(deep, SKIN_SCATTER.mfp, SKIN_SCATTER.slope, 1, substrate);
    const asSubstrate = scatterDistance(substrate);
    for (let k = 0; k < 3; k++) expect(atDepth[k]).toBeCloseTo(asSubstrate[k] as number, 15);
  });

  it("keeps deep skin translucent: pigment above the scattering layer, not through it", () => {
    // Melanin sits in the epidermis, above a dermis that scatters much the same in
    // everyone. Mixed through the medium, the deepest measured skin would scatter
    // about a tenth as far as the fairest and render flat and opaque; layered at
    // the fitted depth it keeps more than half.
    const substrate = MELANIN_ANCHORS[0] as Rgb;
    const reach = (p: number) => {
      const ds = MELANIN_ANCHORS.map((a) =>
        scatterDistance(a as Rgb, SKIN_SCATTER.mfp, SKIN_SCATTER.slope, p, substrate),
      );
      return [0, 1, 2].map((k) => {
        const v = ds.map((d) => d[k] as number);
        return Math.min(...v) / Math.max(...v);
      });
    };
    for (const r of reach(SKIN_SCATTER.pigmentDepth)) expect(r).toBeGreaterThan(0.5);
    for (const r of reach(0)) expect(r).toBeLessThan(0.15);
  });

  it("wraps more light round tighter curves and saturates", () => {
    expect(wrapFromScatter(0)).toBe(0);
    expect(wrapFromScatter(-1)).toBe(0);
    expect(wrapFromScatter(0.1)).toBeGreaterThan(wrapFromScatter(0.01));
    expect(wrapFromScatter(1e6)).toBeLessThan(2.0246 / 1.3543 + 1e-9);
  });

  it("moves light round the sphere without adding any, at every wrap", () => {
    const lambert = overSphere((mu) => Math.max(mu, 0));
    expect(lambert).toBeCloseTo(Math.PI, 6); // 2π ∫₀¹ μ dμ
    for (const w of [0, 0.05, 0.3, 1]) {
      expect(overSphere((mu) => wrappedDiffuse(mu, w)) / lambert).toBeCloseTo(1, 5);
    }
    // Without the square in the denominator (the old wrap) light is added.
    const added = overSphere((mu) => Math.max(mu + 0.3, 0) / 1.3) / lambert;
    expect(added).toBeGreaterThan(1.2);
  });
});
