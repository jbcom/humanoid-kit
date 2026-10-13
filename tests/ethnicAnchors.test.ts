/**
 * Each pure ethnic anchor's macro targets give a distinct, plausible figure.
 * MakeHuman's african, asian and caucasian targets are the vertices of the
 * simplex the kit samples; a vertex that collapsed onto another, or came out
 * of human proportions, would make the coverage of the simplex hollow. The
 * figures are evaluated from the shipped body pack, on both sexes at 25.
 */
import { describe, expect, it } from "vitest";
import { recipeContributions } from "../src/makehuman/recipeMorph.ts";
import { evaluateMorph } from "../src/morph/evaluate.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { PURE_ANCHORS, type PureAnchor, SIMPLEX_ANCHORS } from "../src/sampling.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();

function shape(anchor: PureAnchor, gender: number) {
  const [african, asian, caucasian] = SIMPLEX_ANCHORS[anchor];
  const recipe = createRecipe({ macros: { age: 25, gender, african, asian, caucasian } });
  const out = new Float32Array(assets.positions.length);
  evaluateMorph(
    assets.positions,
    assets.targets,
    recipeContributions(recipe, assets.modifiers),
    out,
  );
  return out;
}

/** Height, and the head's extent: the vertices in the top 13% of the figure. */
function measure(p: Float32Array) {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < p.length; i += 3) {
    minY = Math.min(minY, p[i] as number);
    maxY = Math.max(maxY, p[i] as number);
  }
  const height = maxY - minY;
  const cut = maxY - 0.13 * height;
  const lo = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const hi = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < p.length; i += 3) {
    if ((p[i + 1] as number) <= cut) continue;
    for (const [k, axis] of [
      [0, 0],
      [1, 2],
    ] as const) {
      lo[k] = Math.min(lo[k] as number, p[i + axis] as number);
      hi[k] = Math.max(hi[k] as number, p[i + axis] as number);
    }
  }
  return {
    height,
    headWidth: (hi[0] as number) - (lo[0] as number),
    headDepth: (hi[1] as number) - (lo[1] as number),
  };
}

const rms = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += ((a[i] as number) - (b[i] as number)) ** 2;
  return Math.sqrt(s / (a.length / 3));
};

describe.each([
  ["women", 0],
  ["men", 1],
])("the pure anchors, %s at 25", (_label, gender) => {
  const shapes = Object.fromEntries(PURE_ANCHORS.map((a) => [a, shape(a, gender)])) as Record<
    PureAnchor,
    Float32Array
  >;

  it("are plausible human figures: height and head size in range", () => {
    for (const a of PURE_ANCHORS) {
      const m = measure(shapes[a]);
      expect(m.height, `${a} height`).toBeGreaterThan(1.4);
      expect(m.height, `${a} height`).toBeLessThan(2);
      expect(m.headWidth, `${a} head width`).toBeGreaterThan(0.14);
      expect(m.headWidth, `${a} head width`).toBeLessThan(0.24);
      expect(m.headDepth, `${a} head depth`).toBeGreaterThan(0.17);
      expect(m.headDepth, `${a} head depth`).toBeLessThan(0.27);
    }
  });

  it("differ from each other across the whole body by at least 20 mm RMS", () => {
    for (const [a, b] of [
      ["african", "asian"],
      ["african", "caucasian"],
      ["asian", "caucasian"],
    ] as const)
      expect(rms(shapes[a], shapes[b]) * 1000, `${a} against ${b}`).toBeGreaterThan(20);
  });

  it("differ in head shape: no two anchors share a head depth to within 5 mm and width", () => {
    const heads = PURE_ANCHORS.map((a) => ({ a, ...measure(shapes[a]) }));
    for (let i = 0; i < heads.length; i++)
      for (let j = i + 1; j < heads.length; j++) {
        const p = heads[i] as (typeof heads)[number];
        const q = heads[j] as (typeof heads)[number];
        const apart =
          Math.abs(p.headDepth - q.headDepth) > 0.005 ||
          Math.abs(p.headWidth - q.headWidth) > 0.005 ||
          Math.abs(p.height - q.height) > 0.02;
        expect(apart, `${p.a} and ${q.a}`).toBe(true);
      }
  });
});
