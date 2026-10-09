import { describe, expect, it } from "vitest";
import { AUTHORED_MODIFIERS, authorControl } from "../scripts/lib/adultAuthored.ts";
import { AUTHORING_FIGURE, MOUND } from "../scripts/lib/control/mound.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { appliedAnatomy } from "../src/recipe/anatomy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

/**
 * The mound as shipped: the adult pack's generated control targets, its modifier
 * and slider, and what they do to a figure. The generator's own tests are in
 * moundControl.test.ts.
 */
const assets = loadFixtureAssets(true);
const model = new HumanoidModel(assets, { subdivision: 1 });
const MOD = "pelvis/mound-decr|incr";
const adult = createRecipe({ macros: { age: 30 } });

describe("the mound in the adult pack", { timeout: 300_000 }, () => {
  it("ships exactly what the generator makes on the authoring figure", () => {
    const made = authorControl(model.controlShape(AUTHORING_FIGURE));
    expect(made.map((t) => t.name).sort()).toEqual(["pelvis/mound-decr", "pelvis/mound-incr"]);
    for (const t of made) {
      const shipped = assets.targets.get(t.name);
      if (!shipped) throw new Error(`${t.name} is not in the pack`);
      expect(shipped.indices.length).toBe(t.count);
      expect(shipped.scale).toBeCloseTo(t.scale, 12);
      // Control targets: every index is a vertex of the base mesh.
      for (const v of shipped.indices) expect(v).toBeLessThan(assets.manifest.vertexCount);
    }
    // They are control targets, not detail: the pack's detail names none of them.
    for (const t of made)
      expect(adultManifest.anatomy?.detail?.targets ?? []).not.toContain(t.name);
  });

  it("is an adult-only modifier of the mound feature, with a slider beside the body's bulge", () => {
    const m = adultManifest.modifiers.find((x) => x.id === MOD);
    expect(m).toEqual(AUTHORED_MODIFIERS[0]);
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
  });

  it("moves the control mesh by its height at the middle: fuller forward, flatter back, linear in the value", () => {
    const rest = model.evaluate(adult).control;
    const at = (value: number) =>
      model.evaluate(createRecipe({ macros: adult.macros, modifiers: { [MOD]: value } })).control;
    const largest = (c: Float32Array) => {
      let worst = 0;
      for (let v = 0; v < c.length; v += 3)
        worst = Math.max(
          worst,
          Math.hypot(
            (c[v] as number) - (rest[v] as number),
            (c[v + 1] as number) - (rest[v + 1] as number),
            (c[v + 2] as number) - (rest[v + 2] as number),
          ),
        );
      return worst;
    };
    expect(largest(at(1))).toBeCloseTo(MOUND.fuller, 5);
    expect(largest(at(-1))).toBeCloseTo(MOUND.flatter, 5);
    expect(largest(at(0.5))).toBeCloseTo(MOUND.fuller / 2, 5);
    expect(largest(at(0))).toBe(0);
  });

  it("changes the drawn surface, and only around the pad", () => {
    const rest = model.evaluate(adult);
    const full = model.evaluate(createRecipe({ macros: adult.macros, modifiers: { [MOD]: 1 } }));
    let moved = 0;
    let far = 0;
    for (let v = 0; v < rest.positions.length; v += 3) {
      const d = Math.hypot(
        (full.positions[v] as number) - (rest.positions[v] as number),
        (full.positions[v + 1] as number) - (rest.positions[v + 1] as number),
        (full.positions[v + 2] as number) - (rest.positions[v + 2] as number),
      );
      if (d > 1e-6) moved++;
      // Beyond the pad's reach (a metre off the pelvis, say) nothing moves.
      if (Math.abs(rest.positions[v + 1] as number) > 0.3 && d > 1e-6) far++;
    }
    expect(moved).toBeGreaterThan(100);
    expect(far).toBe(0);
  });
});
