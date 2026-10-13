/**
 * Gates for the chest lab's scatter sampler (scripts/research/chest-foundation/sampler.ts):
 * seeded and deterministic, every non-display axis covered evenly, the ethnic simplex
 * covered to its corners independently of skin tone, neighbours apart in size and skin
 * tone; the chest extremes corner only the chest's axes, the body extremes all of them.
 */
import { describe, expect, it } from "vitest";
import {
  CHEST_CORNER_AXES,
  coverage,
  SCALAR_AXES,
  SIMPLEX_FIXED,
  sampleSheet,
} from "../scripts/research/chest-foundation/sampler.ts";

const SEEDS = [1, 7, 20261013];

describe("chest lab sampler: scatter", () => {
  it("is deterministic for a seed and differs between seeds", () => {
    expect(JSON.stringify(sampleSheet("scatter", 5))).toBe(
      JSON.stringify(sampleSheet("scatter", 5)),
    );
    expect(JSON.stringify(sampleSheet("scatter", 5))).not.toBe(
      JSON.stringify(sampleSheet("scatter", 6)),
    );
  });

  it.each(SEEDS)("puts one value in every stratum of every scalar axis (seed %i)", (seed) => {
    const s = sampleSheet("scatter", seed);
    const n = s.conditions.length;
    for (const [k, [lo, hi]] of Object.entries(SCALAR_AXES)) {
      const strata = s.conditions
        .map((c) => Math.floor(((c.values[k as keyof typeof SCALAR_AXES] - lo) / (hi - lo)) * n))
        .sort((a, b) => a - b);
      expect(strata, k).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it.each(SEEDS)("hits every simplex vertex and every melanin quintile (seed %i)", (seed) => {
    const s = sampleSheet("scatter", seed);
    const cov = coverage(s);
    for (const v of ["african", "asian", "caucasian"])
      expect(cov.simplexRegions[v], v).toBeGreaterThanOrEqual(5);
    for (const q of cov.melaninQuintiles) expect(q).toBeGreaterThanOrEqual(10);
    expect(cov.darkHalfFraction).toBeGreaterThanOrEqual(1 / 3);
    for (const [name, p] of Object.entries(SIMPLEX_FIXED))
      expect(
        s.conditions.some((c) => c.ethnicFixed === name && c.ethnic.join() === p.join()),
        name,
      ).toBe(true);
  });

  it.each(SEEDS)("samples the ethnic mix independently of skin tone (seed %i)", (seed) => {
    const s = sampleSheet("scatter", seed);
    const corr = (xs: number[], ys: number[]) => {
      const mx = xs.reduce((a, b) => a + b) / xs.length;
      const my = ys.reduce((a, b) => a + b) / ys.length;
      let sxy = 0,
        sxx = 0,
        syy = 0;
      xs.forEach((x, i) => {
        sxy += (x - mx) * ((ys[i] as number) - my);
        sxx += (x - mx) ** 2;
        syy += ((ys[i] as number) - my) ** 2;
      });
      return sxy / Math.sqrt(sxx * syy);
    };
    const mel = s.conditions.map((c) => c.values.melanin);
    for (let k = 0; k < 3; k++)
      expect(
        Math.abs(
          corr(
            mel,
            s.conditions.map((c) => c.ethnic[k] as number),
          ),
        ),
      ).toBeLessThan(0.35);
  });

  it.each(SEEDS)("keeps neighbours apart in size and skin tone (seed %i)", (seed) => {
    const cov = coverage(sampleSheet("scatter", seed));
    expect(cov.minNeighbourGap.size).toBeGreaterThanOrEqual(0.2);
    expect(cov.minNeighbourGap.melanin).toBeGreaterThanOrEqual(0.2);
  });
});

describe.each(["chest-extremes", "body-extremes"] as const)("chest lab sampler: %s", (kind) => {
  const cornered = (k: string) =>
    kind === "body-extremes" || CHEST_CORNER_AXES.includes(k as keyof typeof SCALAR_AXES);

  it.each(SEEDS)("corners its axes, balanced, and holds the rest mid-range (seed %i)", (seed) => {
    const s = sampleSheet(kind, seed);
    const n = s.conditions.length;
    for (const [k, [lo, hi]] of Object.entries(SCALAR_AXES)) {
      const vals = s.conditions.map((c) => c.values[k as keyof typeof SCALAR_AXES]);
      if (cornered(k)) {
        expect(
          vals.every((v) => v === lo || v === hi),
          k,
        ).toBe(true);
        expect(vals.filter((v) => v === hi).length, k).toBe(n / 2);
      } else {
        expect(
          vals.every((v) => v === (lo + hi) / 2),
          k,
        ).toBe(true);
      }
    }
    const cov = coverage(s);
    for (const v of ["african", "asian", "caucasian"]) expect(cov.simplexRegions[v]).toBe(n / 3);
    expect(cov.minNeighbourGap.melanin).toBe(1);
  });

  it.each(SEEDS)("shows every frame direction at both sizes (seed %i)", (seed) => {
    const s = sampleSheet(kind, seed);
    for (let col = 0; col < s.cols; col++) {
      const sizes = new Set(s.conditions.filter((c) => c.col === col).map((c) => c.values.size));
      expect(sizes.size, `column ${col}`).toBe(2);
    }
  });
});

it("holds the body macros mid-range on the chest extremes only", () => {
  const chest = sampleSheet("chest-extremes", 3).conditions;
  const body = sampleSheet("body-extremes", 3).conditions;
  for (const k of ["muscle", "weight", "height"] as const) {
    expect(new Set(chest.map((c) => c.values[k])), k).toEqual(new Set([0.5]));
    expect(new Set(body.map((c) => c.values[k])), k).toEqual(new Set([0, 1]));
  }
});
