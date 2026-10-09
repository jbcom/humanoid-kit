import { describe, expect, it } from "vitest";
import { dermalVeil, inkOptics, inkSeen } from "../src/bodyArt/ink.ts";
import { labFromLinear } from "../src/surface/cielab.ts";
import {
  luminance,
  MELANIN_FREE_RED_REFLECTANCE,
  melaninFreeAlbedo,
  type Rgb,
  type SkinTone,
  skinAlbedo,
} from "../src/surface/skinTone.ts";

const tone = (melanin: number, more: Partial<SkinTone> = {}): SkinTone => ({
  melanin,
  haemoglobin: 0.5,
  undertone: 0,
  override: null,
  ...more,
});
const TONES = [0, 0.2, 0.35, 0.5, 0.7, 0.85, 1];
const BLACK: Rgb = [0.02, 0.02, 0.02];

describe("ink seen through the skin", () => {
  it("starts from skin with its melanin taken out: lighter than every tone, red at the melanin-free reflectance", () => {
    for (const m of TONES) {
      const free = melaninFreeAlbedo(tone(m));
      expect(free[0]).toBeCloseTo(MELANIN_FREE_RED_REFLECTANCE, 6);
      const skin = skinAlbedo(tone(m));
      for (let k = 0; k < 3; k++) expect(free[k]).toBeGreaterThan(skin[k] as number);
      // Still skin-coloured: yellow of neutral (b* > 0), not violet.
      expect(labFromLinear(free)[2]).toBeGreaterThan(0);
    }
  });

  it("is filtered by the epidermis's melanin, so the same ink darkens with every step of tone", () => {
    let last = Number.POSITIVE_INFINITY;
    for (const m of TONES) {
      const o = inkOptics(tone(m));
      for (const t of o.through) expect(t).toBeLessThanOrEqual(1);
      const y = luminance(inkSeen(tone(m), [0.6, 0.1, 0.1]));
      expect(y).toBeLessThan(last);
      last = y;
    }
  });

  it("reads cooler than the skin around it: the dermis above it scatters blue back", () => {
    const v = dermalVeil();
    expect(v[2]).toBeGreaterThan(v[1]);
    expect(v[1]).toBeGreaterThan(v[0]);
    for (const m of TONES) {
      const skin = labFromLinear(skinAlbedo(tone(m)));
      const ink = labFromLinear(inkSeen(tone(m), BLACK));
      expect(ink[2], `melanin ${m}`).toBeLessThan(skin[2]);
      expect(ink[0]).toBeLessThan(skin[0]);
    }
  });

  it("leaves a colour that is not skin unfiltered", () => {
    const o = inkOptics(tone(0.5, { override: [0.2, 0.5, 0.3] }));
    expect(o.through).toEqual([1, 1, 1]);
  });
});
