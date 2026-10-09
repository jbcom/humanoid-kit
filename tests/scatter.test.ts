import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateScatterTable, scatterTableSource } from "../scripts/generate-scatter-table.ts";
import { preintegratedDiffuse } from "../src/surface/preintegration.ts";
import {
  profileScale,
  SKIN_SCATTER,
  scatterDistance,
  scatterTableDiffuse,
  singleScatterAlbedo,
  WAVELENGTH_RATIO,
} from "../src/surface/scatter.ts";
import { SCATTER_TABLE } from "../src/surface/scatterTable.ts";
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
});

describe("pre-integrated diffusion", () => {
  it("is Lambert without scatter, and reproduces the research table", () => {
    for (const c of [-0.5, 0, 0.3, 1]) expect(preintegratedDiffuse(c, 0)).toBe(Math.max(c, 0));
    // ALGORITHMIC-APPEARANCE.md §2.4, computed independently (4000 × 256 quadrature).
    const cos110 = Math.cos((110 * Math.PI) / 180);
    for (const [x, d0, d90, d110] of [
      [0.05, 0.983, 0.039, 0.002],
      [0.1, 0.934, 0.074, 0.017],
      [0.5, 0.678, 0.166, 0.103],
      [2, 0.539, 0.2, 0.151],
    ] as const) {
      expect(preintegratedDiffuse(1, x)).toBeCloseTo(d0, 2);
      expect(preintegratedDiffuse(0, x)).toBeCloseTo(d90, 2);
      expect(preintegratedDiffuse(cos110, x)).toBeCloseTo(d110, 2);
    }
  });

  it("dims the lit side and lights past the terminator more as scatter widens", () => {
    let lit = 1;
    let beyond = 0;
    for (const x of [0.02, 0.1, 0.3, 1]) {
      const l = preintegratedDiffuse(1, x);
      const b = preintegratedDiffuse(-0.2, x);
      expect(l).toBeLessThan(lit);
      expect(b).toBeGreaterThan(beyond);
      lit = l;
      beyond = b;
    }
  });

  it("moves light round the sphere without adding any", () => {
    const lambert = overSphere((mu) => Math.max(mu, 0));
    expect(lambert).toBeCloseTo(Math.PI, 6); // 2π ∫₀¹ μ dμ
    for (const x of [0.05, 0.3, 1]) {
      const kept = overSphere((mu) => preintegratedDiffuse(mu, x, 1500), 400) / lambert;
      expect(kept, `x ${x}`).toBeCloseTo(1, 2);
      const table = overSphere((mu) => scatterTableDiffuse(mu, x), 4000) / lambert;
      expect(table, `table at x ${x}`).toBeCloseTo(1, 2);
    }
  });

  it("is tabulated within a thousandth of the lit peak", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const c = -1 + 2 * rand();
      const x = 1.5 * rand() ** 2; // denser where skin is (x below about 0.5)
      worst = Math.max(
        worst,
        Math.abs(scatterTableDiffuse(c, x) - preintegratedDiffuse(c, x, 3000)),
      );
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it("ships exactly the table the generator writes", { timeout: 60_000 }, () => {
    const shipped = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/surface/scatterTable.ts"),
      "utf8",
    );
    expect(scatterTableSource(generateScatterTable())).toBe(shipped);
    expect(SCATTER_TABLE.cosSteps * SCATTER_TABLE.uSteps * 2).toBe(atob(SCATTER_TABLE.data).length);
  });
});
