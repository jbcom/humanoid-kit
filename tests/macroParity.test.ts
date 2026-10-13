import { describe, expect, it } from "vitest";
import {
  ageAxis,
  cupAxis,
  ethnicAxis,
  firmnessAxis,
  genderAxis,
  heightAxis,
  macroTargetWeights,
  muscleAxis,
  proportionAxis,
  weightAxis,
} from "../src/makehuman/macro.ts";

/**
 * Parity with MakeHuman's macro model. The reference below restates MakeHuman's
 * documented slider-to-weight curves (its macro variables: each slider is a piecewise
 * linear partition of unity over its anchors) independently of the kit's code, so a
 * change to `macro.ts` that moves a weight away from MakeHuman fails here. The kit's
 * one documented deviation, the adult body held from 18 to 25, is pinned separately.
 */

/** MakeHuman's age slider position for an age in years (1 to 25 maps to 0..0.5, 25 to 90 to 0.5..1). */
const sliderOfYears = (y: number) => (y < 25 ? ((y - 1) / 24) * 0.5 : 0.5 + ((y - 25) / 65) * 0.5);

/** Upstream age weights from the slider position: baby, child, young (the adult body), old. */
function upstreamAge(y: number) {
  const a = sliderOfYears(y);
  const old = Math.max(0, 2 * a - 1);
  if (a > 0.5) return { baby: 0, child: 0, young: 1 - old, old };
  const baby = Math.max(0, 1 - 5.333 * a);
  const young = Math.max(0, (a - 0.1875) * 3.2);
  const child = Math.max(0, Math.min(1, 5.333 * a) - young);
  return { baby, child, young, old };
}

const asMap = (axis: ReadonlyArray<readonly [string, number]>) => new Map(axis);
const weight = (axis: ReadonlyArray<readonly [string, number]>, anchor: string) =>
  asMap(axis).get(anchor) ?? 0;

const SAMPLES = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];

describe("macro parity with MakeHuman", () => {
  it("gender is female = 1 - g, male = g", () => {
    for (const g of SAMPLES) {
      expect(weight(genderAxis(g), "female")).toBeCloseTo(1 - g, 12);
      expect(weight(genderAxis(g), "male")).toBeCloseTo(g, 12);
    }
  });

  it("muscle, weight, breast cup and firmness are min/average/max three-anchor curves", () => {
    const cases = [
      [muscleAxis, "minmuscle", "averagemuscle", "maxmuscle"],
      [weightAxis, "minweight", "averageweight", "maxweight"],
      [cupAxis, "mincup", "averagecup", "maxcup"],
      [firmnessAxis, "minfirmness", "averagefirmness", "maxfirmness"],
    ] as const;
    for (const [axis, lo, mid, hi] of cases)
      for (const v of SAMPLES) {
        expect(weight(axis(v), lo)).toBeCloseTo(Math.max(0, 1 - 2 * v), 12);
        expect(weight(axis(v), hi)).toBeCloseTo(Math.max(0, 2 * v - 1), 12);
        expect(weight(axis(v), mid)).toBeCloseTo(
          1 - Math.max(0, 1 - 2 * v) - Math.max(0, 2 * v - 1),
          12,
        );
      }
  });

  it("height and proportions carry only their two outer anchors (the base mesh is the middle)", () => {
    for (const v of SAMPLES) {
      expect(weight(heightAxis(v), "minheight")).toBeCloseTo(Math.max(0, 1 - 2 * v), 12);
      expect(weight(heightAxis(v), "maxheight")).toBeCloseTo(Math.max(0, 2 * v - 1), 12);
      expect(weight(proportionAxis(v), "uncommonproportions")).toBeCloseTo(
        Math.max(0, 1 - 2 * v),
        12,
      );
      expect(weight(proportionAxis(v), "idealproportions")).toBeCloseTo(Math.max(0, 2 * v - 1), 12);
    }
  });

  it("the three ethnic values are normalised to sum to one", () => {
    const axis = ethnicAxis(2, 1, 1);
    expect(weight(axis, "african")).toBeCloseTo(0.5, 12);
    expect(weight(axis, "asian")).toBeCloseTo(0.25, 12);
    expect(weight(axis, "caucasian")).toBeCloseTo(0.25, 12);
  });

  it("age follows MakeHuman's weights outside the 10 to 25 band", () => {
    // MakeHuman's constants (5.333) leave a baby residue of ~6e-5 at 10 years and the
    // kit snaps it to 0, so compare to a tolerance of 1e-3 rather than exactly.
    for (const years of [1, 2, 4, 6, 8, 9, 25, 30, 40, 55, 70, 90]) {
      const up = upstreamAge(years);
      const kit = asMap(ageAxis(years));
      expect(kit.get("baby") ?? 0).toBeCloseTo(up.baby, 2);
      expect(kit.get("child") ?? 0).toBeCloseTo(up.child, 2);
      expect(kit.get("adult") ?? 0).toBeCloseTo(up.young, 2);
      expect(kit.get("old") ?? 0).toBeCloseTo(up.old, 2);
    }
  });

  it("DEVIATION (documented, docs/AGE-POLICY.md): the adult body holds from 18 to 25", () => {
    // MakeHuman at 18 years is still about 47% child; the kit's adult body is full from 18.
    expect(upstreamAge(18).young).toBeCloseTo(0.533, 2);
    expect(upstreamAge(18).child).toBeCloseTo(0.467, 2);
    expect(weight(ageAxis(18), "adult")).toBe(1);
    expect(weight(ageAxis(18), "child")).toBe(0);
    expect(weight(ageAxis(25), "adult")).toBe(1);
  });

  it("macro target weights are the product of the axes' anchors", () => {
    const m = {
      gender: 0.25,
      age: 40,
      muscle: 0.5,
      weight: 0.5,
      height: 0.5,
      proportions: 0.5,
      african: 1,
      asian: 0,
      caucasian: 0,
      breastSize: 0.5,
      breastFirmness: 0.5,
    };
    const w = macroTargetWeights(m);
    const up = upstreamAge(40);
    // The ethnic family is african x gender x age, one product per file.
    expect(w.get("macrodetails/african-female-young") ?? 0).toBeCloseTo(0.75 * up.young, 2);
    expect(w.get("macrodetails/african-male-young") ?? 0).toBeCloseTo(0.25 * up.young, 2);
    expect(w.get("macrodetails/african-female-old") ?? 0).toBeCloseTo(0.75 * up.old, 2);
    expect(w.get("macrodetails/caucasian-female-young")).toBeUndefined();
  });
});
