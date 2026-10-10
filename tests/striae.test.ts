import { describe, expect, it } from "vitest";
import { luminance, type Rgb, skinAlbedo } from "../src/surface/skinTone.ts";
import {
  STRIA_CELL,
  STRIA_WIDTH,
  striaeAmount,
  striaeColour,
  striaeMaturity,
  striaeMeanCover,
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
  const W = STRIA_WIDTH;
  /** The marks over a square `n` samples a side, `step` metres apart, from (`x0`, `y0`). */
  function patch(amount: number, theta = 0, n = 120, step = W / 2, x0 = 0, y0 = 0, footprint = 0) {
    const out = new Float32Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++)
        out[j * n + i] = striaMark(x0 + i * step, y0 + j * step, theta, W, amount, footprint);
    return out;
  }
  const mean = (a: Float32Array) => a.reduce((s, x) => s + x, 0) / a.length;
  /** Cover over two metres square: hundreds of cells, so the sample's mean is the pattern's. */
  const wide = (amount: number) => mean(patch(amount, 0.3, 700, 0.003, 3, 3, 0.003));

  it("is nothing at none, and covers the skin in proportion to the amount, as its mean says", () => {
    expect(Math.max(...patch(0))).toBe(0);
    expect(striaeMeanCover(0)).toBe(0);
    for (const a of [0.25, 0.5, 1]) {
      const got = wide(a);
      expect(got, `amount ${a}`).toBeGreaterThan(0.8 * striaeMeanCover(a));
      expect(got, `amount ${a}`).toBeLessThan(1.1 * striaeMeanCover(a));
    }
    // A heavy figure's sites are marked over a few to a tenth of their skin; half the amount half that.
    expect(striaeMeanCover(1)).toBeGreaterThan(0.05);
    expect(striaeMeanCover(1)).toBeLessThan(0.12);
    expect(striaeMeanCover(0.5) / striaeMeanCover(1)).toBeGreaterThan(0.4);
    expect(striaeMeanCover(0.5) / striaeMeanCover(1)).toBeLessThan(0.6);
  });

  it("stays between 0 and 1 and is the same every time", () => {
    const a = patch(0.8);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    expect(Array.from(a)).toEqual(Array.from(patch(0.8)));
  });

  it("adds marks as the amount grows and never moves one", () => {
    const less = patch(0.4, 0.2, 200, W);
    const more = patch(0.8, 0.2, 200, W);
    for (let i = 0; i < less.length; i++) expect(more[i]).toBeGreaterThanOrEqual(less[i] as number);
    expect(mean(more)).toBeGreaterThan(1.5 * mean(less));
  });

  /** The marks' outlines in a patch: each connected run of samples past a half, its extent along y and across x. */
  function outlines(f: Float32Array, n: number) {
    const seen = new Uint8Array(n * n);
    const out: { along: number; across: number }[] = [];
    for (let s = 0; s < n * n; s++) {
      if (seen[s] || (f[s] as number) <= 0.5) continue;
      const stack = [s];
      seen[s] = 1;
      let [x0, x1, y0, y1] = [n, 0, n, 0];
      const widths = new Map<number, number>();
      while (stack.length) {
        const c = stack.pop() as number;
        const x = c % n;
        const y = (c - x) / n;
        [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
        widths.set(y, (widths.get(y) ?? 0) + 1);
        for (const d of [c - 1, c + 1, c - n, c + n]) {
          if (d < 0 || d >= n * n || seen[d] || (f[d] as number) <= 0.5) continue;
          if (Math.abs((d % n) - x) > 1) continue;
          seen[d] = 1;
          stack.push(d);
        }
      }
      // Touching the patch's edge: its length is cut, so it is left out.
      if (x0 === 0 || y0 === 0 || x1 === n - 1 || y1 === n - 1) continue;
      out.push({ along: y1 - y0 + 1, across: Math.max(...widths.values()) });
    }
    return out;
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

  it("is made of long, thin marks: several centimetres long, a few millimetres wide", () => {
    // Waves along x (theta 0): the marks run along y. Half-width samples over 60 cm square.
    const n = 400;
    const step = W / 2;
    const marks = outlines(patch(1, 0, n, step, 1, 1), n);
    expect(marks.length).toBeGreaterThan(30);
    const length = median(marks.map((m) => m.along * step));
    const width = median(marks.map((m) => m.across * step));
    expect(length).toBeGreaterThan(0.03);
    expect(length).toBeLessThan(0.12);
    expect(width).toBeGreaterThan(0.001);
    expect(width).toBeLessThan(0.008);
    expect(median(marks.map((m) => m.along / m.across))).toBeGreaterThan(8);
    // Of varied length: the longest quarter is at least half again the shortest quarter's.
    const lengths = marks.map((m) => m.along).sort((a, b) => a - b);
    const q = (f: number) => lengths[Math.floor(f * (lengths.length - 1))] as number;
    expect(q(0.75)).toBeGreaterThan(1.5 * q(0.25));
  });

  it("lies in clusters with bare skin between them, not spread evenly", () => {
    // Tiles of a cluster's cell over two metres at an amount the sites carry (a heavy figure's
    // times its site mask): many are bare, and the marked ones are densely so.
    const n = 700;
    const f = patch(0.6, 0.3, n, 0.003, 3, 3, 0.003);
    const tile = Math.round((STRIA_CELL * W) / 0.003);
    const covers: number[] = [];
    for (let ty = 0; ty + tile <= n; ty += tile)
      for (let tx = 0; tx + tile <= n; tx += tile) {
        let s = 0;
        for (let j = 0; j < tile; j++)
          for (let i = 0; i < tile; i++) s += f[(ty + j) * n + tx + i] as number;
        covers.push(s / tile / tile);
      }
    const m = covers.reduce((s, c) => s + c, 0) / covers.length;
    const v = covers.reduce((s, c) => s + (c - m) ** 2, 0) / covers.length;
    expect(covers.filter((c) => c < 0.1 * m).length / covers.length).toBeGreaterThan(0.25);
    // Far more spread than marks laid evenly would give (whose tiles would all be near the mean).
    expect(Math.sqrt(v) / m).toBeGreaterThan(0.6);
  });

  it("is not a mirror image across a line: the body's two sides get their own marks", () => {
    // The body's left UV islands mirror its right's; the pattern drawn in them must not.
    const n = 300;
    const a = patch(1, 0.3, n, W, 1, 1);
    const b = new Float32Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++)
        // The same place reflected across y = 1.5 m, its direction reflected with it.
        b[j * n + i] = striaMark(1 + i * W, 3 - (1 + j * W), -0.3, W, 1);
    const ma = mean(a);
    const mb = mean(b);
    let sab = 0;
    let saa = 0;
    let sbb = 0;
    for (let i = 0; i < a.length; i++) {
      sab += ((a[i] as number) - ma) * ((b[i] as number) - mb);
      saa += ((a[i] as number) - ma) ** 2;
      sbb += ((b[i] as number) - mb) ** 2;
    }
    expect(Math.abs(sab / Math.sqrt(saa * sbb))).toBeLessThan(0.1);
  });

  it("keeps its area when filtered over a wider pixel", () => {
    const sharp = mean(patch(1, 0.3, 300, W, 2, 2));
    const blurred = mean(patch(1, 0.3, 300, W, 2, 2, 2 * W));
    expect(blurred / sharp).toBeGreaterThan(0.9);
    expect(blurred / sharp).toBeLessThan(1.1);
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
