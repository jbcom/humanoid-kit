import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ADULT_AGE,
  ageAxis,
  cupAxis,
  DEFAULT_MACROS,
  genderAxis,
  isEmptyUpstreamCombination,
  type MacroValues,
  macroTargetWeights,
  muscleAxis,
} from "../src/makehuman/macro.ts";
import { bodyManifest } from "./fixtures.ts";

const packed = new Set(bodyManifest.targets.flatMap((f) => f.entries.map((e) => e.name)));

const sum = (axis: ReadonlyArray<readonly [string, number]>) => axis.reduce((s, [, w]) => s + w, 0);
const unit = fc.double({ min: 0, max: 1, noNaN: true });

const macroValues = fc.record<MacroValues>({
  gender: unit,
  age: fc.double({ min: 1, max: 90, noNaN: true }),
  muscle: unit,
  weight: unit,
  height: unit,
  proportions: unit,
  african: unit,
  asian: unit,
  caucasian: unit,
  breastSize: unit,
  breastFirmness: unit,
});

describe("macro axes", () => {
  it("every axis is a partition of unity", () => {
    fc.assert(
      fc.property(fc.double({ min: -1, max: 2, noNaN: true }), (x) => {
        for (const axis of [genderAxis(x), muscleAxis(x), cupAxis(x)])
          expect(sum(axis)).toBeCloseTo(1, 9);
      }),
    );
    fc.assert(
      fc.property(fc.double({ min: -10, max: 150, noNaN: true }), (y) => {
        expect(sum(ageAxis(y))).toBeCloseTo(1, 9);
      }),
    );
  });

  it("hits the age anchors exactly", () => {
    expect(ageAxis(1)).toEqual([["baby", 1]]);
    // MakeHuman's own years for its child anchor: 1 + 48 * 0.1875.
    expect(ageAxis(10)).toEqual([["child", 1]]);
    expect(ageAxis(25)).toEqual([["adult", 1]]);
    expect(ageAxis(90)).toEqual([["old", 1]]);
  });

  it("blends child into adult from 10 to 25, as MakeHuman does", () => {
    fc.assert(
      fc.property(fc.double({ min: 10, max: 25, noNaN: true }), (y) => {
        const t = (y - 10) / 15;
        const w = new Map(ageAxis(y));
        expect(w.get("child") ?? 0).toBeCloseTo(1 - t, 9);
        expect(w.get("adult") ?? 0).toBeCloseTo(t, 9);
      }),
    );
    // ADULT_AGE gates content only; the body at 18 is still part child.
    expect(new Map(ageAxis(ADULT_AGE)).get("child")).toBeCloseTo(7 / 15, 12);
  });

  it("blends adult into old from 25 to 90, as MakeHuman does", () => {
    fc.assert(
      fc.property(fc.double({ min: 25, max: 90, noNaN: true }), (y) => {
        const old = (y - 25) / (90 - 25);
        const w = new Map(ageAxis(y));
        expect(w.get("old") ?? 0).toBeCloseTo(old, 9);
        expect(w.get("adult") ?? 0).toBeCloseTo(1 - old, 9);
      }),
    );
  });

  it("names MakeHuman's young targets for the adult anchor", () => {
    const names = [...macroTargetWeights({ ...DEFAULT_MACROS, age: 30 }).keys()];
    expect(names.some((n) => /(^|[/-])young(-|$)/.test(n))).toBe(true);
    expect(names.some((n) => /(^|[/-])(adult|child)(-|$)/.test(n))).toBe(false);
  });
});

describe("macroTargetWeights", () => {
  it("names only targets that exist in the packed core data", () => {
    fc.assert(
      fc.property(macroValues, (m) => {
        for (const name of macroTargetWeights(m).keys()) expect(packed.has(name), name).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("never names an upstream-empty combination", () => {
    fc.assert(
      fc.property(macroValues, (m) => {
        for (const name of macroTargetWeights(m).keys())
          expect(isEmptyUpstreamCombination(name)).toBe(false);
      }),
    );
  });

  it("puts the full gender/age split on the ethnic anchors", () => {
    const w = macroTargetWeights({
      gender: 1,
      age: 25,
      muscle: 0.5,
      weight: 0.5,
      height: 0.5,
      proportions: 0.5,
      african: 0,
      asian: 0,
      caucasian: 1,
      breastSize: 0.5,
      breastFirmness: 0.5,
    });
    expect(w.get("macrodetails/caucasian-male-young")).toBeCloseTo(1);
    expect([...w.keys()].some((k) => k.includes("female"))).toBe(false);
  });
});
