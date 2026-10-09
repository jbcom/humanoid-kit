import { describe, expect, it } from "vitest";
import { authorDetail, DETAIL_MODIFIERS, pelvicBreadth } from "../scripts/lib/adultDetail.ts";
import { AUTHORING_FIGURE, MOUND, moundTargets } from "../scripts/lib/detail/mound.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { appliedAnatomy } from "../src/recipe/anatomy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

/**
 * The mound as shipped: the adult pack's generated detail targets, its
 * modifier and slider, pinned to the surface, and what they do to a figure.
 * The generator's own tests are in moundDetail.test.ts.
 */
const assets = loadFixtureAssets(true);
const model = new HumanoidModel(assets, { subdivision: 1 });
const spec = adultManifest.anatomy?.detail;
const MOD = "pelvis/mound-decr|incr";
const adult = createRecipe({ macros: { age: 30 } });

describe("the mound in the adult pack", { timeout: 300_000 }, () => {
  it("ships exactly what the generator makes, pinned to the surface it was made on", () => {
    const lattice = model.adultDetailLattice(AUTHORING_FIGURE);
    if (!lattice || !spec) throw new Error("no detail in the shipped pack");
    const control = model.evaluate(AUTHORING_FIGURE).control;
    const dist = (a: number, b: number) =>
      Math.hypot(
        (control[a * 3] as number) - (control[b * 3] as number),
        (control[a * 3 + 1] as number) - (control[b * 3 + 1] as number),
        (control[a * 3 + 2] as number) - (control[b * 3 + 2] as number),
      );
    const made = authorDetail(lattice, pelvicBreadth(assets.manifest.skeleton.joints, dist));
    expect(spec).toEqual(made.spec);
    expect(spec.surfaceKey).toBe(lattice.key);
    for (const t of made.targets) {
      const shipped = assets.targets.get(t.name);
      if (!shipped) throw new Error(`${t.name} is not in the pack`);
      expect(shipped.indices.length).toBe(t.count);
      expect(shipped.scale).toBeCloseTo(t.scale, 12);
    }
    const mound = moundTargets(lattice).fuller;
    const shipped = assets.targets.get("pelvis/mound-incr");
    expect(Array.from(shipped?.indices ?? [])).toEqual(mound.indices);
    shipped?.deltas.forEach((q, i) => {
      expect(Math.abs(q * shipped.scale - (mound.xyz[i] as number))).toBeLessThanOrEqual(
        shipped.scale / 2 + 1e-9,
      );
    });
  });

  it("is an adult-only modifier of the mound feature, with a slider beside the body's bulge", () => {
    const m = adultManifest.modifiers.find((x) => x.id === MOD);
    expect(m).toEqual(DETAIL_MODIFIERS[0]);
    expect(m?.adultOnly).toBe(true);
    const feature = adultManifest.anatomy?.features.find((f) => f.id === "mound");
    expect(feature?.modifiers).toContain(MOD);
    expect(
      appliedAnatomy(createRecipe({ macros: { age: 30 }, modifiers: { [MOD]: 0.2 } }), [
        feature as NonNullable<typeof feature>,
      ]),
    ).toEqual({ mound: 1 });
    const sliders = adultManifest.sliders.flatMap((t) => t.groups.flatMap((g) => g.sliders));
    const at = sliders.findIndex((s) => s.id === MOD);
    expect(at).toBeGreaterThan(0);
    expect(sliders[at - 1]?.id).toBe("pelvis/bulge-decr|incr");
  });

  it("is refused under 18 like the body's own bulge", () => {
    const teen = createRecipe({ macros: { age: 15 }, modifiers: { [MOD]: 1 } });
    expect(() => model.evaluate(teen)).toThrow(/adult|age/);
    expect(AgePolicyError).toBeDefined();
  });

  it("raises the front of the pelvis by its height at the middle, fuller, and lowers it, flatter", () => {
    const rest = model.evaluate(adult);
    const lattice = model.adultDetailLattice(adult);
    if (!lattice) throw new Error("no lattice");
    // The most-displaced lattice vertex, found from the generator, and its render vertices.
    const top = moundTargets(lattice).fuller;
    let best = 0;
    top.indices.forEach((_, i) => {
      if (
        Math.hypot(...[0, 1, 2].map((k) => top.xyz[i * 3 + k] as number)) >
        Math.hypot(...[0, 1, 2].map((k) => top.xyz[best * 3 + k] as number))
      )
        best = i;
    });
    const peak = [0, 1, 2].map(
      (k) => lattice.positions[(top.indices[best] as number) * 3 + k] as number,
    );
    const nearest = (p: Float32Array) => {
      let id = 0;
      let d = Number.POSITIVE_INFINITY;
      for (let v = 0; v < p.length / 3; v++) {
        const e = Math.hypot(
          (p[v * 3] as number) - (peak[0] as number),
          (p[v * 3 + 1] as number) - (peak[1] as number),
          (p[v * 3 + 2] as number) - (peak[2] as number),
        );
        if (e < d) {
          d = e;
          id = v;
        }
      }
      return id;
    };
    const v = nearest(rest.positions);
    const move = (value: number) => {
      const r = model.evaluate(createRecipe({ macros: adult.macros, modifiers: { [MOD]: value } }));
      return Math.hypot(
        (r.positions[v * 3] as number) - (rest.positions[v * 3] as number),
        (r.positions[v * 3 + 1] as number) - (rest.positions[v * 3 + 1] as number),
        (r.positions[v * 3 + 2] as number) - (rest.positions[v * 3 + 2] as number),
      );
    };
    // The authoring figure here is not the default's exactly (age 30 against 25), so the
    // figure scale is within a few percent of one.
    expect(move(1)).toBeGreaterThan(MOUND.fuller * 0.9);
    expect(move(1)).toBeLessThan(MOUND.fuller * 1.1);
    expect(move(-1)).toBeGreaterThan(MOUND.flatter * 0.9);
    expect(move(-1)).toBeLessThan(MOUND.flatter * 1.1);
    expect(move(0.5)).toBeCloseTo(move(1) / 2, 4);
  });

  it("follows the figure: its height is the peak times the figure's hip breadth over the authoring figure's", () => {
    const scale = spec?.scale;
    if (!scale) throw new Error("no scale in the pack");
    const hip = (c: Float32Array) =>
      Math.hypot(
        (c[scale.a * 3] as number) - (c[scale.b * 3] as number),
        (c[scale.a * 3 + 1] as number) - (c[scale.b * 3 + 1] as number),
        (c[scale.a * 3 + 2] as number) - (c[scale.b * 3 + 2] as number),
      );
    const biggest = (macros: object) => {
      const base = model.evaluate(createRecipe({ macros: { age: 30, ...macros } }));
      const full = model.evaluate(
        createRecipe({ macros: { age: 30, ...macros }, modifiers: { [MOD]: 1 } }),
      );
      let worst = 0;
      for (let v = 0; v < base.positions.length; v += 3)
        worst = Math.max(
          worst,
          Math.hypot(
            (full.positions[v] as number) - (base.positions[v] as number),
            (full.positions[v + 1] as number) - (base.positions[v + 1] as number),
            (full.positions[v + 2] as number) - (base.positions[v + 2] as number),
          ),
        );
      return { worst, ratio: hip(base.control) / scale.rest };
    };
    const ratios = new Set<number>();
    for (const macros of [
      { gender: 0, weight: 1 },
      { gender: 1, weight: 0 },
      { age: 18, gender: 0 },
      { age: 90, gender: 1 },
      { height: 0 },
      { height: 1 },
    ]) {
      const { worst, ratio } = biggest(macros);
      ratios.add(Math.round(ratio * 1000));
      expect(worst).toBeGreaterThan(MOUND.fuller * ratio * 0.97);
      expect(worst).toBeLessThan(MOUND.fuller * ratio * 1.03);
    }
    // The figures differ enough in breadth that the size follows them, not a constant.
    expect(ratios.size).toBeGreaterThan(2);
  });
});
