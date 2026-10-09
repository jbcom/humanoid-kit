import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { RecipeValidationError } from "../src/recipe/validate.ts";
import { bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });

const finite = (a: Float32Array) => a.every((x) => Number.isFinite(x));

describe("HumanoidModel", () => {
  it("evaluates a figure as soon as its own target files are in, and names what else it waits for", () => {
    // Core and young: enough for any figure between 11 and 25 years without modifiers.
    const early = new HumanoidModel(parseHumanoidAssets(bodyPackData(["core", "young"])), {
      subdivision: 0,
    });
    const full = new HumanoidModel(loadFixtureAssets(), { subdivision: 0 });
    const young = createRecipe({ macros: { gender: 0.2, age: 25, weight: 0.8, height: 0.7 } });
    expect(early.pendingTargetFiles(young).size).toBe(0);
    expect(early.evaluate(young).positions).toEqual(full.evaluate(young).positions);
    const older = createRecipe({ macros: { age: 60 } });
    expect([...early.pendingTargetFiles(older)]).toEqual(["old"]);
    expect(() => early.evaluate(older)).toThrow(/target files that have not loaded yet: old/);
    const shaped = createRecipe({ modifiers: { "nose/nose-scale-horiz-decr|incr": 0.5 } });
    expect([...early.pendingTargetFiles(shaped)]).toEqual(["modifiers"]);
    // A malformed recipe (from JSON, say) is still reported by validation.
    const { modifiers: _m, ...noModifiers } = createRecipe();
    expect(() => early.evaluate(noModifiers as never)).toThrow(RecipeValidationError);
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
