import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { RecipeError } from "../src/makehuman/recipeMorph.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { MorphError } from "../src/morph/evaluate.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { RecipeValidationError } from "../src/recipe/validate.ts";
import { bodyPackData } from "./fixtures.ts";
import { hairManifest, loadHairFixtureAssets } from "./hairFixtures.ts";

const assets = loadHairFixtureAssets();
const model = new HumanoidModel(assets);
const hairy = (style: string, extra: Parameters<typeof createRecipe>[0] = {}) =>
  createRecipe({ ...extra, hair: { style } });

/** The extent of a position array along an axis (0 x, 1 y, 2 z), over the vertices `keep` admits. */
const extent = (p: Float32Array, axis: number, keep: (y: number) => boolean = () => true) => {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let v = 0; v < p.length / 3; v++) {
    if (!keep(p[v * 3 + 1] as number)) continue;
    lo = Math.min(lo, p[v * 3 + axis] as number);
    hi = Math.max(hi, p[v * 3 + axis] as number);
  }
  return { lo, hi, size: hi - lo };
};

describe("evaluating a figure with hair", () => {
  it("has no hair for a recipe that asks for none, or for style null", () => {
    expect(model.evaluate(createRecipe()).hair).toBeNull();
    expect(model.evaluate(createRecipe({ hair: { style: null } })).hair).toBeNull();
  });

  it("evaluates the worn style on the figure's own mesh, one vertex per render vertex", () => {
    for (const s of hairManifest.styles) {
      const e = model.evaluate(hairy(s.id));
      const t = model.hairTopology(s.id);
      expect(e.hair?.id).toBe(s.id);
      expect(e.hair?.positions.length, s.id).toBe(t.vertexCount * 3);
      expect(e.hair?.normals.length, s.id).toBe(t.vertexCount * 3);
      expect(t.index.length % 3).toBe(0);
      expect(Math.max(...t.index)).toBeLessThan(t.vertexCount);
    }
  });

  it("leaves the body exactly as it was: hair is not clothing and hides no skin", () => {
    const bald = model.evaluate(createRecipe());
    const haired = model.evaluate(hairy("long01"));
    expect(haired.positions).toEqual(bald.positions);
    expect(haired.control).toEqual(bald.control);
    expect(haired.attachments.length).toBe(bald.attachments.length);
    expect(haired.groundOffset).toBe(bald.groundOffset);
  });

  it("is deterministic", () => {
    const a = model.evaluate(hairy("bob01")).hair;
    const b = model.evaluate(hairy("bob01")).hair;
    expect(a?.positions).toEqual(b?.positions);
    expect(a?.normals).toEqual(b?.normals);
  });

  it("sits on the head: above the crown, over the scalp, whatever the figure's height or age", () => {
    for (const recipe of [
      { macros: { age: 25 } },
      { macros: { age: 8 } },
      { macros: { age: 80 } },
      { macros: { height: 1, gender: 1 } },
      { macros: { height: 0, gender: 0 } },
    ]) {
      const e = model.evaluate(hairy("short02", recipe));
      const body = extent(e.positions, 1);
      const hair = extent((e.hair as { positions: Float32Array }).positions, 1);
      // Short hair is a cap: its top is at or just above the crown, never far from it.
      expect(hair.hi - body.hi, JSON.stringify(recipe)).toBeGreaterThan(-0.03);
      expect(hair.hi - body.hi, JSON.stringify(recipe)).toBeLessThan(0.06);
    }
  });

  it("follows the head's shape: a wider head gets proportionally wider hair", () => {
    const narrow = model.evaluate(
      hairy("short02", { modifiers: { "head/head-scale-horiz-decr|incr": -1 } }),
    );
    const wide = model.evaluate(
      hairy("short02", { modifiers: { "head/head-scale-horiz-decr|incr": 1 } }),
    );
    const hairRatio =
      extent((wide.hair as { positions: Float32Array }).positions, 0).size /
      extent((narrow.hair as { positions: Float32Array }).positions, 0).size;
    // The skull's own width, over the vertices in the top 12 cm of the figure (a head is about 22 cm).
    const top = extent(narrow.positions, 1).hi;
    const head = (y: number) => y > top - 0.12;
    const headRatio = extent(wide.positions, 0, head).size / extent(narrow.positions, 0, head).size;
    expect(headRatio).toBeGreaterThan(1.05);
    expect(hairRatio).toBeGreaterThan(1.05);
    expect(Math.abs(hairRatio - headRatio)).toBeLessThan(0.05);
  });

  it("works at every subdivision level", () => {
    for (const subdivision of [0, 1, 2]) {
      const m = new HumanoidModel(assets, { subdivision });
      expect(m.evaluate(hairy("short04")).hair?.positions.length).toBe(
        m.hairTopology("short04").vertexCount * 3,
      );
    }
  });
});

describe("hair topology", () => {
  it("carries the style's material, label, tags and strand data for the renderer", () => {
    const t = model.hairTopology("long01");
    const entry = hairManifest.styles.find((s) => s.id === "long01");
    expect(t.id).toBe("long01");
    expect(t.label).toBe(entry?.label);
    expect(t.tags).toEqual(entry?.tags);
    expect(t.strand).toEqual(entry?.strand);
    expect(t.material.backfaceCull).toBe(false);
    expect(t.skinIndex.length).toBe(t.vertexCount * 4);
    expect(t.skinWeight.length).toBe(t.vertexCount * 4);
    expect(t.uvs.length).toBe(t.vertexCount * 2);
  });

  it("has occlusion per render vertex, in [0, 1], not all open and not all shut", () => {
    for (const s of hairManifest.styles) {
      const t = model.hairTopology(s.id);
      expect(t.occlusion.length, s.id).toBe(t.vertexCount);
      let min = 1;
      let max = 0;
      for (const o of t.occlusion) {
        expect(o >= 0 && o <= 1, s.id).toBe(true);
        min = Math.min(min, o);
        max = Math.max(max, o);
      }
      expect(min, s.id).toBeLessThan(0.7);
      expect(max, s.id).toBeGreaterThan(0.9);
    }
  });

  it("resolves the strand map's URL from the pack's files, when the pack was loaded with URLs", () => {
    expect(model.hairTopology("short02").textureUrl).toBeNull();
    const withUrls = parseHumanoidAssets(
      {
        ...bodyPackData(),
        fileUrls: new Map([["short02.webp", "https://example.test/short02.webp"]]),
      },
      undefined,
      { manifest: hairManifest },
    );
    for (const s of hairManifest.styles)
      withUrls.hair?.bound.set(s.id, assets.hair?.bound.get(s.id) as never);
    expect(new HumanoidModel(withUrls).hairTopology("short02").textureUrl).toBe(
      "https://example.test/short02.webp",
    );
  });
});

describe("a style that cannot be worn", () => {
  it("is rejected when it is not in the pack, naming it", () => {
    expect(() => model.evaluate(hairy("no-such-style"))).toThrow(RecipeError);
    expect(() => model.evaluate(hairy("no-such-style"))).toThrow(
      /unknown hair style no-such-style/,
    );
    expect(() => model.pendingHair(hairy("no-such-style"))).toThrow(RecipeError);
  });

  it("is rejected when no hair pack is loaded", () => {
    const bare = new HumanoidModel(parseHumanoidAssets(bodyPackData()));
    expect(() => bare.evaluate(hairy("short02"))).toThrow(/no hair pack is loaded/);
  });

  it("is rejected, not evaluated, when its geometry has not arrived, and says how to wait", () => {
    const parsed = parseHumanoidAssets(bodyPackData(), undefined, { manifest: hairManifest });
    const m = new HumanoidModel(parsed);
    expect(m.pendingHair(hairy("bob02"))).toBe("bob02");
    expect(m.pendingHair(createRecipe())).toBeNull();
    expect(() => m.evaluate(hairy("bob02"))).toThrow(MorphError);
    expect(() => m.evaluate(hairy("bob02"))).toThrow(/has not loaded yet/);
  });

  it("is rejected by recipe validation when the hair itself is malformed", () => {
    const r = createRecipe({ hair: { style: "short02" } });
    (r.hair as { style: unknown }).style = 7;
    expect(() => model.evaluate(r)).toThrow(RecipeValidationError);
  });
});
