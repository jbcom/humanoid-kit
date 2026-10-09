import { describe, expect, it } from "vitest";
import { labFromLinear } from "../src/surface/cielab.ts";
import {
  haemoglobinRatio,
  luminance,
  type Rgb,
  type SkinTone,
  skinAlbedo,
} from "../src/surface/skinTone.ts";

const tone = (over: Partial<SkinTone> = {}): SkinTone => ({
  melanin: 0.4,
  haemoglobin: 0.5,
  undertone: 0,
  override: null,
  ...over,
});
const times = (a: Rgb, r: Rgb): Rgb => [a[0] * r[0], a[1] * r[1], a[2] * r[2]];
const lab = (c: Rgb) => labFromLinear(c);

describe("haemoglobinRatio", () => {
  it("is 1 for no change, and for a colour that is not human skin", () => {
    expect(haemoglobinRatio(tone(), 0)).toEqual([1, 1, 1]);
    expect(haemoglobinRatio(tone({ override: [0.1, 0.3, 0.7] }), 0.8)).toEqual([1, 1, 1]);
  });

  it("moves the albedo exactly as moving the tone's haemoglobin does, within the axis", () => {
    for (const melanin of [0, 0.3, 0.6, 1])
      for (const undertone of [-1, 0, 1])
        for (const haemoglobin of [0.2, 0.5, 0.7])
          for (const delta of [-0.2, 0.25]) {
            const t = tone({ melanin, undertone, haemoglobin });
            const moved = times(skinAlbedo(t), haemoglobinRatio(t, delta));
            const direct = skinAlbedo({ ...t, haemoglobin: haemoglobin + delta });
            for (let k = 0; k < 3; k++) expect(moved[k]).toBeCloseTo(direct[k] as number, 9);
          }
  });

  it("carries a state past the axis, so a ruddy figure still flushes and a pale one pales", () => {
    const ruddy = tone({ haemoglobin: 1 });
    const more = haemoglobinRatio(ruddy, 0.5);
    expect(more[0]).toBeGreaterThan(1.01);
    expect(more[1]).toBeLessThan(0.99);
    const pale = tone({ haemoglobin: 0 });
    const less = haemoglobinRatio(pale, -0.5);
    expect(less[0]).toBeLessThan(0.99);
    expect(less[1]).toBeGreaterThan(1.01);
  });

  it("moves no further than the whole measured axis", () => {
    const t = tone();
    expect(haemoglobinRatio(t, 5)).toEqual(haemoglobinRatio(t, 1));
    expect(haemoglobinRatio(t, -5)).toEqual(haemoglobinRatio(t, -1));
  });

  it("reddens with more haemoglobin and blanches with less, at the same lightness", () => {
    for (const melanin of [0.05, 0.4, 0.9]) {
      const t = tone({ melanin });
      const base = skinAlbedo(t);
      const a0 = lab(base)[1];
      const flushed = times(base, haemoglobinRatio(t, 0.5));
      const pale = times(base, haemoglobinRatio(t, -0.5));
      expect(lab(flushed)[1], `melanin ${melanin}`).toBeGreaterThan(a0 + 0.5);
      expect(lab(pale)[1], `melanin ${melanin}`).toBeLessThan(a0 - 0.5);
      // The model keeps luminance: haemoglobin shifts hue, not depth.
      expect(luminance(flushed)).toBeCloseTo(luminance(base), 6);
      expect(luminance(pale)).toBeCloseTo(luminance(base), 6);
    }
  });

  it("shows less on deeper skin: melanin absorbs what haemoglobin would add", () => {
    // a* of the whole axis (haemoglobin 0 to 1) at each depth: the model's measured spread.
    const span = (melanin: number) => {
      const at = (haemoglobin: number) => lab(skinAlbedo(tone({ melanin, haemoglobin })))[1];
      return at(1) - at(0);
    };
    const spans = [0.25, 0.5, 0.75, 1].map(span);
    expect(spans[0]).toBeGreaterThan(4.5);
    for (let i = 1; i < spans.length; i++)
      expect(spans[i] as number, `melanin ${[0.25, 0.5, 0.75, 1][i]}`).toBeLessThan(
        spans[i - 1] as number,
      );
    expect(spans[3] as number).toBeLessThan(0.7 * (spans[0] as number));
    // And a state's ratio does exactly that: the same delta moves a* less on deep skin.
    const shift = (melanin: number) => {
      const t = tone({ melanin });
      const base = skinAlbedo(t);
      return lab(times(base, haemoglobinRatio(t, 0.5)))[1] - lab(base)[1];
    };
    expect(shift(1)).toBeLessThan(0.7 * shift(0.25));
  });
});
