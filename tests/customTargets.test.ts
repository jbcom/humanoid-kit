/**
 * MakeHuman custom targets (src/makehuman/customTargets.ts): a registered target is
 * the one-sided modifier `custom/<name>`, applied at its value like MakeHuman's
 * Modelling > Custom sliders, and it changes no recipe that does not name it.
 */
import { describe, expect, it } from "vitest";
import {
  CustomTargetError,
  customTargetId,
  customTargetOf,
} from "../src/makehuman/customTargets.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 0, attachments: [] });
const n = assets.manifest.vertexCount;

/** A 4 mm forward push on a handful of vertices. */
const offsets = new Float32Array(n * 3);
for (const v of [10, 11, 500, 4000]) offsets[v * 3 + 2] = 0.004;

describe("custom targets", () => {
  model.addCustomTargets([customTargetOf("probe", offsets)]);
  const plain = createRecipe({});
  const base = model.evaluate(plain).control;

  it("applies `custom/<name>` at its value, on exactly the vertices it moves", () => {
    const half = model.evaluate(createRecipe({ modifiers: { [customTargetId("probe")]: 0.5 } }));
    for (let i = 0; i < n * 3; i++)
      expect(
        Math.abs((half.control[i] as number) - (base[i] as number) - 0.5 * (offsets[i] as number)),
      ).toBeLessThan(1e-6);
  });

  it("changes nothing for a recipe that does not name it", () => {
    const fresh = new HumanoidModel(loadFixtureAssets(), { subdivision: 0, attachments: [] });
    expect(Buffer.from(fresh.evaluate(plain).control.buffer).equals(Buffer.from(base.buffer))).toBe(
      true,
    );
  });

  it("is one-sided like MakeHuman's custom sliders", () => {
    expect(() =>
      model.evaluate(createRecipe({ modifiers: { [customTargetId("probe")]: -0.5 } })),
    ).toThrow(/one-sided/);
  });

  it("replaces a custom target registered again under the same name", () => {
    model.addCustomTargets([customTargetOf("again", offsets)]);
    const doubled = Float32Array.from(offsets, (x) => 2 * x);
    model.addCustomTargets([customTargetOf("again", doubled)]);
    const got = model.evaluate(createRecipe({ modifiers: { [customTargetId("again")]: 1 } }));
    expect((got.control[10 * 3 + 2] as number) - (base[10 * 3 + 2] as number)).toBeCloseTo(
      0.008,
      6,
    );
  });

  it("refuses malformed targets and pack modifier names before adding any", () => {
    const ok = customTargetOf("fine", offsets);
    const bad = [
      { ...ok, name: "../escape" },
      { ...ok, indices: [5, 3], deltas: [0, 0, 0, 0, 0, 0] },
      { ...ok, indices: [n], deltas: [0, 0, 1] },
      { ...ok, deltas: [1, 2] },
      { ...ok, scale: 0 },
      { ...ok, deltas: Array.from(ok.deltas, () => 40000) },
    ];
    for (const t of bad) expect(() => model.addCustomTargets([t])).toThrow(CustomTargetError);
    expect(() => model.addCustomTargets([ok, ok])).toThrow(/twice/);
    expect(assets.modifiers.has(customTargetId("fine"))).toBe(false);
    // A pack modifier whose id happens to sit in a `custom` path is never overwritten.
    assets.modifiers.set("custom/packed", {
      id: "custom/packed",
      group: "torso",
      lo: null,
      hi: "x",
      adultOnly: false,
    });
    expect(() => model.addCustomTargets([{ ...ok, name: "packed" }])).toThrow(/pack modifier/);
  });
});
