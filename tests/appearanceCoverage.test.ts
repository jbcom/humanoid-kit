/**
 * Coverage of appearance (issue: figures the kit samples or randomises lean
 * toward a few looks). MakeHuman's range is the continuous african / asian /
 * caucasian simplex with melanin a separate axis, so a figure set covers it
 * when every vertex (the pure frames), edge and the middle are all
 * represented and melanin spans the range independently of the mix.
 */
import { describe, expect, it } from "vitest";
import { randomRecipe } from "../src/editor/randomize.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  type AppearanceSample,
  appearanceCoverage,
  MELANIN_BANDS,
  PURE_ANCHORS,
  pureAnchor,
  radicalInverse2,
  SIMPLEX_ANCHOR_NAMES,
  SIMPLEX_ANCHORS,
  simplexRegion,
  toSimplex,
} from "../src/sampling.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const modifiers = loadFixtureAssets().modifiers;

describe("the simplex helpers", () => {
  it("name the region of each anchor as that anchor", () => {
    for (const name of SIMPLEX_ANCHOR_NAMES)
      expect(simplexRegion(SIMPLEX_ANCHORS[name])).toBe(name);
  });

  it("count a mix as a pure frame only near a vertex", () => {
    expect(pureAnchor([1, 0, 0])).toBe("african");
    expect(pureAnchor([0.02, 0.95, 0.03])).toBe("asian");
    expect(pureAnchor([0.2, 0.1, 0.7])).toBeNull();
    expect(pureAnchor([1 / 3, 1 / 3, 1 / 3])).toBeNull();
  });

  it("map the unit square onto the simplex, area-uniformly and summing to 1", () => {
    let inCorner = 0;
    const n = 4096;
    for (let i = 0; i < n; i++) {
      const m = toSimplex((i + 0.5) / n, radicalInverse2(i));
      expect(m[0] + m[1] + m[2]).toBeCloseTo(1, 12);
      for (const x of m) expect(x).toBeGreaterThanOrEqual(0);
      if (m[0] >= 0.5) inCorner++;
    }
    // The corner triangle where one share is at least a half is a quarter of the area.
    expect(inCorner / n).toBeCloseTo(0.25, 1);
  });
});

describe("appearanceCoverage", () => {
  it("counts regions, pure frames, melanin bands and the dark half", () => {
    const samples: AppearanceSample[] = [
      { mix: [1, 0, 0], melanin: 0.95 },
      { mix: [0, 1, 0], melanin: 0.05 },
      { mix: [1 / 3, 1 / 3, 1 / 3], melanin: 0.5 },
    ];
    const c = appearanceCoverage(samples);
    expect(c.count).toBe(3);
    expect(c.regions.african).toBe(1);
    expect(c.regions.centre).toBe(1);
    expect(c.pure).toEqual({ african: 1, asian: 1, caucasian: 0 });
    expect(c.melaninBands).toEqual([1, 0, 1, 0, 1]);
    expect(c.darkHalf).toBeCloseTo(2 / 3, 12);
    expect(c.vertexByHalf.african).toEqual({ light: 0, dark: 1 });
  });
});

/** Seeds as a creator draws them (random 32-bit integers), reproducibly. */
const spreadSeed = (i: number) => Math.imul(i + 1, 2654435761) >>> 0;

function randomizerSamples(seedOf: (i: number) => number, n: number): AppearanceSample[] {
  const out: AppearanceSample[] = [];
  for (let i = 0; i < n; i++) {
    const r = randomRecipe(createRecipe(), seedOf(i), modifiers);
    out.push({
      mix: [r.macros.african, r.macros.asian, r.macros.caucasian],
      melanin: r.skin.melanin,
    });
  }
  return out;
}

describe("the randomizer's coverage", () => {
  const N = 2000;
  for (const [label, seedOf] of [
    ["consecutive seeds", (i: number) => i],
    ["spread 32-bit seeds", spreadSeed],
  ] as const) {
    describe(label, () => {
      const c = appearanceCoverage(randomizerSamples(seedOf, N));

      it("reaches every pure frame, in at least one draw in twenty each", () => {
        for (const a of PURE_ANCHORS) expect(c.pure[a] / N, a).toBeGreaterThanOrEqual(0.05);
      });

      it("reaches every vertex, edge and the middle of the simplex", () => {
        for (const name of SIMPLEX_ANCHOR_NAMES)
          expect(c.regions[name] / N, name).toBeGreaterThanOrEqual(0.09);
      });

      it("spans melanin evenly, independently of the mix", () => {
        for (let b = 0; b < MELANIN_BANDS; b++)
          expect((c.melaninBands[b] as number) / N, `band ${b}`).toBeGreaterThanOrEqual(0.15);
        expect(c.darkHalf).toBeGreaterThan(0.4);
        expect(c.darkHalf).toBeLessThan(0.6);
        for (const a of PURE_ANCHORS) {
          expect(c.vertexByHalf[a].light / N, `${a} light`).toBeGreaterThanOrEqual(0.03);
          expect(c.vertexByHalf[a].dark / N, `${a} dark`).toBeGreaterThanOrEqual(0.03);
        }
      });
    });
  }

  it("keeps the mix summing to one and every share inside [0, 1]", () => {
    for (const s of randomizerSamples(spreadSeed, 500)) {
      expect(s.mix[0] + s.mix[1] + s.mix[2]).toBeCloseTo(1, 9);
      for (const x of s.mix) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });
});
