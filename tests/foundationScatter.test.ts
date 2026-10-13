/**
 * The battery's scatter set (src/foundation/scatter.ts): figures that cover the
 * ethnic simplex, melanin, undertone and facial features independently, which
 * the fixed bodies (one mix) and tones do not.
 */
import { describe, expect, it } from "vitest";
import {
  SCATTER_COUNT,
  SCATTER_FACE_FEATURES,
  type ScatterFigure,
  scatterFigures,
} from "../src/foundation/scatter.ts";
import { agePolicyViolations } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";
import {
  appearanceCoverage,
  MELANIN_BANDS,
  PURE_ANCHORS,
  SIMPLEX_ANCHOR_NAMES,
} from "../src/sampling.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const modifiers = loadFixtureAssets().modifiers;
const figures = scatterFigures();
const mixOf = (f: ScatterFigure) => [f.macros.african, f.macros.asian, f.macros.caucasian] as const;

/** Pearson correlation of two equal-length series. */
function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] as number) - ma;
    const db = (b[i] as number) - mb;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  return ab / Math.sqrt(aa * bb);
}

describe("the scatter set", () => {
  it("is the same on every run and differs with its seed", () => {
    expect(scatterFigures()).toEqual(figures);
    expect(scatterFigures(SCATTER_COUNT, 62)).not.toEqual(figures);
    expect(figures).toHaveLength(SCATTER_COUNT);
  });

  it("makes valid adult recipes whose modifiers the body pack has", () => {
    for (const f of figures) {
      const r = createRecipe({ macros: f.macros, skin: f.skin, modifiers: f.modifiers });
      expect(recipeProblems(r), f.name).toEqual([]);
      expect(agePolicyViolations(r), f.name).toEqual([]);
      expect(r.macros.african + r.macros.asian + r.macros.caucasian).toBeCloseTo(1, 9);
      for (const id of Object.keys(f.modifiers)) expect(modifiers.has(id), id).toBe(true);
    }
  });

  it("covers every vertex, edge and the centre of the ethnic simplex, and each pure frame twice", () => {
    const c = appearanceCoverage(figures.map((f) => ({ mix: mixOf(f), melanin: f.skin.melanin })));
    for (const name of SIMPLEX_ANCHOR_NAMES)
      expect(c.regions[name], name).toBeGreaterThanOrEqual(2);
    for (const a of PURE_ANCHORS) expect(c.pure[a], a).toBeGreaterThanOrEqual(2);
  });

  it("puts every pure frame on lighter skin and on deeper, on both genders", () => {
    const c = appearanceCoverage(figures.map((f) => ({ mix: mixOf(f), melanin: f.skin.melanin })));
    for (const a of PURE_ANCHORS) {
      expect(c.vertexByHalf[a].light, `${a} light`).toBeGreaterThanOrEqual(1);
      expect(c.vertexByHalf[a].dark, `${a} dark`).toBeGreaterThanOrEqual(1);
      const genders = new Set(figures.filter((f) => f.anchor === a).map((f) => f.macros.gender));
      expect(genders, a).toEqual(new Set([0, 1]));
    }
  });

  it("spreads melanin over every band, evenly, and half of it deep", () => {
    const c = appearanceCoverage(figures.map((f) => ({ mix: mixOf(f), melanin: f.skin.melanin })));
    for (let b = 0; b < MELANIN_BANDS; b++)
      expect(c.melaninBands[b], `band ${b}`).toBe(SCATTER_COUNT / MELANIN_BANDS);
    expect(c.darkHalf).toBeGreaterThanOrEqual(0.4);
    expect(c.darkHalf).toBeLessThanOrEqual(0.6);
  });

  it("draws undertone and each facial feature over their whole range, one value per fifth", () => {
    const fifths = (values: number[]) => {
      const seen = new Array<number>(5).fill(0);
      for (const v of values) {
        const k = Math.min(4, Math.floor(((v + 1) / 2) * 5));
        seen[k] = (seen[k] as number) + 1;
      }
      return seen;
    };
    expect(fifths(figures.map((f) => f.skin.undertone))).toEqual([6, 6, 6, 6, 6]);
    for (const [feature, ids] of Object.entries(SCATTER_FACE_FEATURES)) {
      const values = figures.map((f) => f.modifiers[ids[0]] as number);
      expect(fifths(values), feature).toEqual([6, 6, 6, 6, 6]);
      for (const f of figures)
        for (const id of ids) expect(f.modifiers[id]).toBe(values[figures.indexOf(f)]);
    }
  });

  // The three ethnic shares sum to one, so they are tied to each other by construction: one
  // stands for the mix.
  it("samples each axis independently of the others", () => {
    const axes: Record<string, number[]> = {
      melanin: figures.map((f) => f.skin.melanin),
      undertone: figures.map((f) => f.skin.undertone),
      african: figures.map((f) => f.macros.african),
      nose: figures.map((f) => f.modifiers["nose/nose-scale-horiz-decr|incr"] as number),
      lips: figures.map((f) => f.modifiers["mouth/mouth-upperlip-volume-decr|incr"] as number),
      eyes: figures.map((f) => f.modifiers["eyes/l-eye-epicanthus-in|out"] as number),
    };
    const names = Object.keys(axes);
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++)
        expect(
          Math.abs(
            correlation(axes[names[i] as string] as number[], axes[names[j] as string] as number[]),
          ),
          `${names[i]} with ${names[j]}`,
        ).toBeLessThan(0.45);
  });
});
