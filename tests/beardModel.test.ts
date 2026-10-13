import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import type { BeardSpec, BeardStyle } from "../src/surface/bodyHair.ts";
import { bodyPackData } from "./fixtures.ts";
import { hairManifest, loadHairFixtureAssets } from "./hairFixtures.ts";

const model = new HumanoidModel(loadHairFixtureAssets());
const bearded = (beard: BeardStyle | BeardSpec, macros = { age: 35, gender: 1 }) =>
  createRecipe({ macros, bodyHair: { beard } });

/** The lowest y of a position array. */
const lowest = (p: Float32Array) => {
  let lo = Number.POSITIVE_INFINITY;
  for (let i = 1; i < p.length; i += 3) lo = Math.min(lo, p[i] as number);
  return lo;
};

/** The pack's strand map for beard cards: the generated cards draw with it. */
const packBeard = hairManifest.styles.find((s) => s.kind === "beard");

describe("a figure wearing a beard", () => {
  it("wears no cards clean-shaven, in stubble, or before the face's hair comes in", () => {
    expect(model.evaluate(createRecipe({ macros: { age: 35, gender: 1 } })).beard).toBeNull();
    expect(model.evaluate(bearded("stubble")).beard).toBeNull();
    expect(model.evaluate(bearded("full", { age: 9, gender: 1 })).beard).toBeNull();
  });

  it("wears cards generated for its beard, drawn with the pack's beard strand map", () => {
    const ev = model.evaluate(bearded("full"));
    expect(ev.beard?.id).toMatch(/^beard:/);
    const t = model.hairTopology(ev.beard?.id as string);
    expect(t.kind).toBe("beard");
    expect(ev.beard?.positions.length).toBe(t.vertexCount * 3);
    expect(t.rank?.length).toBe(t.vertexCount);
    expect(t.material.texture).toBe(packBeard?.material.texture);
    expect(t.strand).toEqual(packBeard?.strand);
    expect(t.occlusion.length).toBe(t.vertexCount);
  });

  it("wears them on a woman as on a man", () => {
    const woman = model.evaluate(bearded("full", { age: 35, gender: 0 })).beard;
    expect(woman).not.toBeNull();
  });

  it("hangs lower the longer it grows, and never past the floor", () => {
    const body = model.evaluate(bearded("full"));
    const full = lowest(body.beard?.positions as Float32Array);
    const chest = lowest(
      model.evaluate(bearded({ style: "longstreet", length: 0.4 })).beard
        ?.positions as Float32Array,
    );
    // 40 cm of hair, most of it falling: it leaves the chin forward and lies on the chest.
    expect(full - chest).toBeGreaterThan(0.25);
    const floor = lowest(body.positions);
    const toFloor = lowest(
      model.evaluate(bearded({ style: "longstreet", length: 9 })).beard?.positions as Float32Array,
    );
    expect(toFloor).toBeGreaterThanOrEqual(floor - 0.01);
    expect(toFloor - floor).toBeLessThan(0.2);
  });

  it("keeps its cards while it grows by less than a millimetre, and makes new ones past that", () => {
    const id = (length: number) =>
      model.evaluate(bearded({ style: "forked", length })).beard?.id as string;
    expect(id(0.1203)).toBe(id(0.1207));
    expect(id(0.1203)).not.toBe(id(0.13));
  });

  it("needs no beard file from the pack: the cards are made, not loaded", () => {
    const parsed = parseHumanoidAssets(bodyPackData(), undefined, undefined, {
      manifest: hairManifest,
    });
    const bare = new HumanoidModel(parsed);
    expect(bare.pendingHairStyles(bearded("longstreet"))).toEqual([]);
    expect(bare.evaluate(bearded("longstreet")).beard).not.toBeNull();
  });

  it("keeps serving the worn beard's topology after many lengths have come and gone", () => {
    let last = "";
    for (let mm = 40; mm <= 200; mm += 20)
      last = model.evaluate(bearded({ style: "full", length: mm / 1000 })).beard?.id as string;
    expect(model.hairTopology(last).kind).toBe("beard");
  });
});
