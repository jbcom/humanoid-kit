import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe, recipeSetsModifiers } from "../src/recipe/recipe.ts";
import { bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });

const finite = (a: Float32Array) => a.every((x) => Number.isFinite(x));

describe("HumanoidModel", () => {
  it("evaluates macro recipes before the modifier targets load, and names the wait otherwise", () => {
    const { modifierTargets: _, ...firstStage } = bodyPackData();
    const early = new HumanoidModel(parseHumanoidAssets(firstStage), { subdivision: 0 });
    const full = new HumanoidModel(loadFixtureAssets(), { subdivision: 0 });
    const macro = createRecipe({ macros: { gender: 0.2, age: 60, weight: 0.8 } });
    expect(early.evaluate(macro).positions).toEqual(full.evaluate(macro).positions);
    const shaped = createRecipe({ modifiers: { "nose/nose-scale-horiz-decr|incr": 0.5 } });
    expect(recipeSetsModifiers(shaped)).toBe(true);
    expect(
      recipeSetsModifiers(createRecipe({ modifiers: { "nose/nose-scale-horiz-decr|incr": 0 } })),
    ).toBe(false);
    expect(() => early.evaluate(shaped)).toThrow(/modifier targets have not loaded/);
  });

  it("evaluates the default recipe to finite, grounded geometry", () => {
    const ev = model.evaluate(createRecipe());
    expect(finite(ev.positions)).toBe(true);
    expect(finite(ev.normals)).toBe(true);
    expect(ev.groundOffset).toBeGreaterThan(0.7);
  });

  it("evaluates regional macro overrides to finite geometry that differs from the uniform recipe", () => {
    const uniform = model.evaluate(createRecipe({ macros: { gender: 0.15, age: 30 } }));
    const regional = model.evaluate(
      createRecipe({
        macros: { gender: 0.15, age: 30 },
        regionalMacros: { head: { gender: 0.95 }, chest: { gender: 0.9 } },
      }),
    );
    expect(finite(regional.positions)).toBe(true);
    let maxDiff = 0;
    for (let i = 0; i < uniform.positions.length; i++) {
      maxDiff = Math.max(
        maxDiff,
        Math.abs((uniform.positions[i] as number) - (regional.positions[i] as number)),
      );
    }
    expect(maxDiff).toBeGreaterThan(0.001);
  });
});
