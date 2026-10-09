import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatSliderValue,
  sliderAvailability,
  sliderRange,
  sliderValue,
  withSliderValue,
} from "../src/editor/controls.ts";
import {
  FRAME_PARTS,
  frameCamera,
  frameRequest,
  partBounds,
  vertexFrameParts,
} from "../src/editor/framing.ts";
import { createHistory, HISTORY_LIMIT, historyReducer } from "../src/editor/history.ts";
import { randomRecipe } from "../src/editor/randomize.ts";
import type { SliderEntry } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { AgePolicyError, agePolicyViolations } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets(true);
const modifiers = assets.modifiers;
const allSliders = assets.sliders.flatMap((t) => t.groups.flatMap((g) => g.sliders));
const slider = (id: string) => {
  const s = allSliders.find((x) => x.id === id);
  if (!s) throw new Error(`no slider ${id}`);
  return s;
};
const adultSlider = allSliders.find((s) => s.kind === "modifier" && modifiers.get(s.id)?.adultOnly);

describe("editor controls", () => {
  it("gives every slider a range containing its neutral value and the default recipe's value", () => {
    const r = createRecipe();
    for (const s of allSliders) {
      const range = sliderRange(s, modifiers);
      expect(range.min).toBeLessThan(range.max);
      expect(range.neutral).toBeGreaterThanOrEqual(range.min);
      expect(range.neutral).toBeLessThanOrEqual(range.max);
      const v = sliderValue(r, s);
      expect(v, s.id).toBeGreaterThanOrEqual(range.min);
      expect(v, s.id).toBeLessThanOrEqual(range.max);
    }
  });

  it("writes every slider so it reads back, clamped, without touching the input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allSliders.filter((s) => s.id !== "age")),
        fc.double({ min: -2, max: 2, noNaN: true }),
        (s, v) => {
          const r = createRecipe({ macros: { age: 30 } });
          const before = structuredClone(r);
          const next = withSliderValue(r, s, v, modifiers);
          const range = sliderRange(s, modifiers);
          expect(sliderValue(next, s)).toBeCloseTo(Math.min(range.max, Math.max(range.min, v)), 9);
          expect(r).toEqual(before);
          expect(recipeProblems(next)).toEqual([]);
        },
      ),
    );
  });

  it("keeps the ethnic macros summing to one, as MakeHuman does", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("african", "asian", "caucasian"),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom("african", "asian", "caucasian"),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, va, b, vb) => {
          let r = createRecipe();
          r = withSliderValue(r, slider(a), va, modifiers);
          r = withSliderValue(r, slider(b), vb, modifiers);
          const { african, asian, caucasian } = r.macros;
          expect(african + asian + caucasian).toBeCloseTo(1, 9);
          expect(r.macros[b as "african"]).toBeCloseTo(vb, 9);
        },
      ),
    );
  });

  it("drops adult anatomy values when the age slider moves under 18", () => {
    if (!adultSlider) throw new Error("fixture has no adult slider");
    let r = withSliderValue(createRecipe({ macros: { age: 30 } }), adultSlider, 0.6, modifiers);
    expect(r.modifiers[adultSlider.id]).toBe(0.6);
    r = withSliderValue(r, slider("age"), 12, modifiers);
    expect(r.modifiers[adultSlider.id]).toBeUndefined();
    expect(agePolicyViolations(r)).toEqual([]);
  });

  it("refuses to write an adult anatomy value under 18, even without an availability check", () => {
    if (!adultSlider) throw new Error("fixture has no adult slider");
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 17.99, noNaN: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        (age, v) => {
          const r = createRecipe({ macros: { age } });
          expect(() => withSliderValue(r, adultSlider, v, modifiers)).toThrow(AgePolicyError);
          expect(withSliderValue(r, adultSlider, 0, modifiers).modifiers).toEqual({});
        },
      ),
    );
  });

  it("makes adult anatomy sliders unavailable under 18, with a reason", () => {
    if (!adultSlider) throw new Error("fixture has no adult slider");
    const minor = sliderAvailability(createRecipe({ macros: { age: 17 } }), adultSlider, modifiers);
    expect(minor.enabled).toBe(false);
    if (!minor.enabled) expect(minor.reason).toMatch(/18/);
    expect(
      sliderAvailability(createRecipe({ macros: { age: 18 } }), adultSlider, modifiers),
    ).toEqual({ enabled: true });
  });

  it("drops modifiers set back to neutral, so recipes stay small", () => {
    const s = slider("nose/nose-scale-horiz-decr|incr");
    const r = withSliderValue(createRecipe(), s, 0.4, modifiers);
    expect(Object.keys(withSliderValue(r, s, 0, modifiers).modifiers)).toEqual([]);
  });

  it("formats values for display", () => {
    const age = slider("age");
    expect(formatSliderValue(age, 34, sliderRange(age, modifiers))).toBe("34 yr");
    expect(formatSliderValue(age, 17.5, sliderRange(age, modifiers))).toBe("17.5 yr");
    const nose = slider("nose/nose-scale-horiz-decr|incr");
    expect(formatSliderValue(nose, 0.4, sliderRange(nose, modifiers))).toBe("+40%");
    const oval = slider("head/head-oval");
    expect(formatSliderValue(oval, 0.4, sliderRange(oval, modifiers))).toBe("40%");
  });
});

describe("recipe history", () => {
  const r = (age: number) => createRecipe({ macros: { age } });

  it("undoes and redoes discrete changes", () => {
    let h = createHistory(r(20));
    h = historyReducer(h, { type: "set", recipe: r(30) });
    h = historyReducer(h, { type: "set", recipe: r(40) });
    h = historyReducer(h, { type: "undo" });
    expect(h.present.macros.age).toBe(30);
    h = historyReducer(h, { type: "redo" });
    expect(h.present.macros.age).toBe(40);
  });

  it("keeps one drag as one undo step, and a new drag as another", () => {
    let h = createHistory(r(20));
    for (const a of [21, 22, 23])
      h = historyReducer(h, { type: "set", recipe: r(a), gesture: "age" });
    h = historyReducer(h, { type: "settle" });
    for (const a of [24, 25]) h = historyReducer(h, { type: "set", recipe: r(a), gesture: "age" });
    expect(h.past.map((x) => x.macros.age)).toEqual([20, 23]);
    h = historyReducer(h, { type: "undo" });
    expect(h.present.macros.age).toBe(23);
  });

  it("clears redo on a new change and caps the undo stack", () => {
    let h = createHistory(r(1));
    for (let i = 0; i < HISTORY_LIMIT + 20; i++)
      h = historyReducer(h, { type: "set", recipe: r(2 + (i % 80)) });
    expect(h.past.length).toBe(HISTORY_LIMIT);
    h = historyReducer(h, { type: "undo" });
    h = historyReducer(h, { type: "set", recipe: r(5) });
    expect(h.future).toEqual([]);
  });

  it("ignores undo and redo at the ends", () => {
    const h = createHistory(r(20));
    expect(historyReducer(h, { type: "undo" })).toBe(h);
    expect(historyReducer(h, { type: "redo" })).toBe(h);
  });
});

describe("randomRecipe", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const base = createRecipe();
    expect(randomRecipe(base, 7, modifiers)).toEqual(randomRecipe(base, 7, modifiers));
    expect(randomRecipe(base, 7, modifiers)).not.toEqual(randomRecipe(base, 8, modifiers));
  });

  it("always produces a valid recipe that obeys the age policy", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 }),
        fc.double({ min: 1, max: 90, noNaN: true }),
        fc.boolean(),
        (seed, age, includeAdultAnatomy) => {
          const r = randomRecipe(createRecipe({ macros: { age } }), seed, modifiers, {
            includeAdultAnatomy,
          });
          expect(recipeProblems(r)).toEqual([]);
          expect(agePolicyViolations(r)).toEqual([]);
          expect(r.macros.age).toBe(age);
          expect(r.macros.african + r.macros.asian + r.macros.caucasian).toBeCloseTo(1, 9);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("leaves adult anatomy alone unless asked", () => {
    for (let seed = 0; seed < 40; seed++) {
      const r = randomRecipe(createRecipe({ macros: { age: 40 } }), seed, modifiers, {
        modifierChance: 1,
      });
      for (const id of Object.keys(r.modifiers))
        expect(modifiers.get(id)?.adultOnly, id).toBe(false);
    }
  });
});

describe("framing", () => {
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const topo = model.topology().body;
  const bones = assets.manifest.skeleton.bones.map((b) => b.name);
  const parts = vertexFrameParts(topo.skinIndex, topo.skinWeight, bones);
  const { positions } = model.evaluate(createRecipe());
  const bounds = (p: (typeof FRAME_PARTS)[number]) => {
    const b = partBounds(positions, parts, p);
    if (!b) throw new Error(`no vertices for ${p}`);
    return b;
  };

  it("finds every part, each inside the whole body", () => {
    const body = bounds("body");
    for (const p of FRAME_PARTS) {
      const b = bounds(p);
      for (let k = 0; k < 3; k++) {
        expect(b.min[k]).toBeGreaterThanOrEqual(body.min[k] as number);
        expect(b.max[k]).toBeLessThanOrEqual(body.max[k] as number);
      }
    }
  });

  it("puts the head on top, the figure's left at +x and the feet at the bottom", () => {
    const head = bounds("head");
    const feet = bounds("leftFoot");
    expect(head.min[1]).toBeGreaterThan(bounds("leftHand").max[1]);
    expect(feet.max[1]).toBeLessThan(bounds("leftHand").min[1]);
    expect(bounds("leftHand").min[0]).toBeGreaterThan(0);
    expect(bounds("rightHand").max[0]).toBeLessThan(0);
  });

  it("frames a whole leg, from the hip down", () => {
    const body = bounds("body");
    const leg = bounds("leftLeg");
    const height = body.max[1] - body.min[1];
    expect(leg.max[1] - body.min[1]).toBeGreaterThan(0.47 * height);
    expect(leg.min[1]).toBeCloseTo(body.min[1], 1);
  });

  it("resolves MakeHuman's camera hints", () => {
    expect(frameRequest("leftHandFrontCamera", null)).toEqual({
      part: "leftHand",
      direction: "front",
    });
    expect(frameRequest("rightArmTopCamera", null)).toEqual({ part: "rightArm", direction: "top" });
    expect(frameRequest("frontView", "faceCamera")).toEqual({ part: "head", direction: "front" });
    expect(frameRequest("leftView", null)).toEqual({ part: "body", direction: "left" });
    expect(frameRequest(null, "faceCamera")).toEqual({ part: "head", direction: "front" });
    expect(frameRequest("globalCamera", "faceCamera")).toEqual({
      part: "body",
      direction: "front",
    });
  });

  it("places the camera on the requested side, far enough to fit the part", () => {
    const b = bounds("head");
    const front = frameCamera(b, "front", 35, 1);
    expect(front.position[2]).toBeGreaterThan(b.max[2]);
    const left = frameCamera(b, "left", 35, 1);
    expect(left.position[0]).toBeGreaterThan(b.max[0]);
    const wide = frameCamera(bounds("body"), "front", 35, 1);
    expect(wide.position[2]).toBeGreaterThan(front.position[2]);
  });

  it("has a camera hint parse for every hint the packs use", () => {
    const hints = new Set(allSliders.map((s: SliderEntry) => s.camera));
    for (const h of hints) {
      const req = frameRequest(h, null);
      expect(FRAME_PARTS).toContain(req.part);
    }
  });
});
