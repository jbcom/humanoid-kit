/**
 * Gates for the data-first chest foundation lab (scripts/research/chest-foundation/tissue.ts).
 * The generator reads only the evaluated control mesh plus per-side size and firmness,
 * with the library chosen by age: no gender, no frame macro, no recipe. These tests
 * hold that boundary and the legacy-identity contract, at every age, on the frame
 * that carries MakeHuman's average tissue.
 */
import { describe, expect, it } from "vitest";
import { frameRecipe } from "../scripts/research/chest-foundation/figure.ts";
import { cellRecipeAt, labSetup } from "../scripts/research/chest-foundation/setup.ts";
import {
  AGE_KNOTS,
  chestTissue,
  legacyControl,
  libraryAt,
} from "../scripts/research/chest-foundation/tissue.ts";

const { lab, ctx, ages } = labSetup();
const lib = libraryAt(ages, 25);
const cellRecipe = cellRecipeAt(25);
const canonical = lab.model.evaluate(cellRecipe).control;

const maxDiff = (a: Float32Array, b: Float32Array) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs((a[i] as number) - (b[i] as number)));
  return m;
};
const fieldRms = (a: Float32Array, b: Float32Array) => {
  let ss = 0;
  const reach = lib.reach;
  for (const v of reach)
    for (let k = 0; k < 3; k++) ss += ((a[v * 3 + k] as number) - (b[v * 3 + k] as number)) ** 2;
  return Math.sqrt(ss / reach.length);
};
const both = (size: number, firmness: number) => ({
  L: { size, firmness },
  R: { size, firmness },
});

describe("chest foundation lab: legacy identity", () => {
  it("reproduces MakeHuman's average breast on the average-tissue frame", () => {
    const got = chestTissue(ctx, lib, canonical, both(0.5, 0.5)).positions;
    expect(maxDiff(got, legacyControl(lab, cellRecipe, 0.5, 0.5))).toBeLessThan(1e-5);
  });

  it("reproduces MakeHuman's maximum size on the same frame", () => {
    const got = chestTissue(ctx, lib, canonical, both(1, 0.5)).positions;
    expect(maxDiff(got, legacyControl(lab, cellRecipe, 1, 0.5))).toBeLessThan(1e-5);
  });

  it("fails the identity gate when the size is off (the gate can see a miss)", () => {
    const got = chestTissue(ctx, lib, canonical, both(0.6, 0.5)).positions;
    expect(maxDiff(got, legacyControl(lab, cellRecipe, 0.5, 0.5))).toBeGreaterThan(1e-3);
  });
});

describe("chest foundation lab: age", () => {
  // The knots and ages between them: linear interpolation over the knots is exact
  // because every library quantity is linear in years between MakeHuman's anchors.
  const checked = [...new Set([...AGE_KNOTS, 7, 15, 33, 60])];
  it.each(checked)("reproduces MakeHuman at age %i, at the average and maximum size", (age) => {
    const recipe = cellRecipeAt(age);
    const control = lab.model.evaluate(recipe).control;
    const at = libraryAt(ages, age);
    for (const [s, f] of [
      [0.5, 0.5],
      [1, 0.5],
      [1, 0],
    ] as const)
      expect(
        maxDiff(
          chestTissue(ctx, at, control, both(s, f)).positions,
          legacyControl(lab, recipe, s, f),
        ),
      ).toBeLessThan(1e-5);
  });

  it("fails the age identity gate with the wrong age's library (the gate can see a miss)", () => {
    const recipe = cellRecipeAt(13);
    const control = lab.model.evaluate(recipe).control;
    const got = chestTissue(ctx, libraryAt(ages, 25), control, both(1, 0.5)).positions;
    expect(maxDiff(got, legacyControl(lab, recipe, 1, 0.5))).toBeGreaterThan(1e-3);
  });

  it("gives the review ages measurably different tissue", () => {
    const tissueAt = (age: number) =>
      chestTissue(
        ctx,
        libraryAt(ages, age),
        lab.model.evaluate(frameRecipe({ gender: 1, age })).control,
        both(1, 0.5),
      ).tissue;
    const t = new Map([5, 13, 18, 25, 40, 70].map((a) => [a, tissueAt(a)] as const));
    const get = (a: number) => t.get(a) as Float32Array;
    for (const [a, b] of [
      [5, 13],
      [13, 25],
      // MakeHuman's 18 is about 47% child, so it differs from 25 (owner ruling, 2026-10-13).
      [18, 25],
      [25, 40],
      [40, 70],
    ] as const)
      expect(fieldRms(get(a), get(b)), `${a} y vs ${b} y`).toBeGreaterThan(0.003);
  });
});

describe("chest foundation lab: no gender input", () => {
  it("takes only the context, the library, the control mesh and the side params", () => {
    expect(chestTissue.length).toBe(4);
  });

  it("is byte-identical when the frame macro changes but the control mesh handed in does not", () => {
    const a = chestTissue(ctx, lib, canonical, both(0.75, 0.25)).positions;
    // Evaluate other frames in between: any hidden reliance on the model's last recipe
    // or on a gender-derived value would show up here.
    lab.model.evaluate(frameRecipe({ gender: 1 }));
    lab.model.evaluate(frameRecipe({ gender: 0.5, muscle: 1 }));
    const b = chestTissue(ctx, lib, Float32Array.from(canonical), both(0.75, 0.25)).positions;
    expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer))).toBe(true);
  });

  it("keeps the bare frame's own chest at size 0: no crater where the average nipple was", () => {
    // The known pinch: the mound-only fit read this frame's pectoral relief as 78 %
    // tissue and dug a 14 mm crater at its nipple. The two-shape fit measures ~0.
    for (const age of [13, 25, 70]) {
      const own = lab.model.evaluate(frameRecipe({ gender: 1, age })).control;
      const r = chestTissue(ctx, libraryAt(ages, age), own, both(0, 0.5));
      expect(r.sides.L.share, `${age} y`).toBeLessThan(0.02);
      expect(maxDiff(r.positions, own), `${age} y`).toBeLessThan(5e-4);
    }
  });

  it("measures the carried tissue from the mesh: a masculine frame carries less", () => {
    const male = lab.model.evaluate(frameRecipe({ gender: 1 })).control;
    const avg = chestTissue(ctx, lib, canonical, both(0.5, 0.5));
    const masc = chestTissue(ctx, lib, male, both(0.5, 0.5));
    expect(masc.sides.L.share).toBeLessThan(avg.sides.L.share);
    expect(avg.sides.L.share).toBeCloseTo(1, 2);
  });
});
