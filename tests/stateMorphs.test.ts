import { describe, expect, it } from "vitest";
import { stateContributions } from "../src/makehuman/stateMorphs.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
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
