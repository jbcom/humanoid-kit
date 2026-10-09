import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { RecipeError } from "../src/makehuman/recipeMorph.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { assertValidRecipe, RecipeValidationError } from "../src/recipe/validate.ts";
import { bodyPackData } from "./fixtures.ts";
import { hairManifest, loadHairFixtureAssets } from "./hairFixtures.ts";

const assets = loadHairFixtureAssets();
const model = new HumanoidModel(assets);
const worn = (extra: { style?: string | null; brows?: string; lashes?: string } = {}) =>
  createRecipe({ hair: { style: null, brows: "eyebrow001", lashes: "eyelashes01", ...extra } });

describe("the recipe's brows and lashes", () => {
  it("are part of the hair only when named, so a recipe without them serialises as before", () => {
    const plain = createRecipe({ hair: { style: "short02" } });
    expect(Object.keys(plain.hair ?? {}).sort()).toEqual(["colour", "style"]);
    expect(JSON.stringify(createRecipe({ hair: { style: null } }).hair)).not.toMatch(
      /brows|lashes/,
    );
    const both = worn();
    expect(both.hair?.brows).toBe("eyebrow001");
    expect(both.hair?.lashes).toBe("eyelashes01");
    expect(
      createRecipe({ hair: { style: null, brows: "eyebrow002" } }).hair?.lashes,
    ).toBeUndefined();
  });

  it("are validated as ids, like the style", () => {
    expect(() => assertValidRecipe(worn())).not.toThrow();
    for (const bad of [7, "", null]) {
      const r = worn();
      (r.hair as { brows: unknown }).brows = bad;
      expect(() => assertValidRecipe(r), String(bad)).toThrow(RecipeValidationError);
      const l = worn();
      (l.hair as { lashes: unknown }).lashes = bad;
      expect(() => assertValidRecipe(l), String(bad)).toThrow(/hair\.lashes/);
    }
  });
});

describe("evaluating a figure with brows and lashes", () => {
  it("wears each on the figure's own mesh, whatever the scalp hair", () => {
    for (const style of [null, "short02"]) {
      const e = model.evaluate(worn({ style }));
      expect(e.brows?.id).toBe("eyebrow001");
      expect(e.lashes?.id).toBe("eyelashes01");
      expect(e.brows?.positions.length).toBe(model.hairTopology("eyebrow001").vertexCount * 3);
      expect(e.lashes?.normals.length).toBe(model.hairTopology("eyelashes01").vertexCount * 3);
      expect(e.hair === null).toBe(style === null);
    }
  });

  it("wears none unless asked, and each alone", () => {
    const none = model.evaluate(createRecipe());
    expect([none.brows, none.lashes]).toEqual([null, null]);
    const brows = model.evaluate(createRecipe({ hair: { style: null, brows: "eyebrow003" } }));
    expect(brows.brows?.id).toBe("eyebrow003");
    expect(brows.lashes).toBeNull();
  });

  it("follows the figure: a child's brows are smaller and lower than an adult's", () => {
    const at = (age: number) =>
      model.evaluate(createRecipe({ macros: { age }, hair: { style: null, brows: "eyebrow001" } }))
        .brows as { positions: Float32Array };
    const width = (p: Float32Array) => {
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let v = 0; v < p.length / 3; v++) {
        lo = Math.min(lo, p[v * 3] as number);
        hi = Math.max(hi, p[v * 3] as number);
      }
      return hi - lo;
    };
    expect(width(at(6).positions)).toBeLessThan(width(at(45).positions) * 0.9);
  });

  it("refuses an id of the wrong kind or no kind, naming it", () => {
    expect(() => model.evaluate(worn({ brows: "short02" }))).toThrow(RecipeError);
    expect(() => model.evaluate(worn({ brows: "short02" }))).toThrow(/scalp style, not brows/);
    expect(() => model.evaluate(worn({ lashes: "eyebrow001" }))).toThrow(/brows style, not lashes/);
    expect(() => model.evaluate(worn({ style: "eyebrow001" }))).toThrow(/not scalp hair/);
    expect(() => model.evaluate(worn({ brows: "no-such" }))).toThrow(/unknown hair style no-such/);
  });

  it("lists, as pending, every worn style whose geometry has not arrived", () => {
    const parsed = parseHumanoidAssets(bodyPackData(), undefined, undefined, {
      manifest: hairManifest,
    });
    const m = new HumanoidModel(parsed);
    expect(m.pendingHairStyles(worn({ style: "short02" }))).toEqual([
      "short02",
      "eyebrow001",
      "eyelashes01",
    ]);
    expect(m.pendingHairStyles(createRecipe())).toEqual([]);
    expect(() => m.pendingHairStyles(worn({ brows: "short02" }))).toThrow(RecipeError);
    expect(() => m.evaluate(worn())).toThrow(/has not loaded yet/);
  });
});

describe("a brow's or a lash's static data", () => {
  it("is a decal's: fully there, standing no fins, with no growth or scalp", () => {
    for (const id of ["eyebrow001", "eyelashes01"]) {
      const t = model.hairTopology(id);
      expect(t.kind, id).toBe(id.startsWith("eyebrow") ? "brows" : "lashes");
      expect(
        t.fade.every((f) => f === 1),
        `${id} fade`,
      ).toBe(true);
      expect(
        t.fin.every((f) => f === 0),
        `${id} fin`,
      ).toBe(true);
      expect(
        t.growth.every((g) => g === 0),
        `${id} growth`,
      ).toBe(true);
      expect(
        t.scalp.every((s) => s === 0),
        `${id} scalp`,
      ).toBe(true);
      expect(
        t.occlusion.every((o) => o === 1),
        `${id} occlusion`,
      ).toBe(true);
      expect(t.strand).toEqual({ angle: 0, coherence: 0 });
    }
    expect(model.hairTopology("short02").kind).toBe("scalp");
  });
});

describe("a brow's fit on the skin", () => {
  /** Signed distance of each decal vertex from the body surface: along the nearest surface vertex's normal. */
  function heights(age: number, brows: string): number[] {
    const e = model.evaluate(createRecipe({ macros: { age }, hair: { style: null, brows } }));
    const p = e.brows?.positions as Float32Array;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let v = 1; v < p.length; v += 3) {
      lo = Math.min(lo, p[v] as number);
      hi = Math.max(hi, p[v] as number);
    }
    const near: number[] = [];
    for (let s = 0; s < e.positions.length / 3; s++) {
      const y = e.positions[s * 3 + 1] as number;
      if (y > lo - 0.04 && y < hi + 0.04 && (e.positions[s * 3 + 2] as number) > 0) near.push(s);
    }
    const out: number[] = [];
    for (let v = 0; v < p.length / 3; v++) {
      let best = Number.POSITIVE_INFINITY;
      let height = 0;
      for (const s of near) {
        const d = [0, 1, 2].map(
          (k) => (p[v * 3 + k] as number) - (e.positions[s * 3 + k] as number),
        );
        const dd = (d[0] as number) ** 2 + (d[1] as number) ** 2 + (d[2] as number) ** 2;
        if (dd < best) {
          best = dd;
          height = [0, 1, 2].reduce(
            (t, k) => t + (d[k] as number) * (e.normals[s * 3 + k] as number),
            0,
          );
        }
      }
      out.push(height);
    }
    return out;
  }

  it("stays on the skin, not under it, at every age and for every brow", {
    timeout: 300_000,
  }, () => {
    for (const age of [6, 14, 45, 75])
      for (const id of ["eyebrow001", "eyebrow006", "eyebrow009", "eyebrow012"]) {
        const h = heights(age, id).sort((a, b) => a - b);
        // The subdivided body's surface can swallow a decal bound to its coarse mesh; the lift keeps it clear.
        expect(h[0], `${id} at ${age}: lowest vertex, mm`).toBeGreaterThan(0.0001);
        // And no further than a few millimetres off it.
        expect(h[Math.floor(h.length * 0.9)], `${id} at ${age}: 90th percentile, mm`).toBeLessThan(
          0.004,
        );
      }
  });
});
