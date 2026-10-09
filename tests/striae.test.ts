import { describe, expect, it } from "vitest";
import { luminance, type Rgb, skinAlbedo } from "../src/surface/skinTone.ts";
import {
  STRIA_SPACING,
  striaeAmount,
  striaeColour,
  striaeMaturity,
  striaMark,
} from "../src/surface/striae.ts";
import type { FigureBuild } from "../src/surface/torsoTone.ts";

const build = (over: Partial<FigureBuild> = {}): FigureBuild => ({
  gender: 0,
  age: 25,
  weight: 0.5,
  height: 0.5,
  muscle: 0.5,
  breastSize: 0.5,
  ...over,
});
const tone = (melanin: number) => ({ melanin, haemoglobin: 0.5, undertone: 0, override: null });

describe("how much of the skin has stretch marks", () => {
  it("is none on the default figure, and none in a child whatever the weight", () => {
    expect(striaeAmount(build())).toBe(0);
    expect(striaeAmount(build({ age: 6, weight: 1, height: 1 }))).toBe(0);
  });

  it("grows with weight above the middle, and with height in the years of growth", () => {
    let last = -1;
    for (let w = 0.5; w <= 1.001; w += 0.1) {
      const a = striaeAmount(build({ weight: w }));
      expect(a).toBeGreaterThanOrEqual(last);
      expect(a).toBeLessThanOrEqual(1);
      last = a;
    }
    expect(striaeAmount(build({ weight: 1 }))).toBeGreaterThan(0.5);
    // A tall adolescent has marks from the growth spurt; a tall grown figure far fewer.
    expect(striaeAmount(build({ age: 15, height: 1 }))).toBeGreaterThan(0.2);
    expect(striaeAmount(build({ age: 15, height: 1 }))).toBeGreaterThan(
      striaeAmount(build({ age: 40, height: 1 })),
    );
    expect(striaeAmount(build({ age: 15, height: 0.5 }))).toBe(0);
  });

  it("is a little less on a man than a woman of the same build", () => {
    const f = striaeAmount(build({ weight: 1 }));
    const m = striaeAmount(build({ weight: 1, gender: 1 }));
    expect(m).toBeLessThan(f);
    expect(m).toBeGreaterThan(0.5 * f);
  });
});

describe("how old the marks are", () => {
  it("runs from new (red) in the growing years to old (silver) in adults, never back", () => {
    expect(striaeMaturity(13)).toBe(0);
    expect(striaeMaturity(40)).toBe(1);
    let last = -1;
    for (let age = 0; age <= 90; age += 1) {
      const m = striaeMaturity(age);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
  });
});

describe("the colour of a mark, as a ratio to the skin it is on", () => {
  const lum = (ratio: Rgb, t: ReturnType<typeof tone>) => {
    const skin = skinAlbedo(t);
    return luminance(ratio.map((r, k) => r * (skin[k] as number)) as Rgb) / luminance(skin);
  };

  it("is red on light skin when new: redder than the skin, no lighter", () => {
    const t = tone(0.1);
    const r = striaeColour(t, 0);
    expect(r[0] / r[1]).toBeGreaterThan(1.05);
    expect(lum(r, t)).toBeLessThan(1.02);
  });

  it("is silver on light skin when old: a little paler, not red", () => {
    const t = tone(0.1);
    const old = striaeColour(t, 1);
    const l = lum(old, t);
    expect(l).toBeGreaterThan(1.0);
    expect(l).toBeLessThan(1.25);
    expect(old[0] / old[1]).toBeLessThan(striaeColour(t, 0)[0] / (striaeColour(t, 0)[1] as number));
  });

  it("is lighter on deep skin when old, and lighter the deeper the skin", () => {
    let last = 0;
    for (const m of [0.1, 0.35, 0.6, 0.85]) {
      const t = tone(m);
      const l = lum(striaeColour(t, 1), t);
      expect(l).toBeGreaterThan(last);
      last = l;
    }
    expect(lum(striaeColour(tone(0.9), 1), tone(0.9))).toBeGreaterThan(1.4);
  });

  it("is darker, not red, on deep skin when new", () => {
    const t = tone(0.9);
    const r = striaeColour(t, 0);
    expect(lum(r, t)).toBeLessThan(1);
  });

  it("is between the two ratios part way, and every channel positive", () => {
    const t = tone(0.5);
    const a = striaeColour(t, 0);
    const b = striaeColour(t, 1);
    const mid = striaeColour(t, 0.5);
    for (let k = 0; k < 3; k++) {
      expect(mid[k]).toBeGreaterThan(Math.min(a[k] as number, b[k] as number) - 1e-9);
      expect(mid[k]).toBeLessThan(Math.max(a[k] as number, b[k] as number) + 1e-9);
      expect(mid[k]).toBeGreaterThan(0);
    }
  });

  it("is one for a colour that is not human skin, which has no blood or melanin to change", () => {
    const t = { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: [0.3, 0.2, 0.1] as Rgb };
    const r = striaeColour(t, 1);
    expect(r.every((c) => c > 0)).toBe(true);
  });
});

describe("the pattern of the marks", () => {
  /** The share of a patch with a mark, and the marks as a grid. */
  function patch(amount: number, theta = 0, n = 120, step = 0.0005) {
    const out = new Float32Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++)
        out[j * n + i] = striaMark(i * step, j * step, theta, STRIA_SPACING, amount);
    return out;
  }
  const mean = (a: Float32Array) => a.reduce((s, x) => s + x, 0) / a.length;

  it("is nothing at none and more of the skin the more there is", () => {
    expect(Math.max(...patch(0))).toBe(0);
    const c = [0.25, 0.5, 0.75, 1].map((a) => mean(patch(a)));
    for (let i = 1; i < c.length; i++) expect(c[i] as number).toBeGreaterThan(c[i - 1] as number);
    // At most a third of the skin is marked, and at a quarter of the amount about half as much as at half.
    expect(c[3] as number).toBeGreaterThan(0.12);
    expect(c[3] as number).toBeLessThan(0.4);
    expect(c[0] as number).toBeLessThan(0.12);
  });

  it("stays between 0 and 1 and is the same every time", () => {
    const a = patch(0.8);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    expect(Array.from(a)).toEqual(Array.from(patch(0.8)));
  });

  it("is made of streaks: long along their direction, narrow across it", () => {
    const n = 200;
    const step = 0.0005;
    const f = patch(1, 0, n, step);
    const m = mean(f);
    const corr = (dx: number, dy: number) => {
      let s = 0;
      let c = 0;
      for (let j = 0; j < n - dy; j++)
        for (let i = 0; i < n - dx; i++) {
          s += ((f[j * n + i] as number) - m) * ((f[(j + dy) * n + i + dx] as number) - m);
          c++;
        }
      return s / c;
    };
    const zero = corr(0, 0);
    // Wave direction along x: the mark varies across x and runs along y. A spacing and a half along
    // a streak is still on it; half a spacing across is between two.
    const along = Math.round((1.5 * STRIA_SPACING) / step);
    const across = Math.round((0.5 * STRIA_SPACING) / step);
    expect(corr(0, along) / zero).toBeGreaterThan(0.4);
    expect(corr(across, 0) / zero).toBeLessThan(0.1);
  });

  it("turns with its orientation", () => {
    const n = 120;
    const f = patch(1, Math.PI / 2, n);
    let across = 0;
    let along = 0;
    for (let j = 1; j < n; j++)
      for (let i = 1; i < n; i++) {
        const v = f[j * n + i] as number;
        across += (v - (f[(j - 1) * n + i] as number)) ** 2;
        along += (v - (f[j * n + i - 1] as number)) ** 2;
      }
    expect(across).toBeGreaterThan(3 * along);
  });
});
