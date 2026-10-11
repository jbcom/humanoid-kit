import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sliderRange, withSliderValue } from "../src/editor/controls.ts";
import { beforeChange, sameRecipe } from "../src/editor/gate.ts";
import {
  assertControls,
  type ControlLimits,
  limitedRange,
  limitRecipe,
  macroRange,
  visiblePanels,
  visibleTasks,
} from "../src/editor/limits.ts";
import type { SliderEntry } from "../src/format/assetFormat.ts";
import { agePolicyViolations } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets(true);
const modifiers = assets.modifiers;
const tasks = assets.sliders;
const allSliders = tasks.flatMap((t) => t.groups.flatMap((g) => g.sliders));
const slider = (id: string): SliderEntry => {
  const s = allSliders.find((x) => x.id === id);
  if (!s) throw new Error(`no slider ${id}`);
  return s;
};
const adultSlider = allSliders.find((s) => s.kind === "modifier" && modifiers.get(s.id)?.adultOnly);
const TWO_SIDED = "nose/nose-scale-horiz-decr|incr";
const ONE_SIDED = "head/head-oval";

describe("assertControls", () => {
  it("accepts no controls, and ranges of every shape that makes sense", () => {
    expect(() => assertControls({})).not.toThrow();
    expect(() =>
      assertControls({ ranges: { age: { min: 25 }, weight: { max: 0.7 }, height: {} } }),
    ).not.toThrow();
    expect(() => assertControls({ ranges: { age: { min: 30, max: 30 } } })).not.toThrow();
  });

  it("refuses a range that is empty, not a number, or on an ethnic macro", () => {
    expect(() => assertControls({ ranges: { age: { min: 40, max: 30 } } })).toThrow(RangeError);
    expect(() => assertControls({ ranges: { age: { min: Number.NaN } } })).toThrow(RangeError);
    expect(() => assertControls({ ranges: { weight: { max: Number.POSITIVE_INFINITY } } })).toThrow(
      RangeError,
    );
    for (const id of ["african", "asian", "caucasian"])
      expect(() => assertControls({ ranges: { [id]: { min: 0.1 } } })).toThrow(/ethnic/);
  });
});

describe("limitedRange", () => {
  it("narrows a slider's own range, keeps its step, and keeps neutral inside", () => {
    const age = slider("age");
    const base = sliderRange(age, modifiers);
    const r = limitedRange(age, base, { ranges: { age: { min: 30, max: 60 } } });
    expect(r).toEqual({ min: 30, max: 60, step: base.step, neutral: 30 });
    const oval = slider(ONE_SIDED);
    const o = limitedRange(oval, sliderRange(oval, modifiers), {
      ranges: { [ONE_SIDED]: { min: 0.2 } },
    });
    expect(o.min).toBe(0.2);
    expect(o.max).toBe(1);
    expect(o.neutral).toBe(0.2);
  });

  it("leaves a slider with no range alone", () => {
    const age = slider("age");
    const base = sliderRange(age, modifiers);
    expect(limitedRange(age, base, undefined)).toEqual(base);
    expect(limitedRange(age, base, { ranges: { weight: { min: 0.2 } } })).toEqual(base);
  });

  it("refuses a range that does not meet the slider's own", () => {
    const age = slider("age");
    const base = sliderRange(age, modifiers);
    expect(() => limitedRange(age, base, { ranges: { age: { min: 95 } } })).toThrow(RangeError);
    expect(() => limitedRange(age, base, { ranges: { age: { max: 0 } } })).toThrow(RangeError);
  });

  it("gives a regional override the range of its macro, and age none", () => {
    expect(macroRange("breastSize", { ranges: { breastSize: { min: 0.2, max: 0.8 } } })).toEqual({
      min: 0.2,
      max: 0.8,
    });
    expect(macroRange("weight", undefined)).toEqual({ min: 0, max: 1 });
  });
});

describe("limitRecipe", () => {
  const floor: ControlLimits = { ranges: { age: { min: 25 } } };

  it("returns the very recipe it was given when nothing is out of range", () => {
    const r = createRecipe({ macros: { age: 30 } });
    expect(limitRecipe(r, floor, modifiers)).toBe(r);
    expect(limitRecipe(r, {}, modifiers)).toBe(r);
  });

  it("clamps age to the floor through withAge, leaving the input alone", () => {
    const r = createRecipe({ macros: { age: 16 } });
    const before = structuredClone(r);
    const out = limitRecipe(r, floor, modifiers);
    expect(out.macros.age).toBe(25);
    expect(r).toEqual(before);
    expect(recipeProblems(out)).toEqual([]);
  });

  it("clamps macros, a regional override of a limited macro, and modifiers", () => {
    const r = createRecipe({
      macros: { age: 30, weight: 0.95, muscle: 0.05 },
      regionalMacros: { chest: { weight: 1, muscle: 0.5 }, head: { gender: 0.1 } },
      modifiers: { [TWO_SIDED]: -0.9, [ONE_SIDED]: 0.1 },
    });
    const out = limitRecipe(
      r,
      {
        ranges: {
          weight: { max: 0.7 },
          muscle: { min: 0.3 },
          [TWO_SIDED]: { min: -0.5, max: 0.5 },
          [ONE_SIDED]: { min: 0.25 },
        },
      },
      modifiers,
    );
    expect(out.macros.weight).toBe(0.7);
    expect(out.macros.muscle).toBe(0.3);
    expect(out.regionalMacros.chest).toEqual({ weight: 0.7, muscle: 0.5 });
    expect(out.regionalMacros.head).toEqual({ gender: 0.1 });
    expect(out.modifiers[TWO_SIDED]).toBe(-0.5);
    expect(out.modifiers[ONE_SIDED]).toBe(0.25);
  });

  it("pins a value with a range of one, and a modifier pinned at zero is dropped", () => {
    const r = createRecipe({ macros: { age: 40, height: 0.9 }, modifiers: { [TWO_SIDED]: 0.4 } });
    const out = limitRecipe(
      r,
      { ranges: { height: { min: 0.5, max: 0.5 }, [TWO_SIDED]: { min: 0, max: 0 } } },
      modifiers,
    );
    expect(out.macros.height).toBe(0.5);
    expect(TWO_SIDED in out.modifiers).toBe(false);
  });

  it("clamps a modifier it has no entry for as well, by the limit alone", () => {
    const r = createRecipe({ macros: { age: 30 }, modifiers: { "not/in-packs": 0.9 } });
    expect(
      limitRecipe(r, { ranges: { "not/in-packs": { max: 0.4 } } }, modifiers).modifiers[
        "not/in-packs"
      ],
    ).toBe(0.4);
  });

  it("still drops adult-only values when the floor leaves an age under 18", () => {
    if (!adultSlider) throw new Error("fixture has no adult slider");
    const adult = withSliderValue(
      createRecipe({ macros: { age: 30 } }),
      adultSlider,
      0.5,
      modifiers,
    );
    const out = limitRecipe(adult, { ranges: { age: { min: 1, max: 16 } } }, modifiers);
    expect(out.macros.age).toBe(16);
    expect(agePolicyViolations(out)).toEqual([]);
    expect(out.modifiers[adultSlider.id]).toBeUndefined();
  });

  it("is idempotent, and every result sits inside every range", () => {
    const controls: ControlLimits = {
      ranges: {
        age: { min: 25, max: 60 },
        weight: { min: 0.2, max: 0.8 },
        [TWO_SIDED]: { min: -0.3 },
      },
    };
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 90, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (age, weight, nose) => {
          const r = createRecipe({
            macros: { age, weight },
            regionalMacros: { legs: { weight } },
            modifiers: { [TWO_SIDED]: nose },
          });
          const out = limitRecipe(r, controls, modifiers);
          expect(out.macros.age).toBeGreaterThanOrEqual(25);
          expect(out.macros.age).toBeLessThanOrEqual(60);
          expect(out.macros.weight).toBeGreaterThanOrEqual(0.2);
          expect(out.macros.weight).toBeLessThanOrEqual(0.8);
          expect(out.regionalMacros.legs?.weight).toBeGreaterThanOrEqual(0.2);
          expect(out.regionalMacros.legs?.weight).toBeLessThanOrEqual(0.8);
          expect(out.modifiers[TWO_SIDED] ?? 0).toBeGreaterThanOrEqual(-0.3);
          expect(limitRecipe(out, controls, modifiers)).toBe(out);
        },
      ),
    );
  });
});

describe("visibleTasks and visiblePanels", () => {
  it("returns the taxonomy itself when nothing is hidden", () => {
    expect(visibleTasks(tasks, undefined)).toBe(tasks);
    expect(visibleTasks(tasks, { ranges: { age: { min: 25 } } })).toBe(tasks);
  });

  it("drops hidden sliders, then the groups and tasks they empty, and hidden tasks", () => {
    const task = tasks.find((t) => t.groups.some((g) => g.sliders.some((s) => s.id === "age")));
    if (!task) throw new Error("no task holds age");
    const out = visibleTasks(tasks, { hide: ["age"] });
    expect(out.flatMap((t) => t.groups.flatMap((g) => g.sliders)).some((s) => s.id === "age")).toBe(
      false,
    );
    for (const t of out) {
      expect(t.groups.length).toBeGreaterThan(0);
      for (const g of t.groups) expect(g.sliders.length).toBeGreaterThan(0);
    }
    const hidden = visibleTasks(tasks, { hideTasks: [task.id] });
    expect(hidden.some((t) => t.id === task.id)).toBe(false);
    expect(hidden.length).toBe(tasks.length - 1);
    // Unrelated tasks are the same objects: nothing is rebuilt that did not change.
    const other = tasks.find((t) => t.id !== task.id);
    expect(hidden.find((t) => t.id === other?.id)).toBe(other);
  });

  it("lists the panels left in", () => {
    expect([...visiblePanels(undefined)].sort()).toEqual(["appearance", "regions", "wardrobe"]);
    expect([...visiblePanels({ hidePanels: ["regions"] })].sort()).toEqual([
      "appearance",
      "wardrobe",
    ]);
  });
});

describe("beforeChange", () => {
  const current = createRecipe({ macros: { age: 30 } });
  const proposed = createRecipe({ macros: { age: 40 } });

  it("accepts what it is given when there is no hook", () => {
    expect(beforeChange(proposed, { cause: "edit", current }, undefined)).toEqual({
      accepted: true,
      recipe: proposed,
    });
  });

  it("passes the cause and the current figure, and takes the hook's recipe", () => {
    const seen: unknown[] = [];
    const clamped = createRecipe({ macros: { age: 35 } });
    const out = beforeChange(proposed, { cause: "randomize", current }, (p, c) => {
      seen.push(p, c);
      return clamped;
    });
    expect(out).toEqual({ accepted: true, recipe: clamped });
    expect(seen).toEqual([proposed, { cause: "randomize", current }]);
  });

  it("refuses when the hook says false", () => {
    expect(beforeChange(proposed, { cause: "edit", current }, () => false)).toEqual({
      accepted: false,
    });
  });

  it("throws a TypeError for anything else, so a hook that forgot to return fails loudly", () => {
    for (const bad of [undefined, true, null, {}, { ...proposed, version: 2 }])
      expect(() =>
        beforeChange(proposed, { cause: "edit", current }, (() => bad) as never),
      ).toThrow(TypeError);
  });

  it("lets a hook's own error through", () => {
    expect(() =>
      beforeChange(proposed, { cause: "edit", current }, () => {
        throw new Error("hook failed");
      }),
    ).toThrow("hook failed");
  });
});

describe("sameRecipe", () => {
  it("compares by content, not identity", () => {
    const r = createRecipe({ macros: { age: 30 }, modifiers: { [TWO_SIDED]: 0.2 } });
    expect(sameRecipe(r, r)).toBe(true);
    expect(sameRecipe(r, structuredClone(r))).toBe(true);
    expect(
      sameRecipe(r, createRecipe({ macros: { age: 31 }, modifiers: { [TWO_SIDED]: 0.2 } })),
    ).toBe(false);
    expect(sameRecipe(r, createRecipe({ macros: { age: 30 } }))).toBe(false);
  });
});
