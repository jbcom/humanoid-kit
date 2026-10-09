import { describe, expect, it } from "vitest";
import {
  quantisedShapeSignals,
  quantiseShapeSignal,
  SHAPE_SIGNAL_STEPS,
  stateContributions,
} from "../src/makehuman/stateMorphs.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { AREOLA_LAYER } from "../src/surface/regions/rest.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 0 });
const areola = AREOLA_LAYER.fields(assets).mask;
// The nipple is the nipple-point target's footprint; the areola, the size target's (the mask).
const nipple = assets.targets.get("breast/nipple-point-incr")?.indices ?? new Uint32Array(0);

/**
 * On the figure's left breast: the nipple's height above the areola's outer
 * ring, and the ring's radius around the nipple, in metres.
 */
function measure(control: Float32Array) {
  const c = control;
  let tip = -1;
  for (const v of nipple)
    if (
      (c[v * 3] as number) > 0 &&
      (tip < 0 || (c[v * 3 + 2] as number) > (c[tip * 3 + 2] as number))
    )
      tip = v;
  const ring: number[] = [];
  for (let v = 0; v < assets.manifest.vertexCount; v++)
    if ((c[v * 3] as number) > 0 && (areola[v] as number) > 0.5) ring.push(v);
  const dist = (v: number) =>
    Math.hypot(
      (c[v * 3] as number) - (c[tip * 3] as number),
      (c[v * 3 + 1] as number) - (c[tip * 3 + 1] as number),
    );
  const far = Math.max(...ring.map(dist));
  const rim = ring.filter((v) => dist(v) > 0.6 * far);
  const rimZ = rim.reduce((s, v) => s + (c[v * 3 + 2] as number), 0) / rim.length;
  return {
    height: (c[tip * 3 + 2] as number) - rimZ,
    radius: rim.reduce((s, v) => s + dist(v), 0) / rim.length,
  };
}

describe("state morphs", () => {
  const recipe = createRecipe({ macros: { gender: 0 } });

  it("contract the areola and raise the nipple in the cold, within the measured response", () => {
    const rest = measure(model.evaluate(recipe).control);
    const cold = measure(model.evaluate(recipe, { cold: 1 }).control);
    // Measured on partly denervated grafts (lower bounds): nipple +8 to +19%,
    // areola circumference -2 to -6%. Intact skin responds somewhat more.
    const rise = cold.height / rest.height - 1;
    const shrink = cold.radius / rest.radius - 1;
    expect(rise).toBeGreaterThan(0.08);
    expect(rise).toBeLessThan(0.3);
    expect(shrink).toBeLessThan(-0.02);
    expect(shrink).toBeGreaterThan(-0.08);
  });

  it("scale with the signal and leave the figure exactly as it is without one", () => {
    expect(stateContributions({})).toEqual([]);
    expect(stateContributions({ cold: 0.5 }).map((c) => c.weight)).toEqual([0.185, 0.065]);
    const a = model.evaluate(recipe).control;
    const b = model.evaluate(recipe, { cold: 0, heat: 0.4 }).control;
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it("refuse an adult-only signal under 18, and apply cold at every age", () => {
    const teen = createRecipe({ macros: { age: 15 } });
    expect(() => model.evaluate(teen, { arousal: 0.5 })).toThrow(/arousal adult-only/);
    expect(() => model.evaluate(teen, { cold: 1 })).not.toThrow();
    expect(() =>
      model.evaluate(createRecipe({ macros: { age: 30 } }), { arousal: 0.5 }),
    ).not.toThrow();
  });
});

describe("the shape signals' steps", () => {
  it("refuse an adult-only signal under 18 before rounding could hide it", () => {
    const teen = createRecipe({ macros: { age: 15 } });
    const adult = createRecipe({ macros: { age: 30 } });
    const names = ["cold", "arousal"];
    // Each of these rounds or clamps to 0, yet is still a nonzero adult-only signal.
    for (const arousal of [0.005, -0.3, 1e-9])
      expect(() => quantisedShapeSignals(teen, { arousal }, names)).toThrow(AgePolicyError);
    expect(quantisedShapeSignals(teen, { cold: 0.503 }, names)).toEqual([0.5, 0]);
    expect(quantisedShapeSignals(adult, { cold: 1, arousal: 0.005 }, names)).toEqual([1, 0]);
  });

  it("round a signal to one of a few steps, inside 0..1", () => {
    expect(SHAPE_SIGNAL_STEPS).toBe(50);
    expect(quantiseShapeSignal(0)).toBe(0);
    expect(quantiseShapeSignal(1)).toBe(1);
    expect(quantiseShapeSignal(0.5)).toBe(0.5);
    expect(quantiseShapeSignal(0.503)).toBe(0.5);
    expect(quantiseShapeSignal(0.512)).toBe(0.52);
    expect(quantiseShapeSignal(-3)).toBe(0);
    expect(quantiseShapeSignal(9)).toBe(1);
  });

  it("make a signal easing over a second re-evaluate the figure a few dozen times, not every frame", () => {
    // A filtered cold signal moves at every frame; each distinct shape signal is an evaluation.
    const keys = new Set<number>();
    let value = 0;
    for (let frame = 0; frame < 600; frame++) {
      value += (1 - value) * (1 - Math.exp(-1 / 60 / 1.5));
      keys.add(quantiseShapeSignal(value));
    }
    expect(keys.size).toBeLessThanOrEqual(51);
    expect(keys.size).toBeGreaterThan(10);
  });

  it("move the shape by less than a visible amount", () => {
    // One step of cold moves the nipple 0.37 of its point target by 1/50: well under a percent.
    const step = 1 / SHAPE_SIGNAL_STEPS;
    const w = (s: number) => stateContributions({ cold: s })[0]?.weight as number;
    expect(w(0.5 + step) - w(0.5)).toBeLessThan(0.01);
  });
});
