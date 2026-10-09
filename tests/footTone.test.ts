import { describe, expect, it } from "vitest";
import { labFromLinear } from "../src/surface/cielab.ts";
import { CALLUS_LAB_SHIFT, callusAlbedo } from "../src/surface/footTone.ts";
import { palmAlbedo } from "../src/surface/handTone.ts";
import { SKIN_F0, type SkinTone } from "../src/surface/skinTone.ts";

const tone = (melanin: number, haemoglobin = 0.5): SkinTone => ({
  melanin,
  haemoglobin,
  undertone: 0,
  override: null,
});
const lab = (rgb: [number, number, number]) =>
  labFromLinear(rgb.map((c) => c + SKIN_F0) as [number, number, number]);

describe("the colour of callus", () => {
  it("is the sole's colour made paler and yellower, at every tone", () => {
    for (const m of [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1]) {
      const sole = lab(palmAlbedo(tone(m)));
      const callus = lab(callusAlbedo(tone(m)));
      expect(callus[0], `melanin ${m}: L`).toBeGreaterThan(sole[0] + 3);
      expect(callus[2], `melanin ${m}: b`).toBeGreaterThan(sole[2] + 2);
      expect(callus[1], `melanin ${m}: a`).toBeLessThan(sole[1]);
    }
  });

  it("moves the sole's colour by the shift it declares, to within the gamut", () => {
    const m = 0.4;
    const sole = lab(palmAlbedo(tone(m)));
    const callus = lab(callusAlbedo(tone(m)));
    expect(callus[0] - sole[0]).toBeCloseTo(CALLUS_LAB_SHIFT[0], 0);
    expect(callus[2] - sole[2]).toBeCloseTo(CALLUS_LAB_SHIFT[2], 0);
  });

  it("stays a valid colour, and a figure with its own colour has a callus lighter than the sole", () => {
    for (const m of [0, 1])
      for (const c of callusAlbedo(tone(m))) expect(c).toBeGreaterThanOrEqual(0);
    const painted: SkinTone = { ...tone(0.5), override: [0.2, 0.5, 0.3] };
    const sole = palmAlbedo(painted);
    const callus = callusAlbedo(painted);
    expect(callus[0] + callus[1] + callus[2]).toBeGreaterThan(sole[0] + sole[1] + sole[2]);
  });
});
