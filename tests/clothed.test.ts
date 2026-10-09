import { describe, expect, it } from "vitest";
import { groupFaces, parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { OutfitError } from "../src/model/outfit.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { recipeProblems } from "../src/recipe/validate.ts";
import { bodyPackData, loadClothedAssets } from "./fixtures.ts";

const SUIT = "suits/male_casualsuit01";
const SHOES = "shoes/shoes01";
const COAT = "suits/male_elegantsuit01";
const HAT = "hats/fedora01";

describe("a figure wearing garments", { timeout: 120_000 }, () => {
  const assets = loadClothedAssets();
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const bodyFaces = groupFaces(assets, "body");
  const quad = (faceVerts: Uint32Array, f: number) => [0, 1, 2, 3].map((k) => faceVerts[f * 4 + k]);

  /** Body quads a garment hides when worn alone: those with every corner deleted. */
  const hiddenBodyQuads = (id: string) => {
    const deleted = new Set(assets.garments.get(id)?.deleteVerts);
    return [...bodyFaces].filter((f) =>
      quad(assets.faceVerts, f).every((v) => deleted.has(v as number)),
    ).length;
  };

  describe("the body", () => {
    it("keeps every face a garment only partly covers, and hides the ones it covers whole", () => {
      const full = model.outfit([]).masks.bodyIndex.length / 6;
      expect(full).toBe(bodyFaces.length);
      const suit = model.outfit([SUIT]).masks.bodyIndex.length / 6;
      expect(hiddenBodyQuads(SUIT)).toBeGreaterThan(1000);
      expect(suit).toBe(bodyFaces.length - hiddenBodyQuads(SUIT));
      // Any-corner hiding (the first version) would take strictly more.
      const deleted = new Set(assets.garments.get(SUIT)?.deleteVerts);
      const anyCorner = [...bodyFaces].filter((f) =>
        quad(assets.faceVerts, f).some((v) => deleted.has(v as number)),
      ).length;
      expect(anyCorner).toBeGreaterThan(hiddenBodyQuads(SUIT));
    });

    it("loses the union of what every garment hides", () => {
      const ids = [SUIT, SHOES];
      const deleted = new Set(
        ids.flatMap((id) => [...(assets.garments.get(id)?.deleteVerts ?? [])]),
      );
      const expected = [...bodyFaces].filter(
        (f) => !quad(assets.faceVerts, f).every((v) => deleted.has(v as number)),
      ).length;
      expect(model.outfit(ids).masks.bodyIndex.length / 6).toBe(expected);
    });

    it("is not rebuilt when the outfit changes", () => {
      const before = model.topology().body;
      model.outfit([SUIT, SHOES]);
      model.evaluate(createRecipe({ outfit: [SUIT] }));
      const after = model.topology().body;
      expect(after.vertexCount).toBe(before.vertexCount);
      expect(after.index).toBe(before.index);
      expect(after.layerFields).toBe(before.layerFields);
    });

    it("leaves the attachments' occlusion alone, so the shipped bake still applies", () => {
      expect(model.occlusionBakeRecipe()).toBeNull();
    });
  });

  describe("the outfit", () => {
    it("orders garments innermost first and keys the set, whatever order they are named in", () => {
      const a = model.outfit([SHOES, SUIT]);
      const b = model.outfit([SUIT, SHOES]);
      // The shoes declare z_depth 5 and the suits 50: the trousers hang over the shoes.
      expect(a.order).toEqual([SHOES, SUIT]);
      expect(a.key).toBe(b.key);
      expect(a.key).not.toBe(model.outfit([SUIT]).key);
      expect(model.outfit([]).key).toBe("");
      // Equal depth stacks by category: a jacket over clothes, a hat outside both.
      expect(model.outfit([COAT, SHOES, SUIT, HAT]).order).toEqual([SHOES, SUIT, COAT, HAT]);
    });

    it("masks a garment by the garments over it and by no other", () => {
      const shoesAlone = model.outfit([SHOES]).masks.garmentIndex[0] as Uint32Array;
      const both = model.outfit([SUIT, SHOES]).masks;
      const [shoes, suit] = both.garmentIndex as [Uint32Array, Uint32Array];
      // The trousers' deletions cover the ankle the shoes' sock rises into.
      expect(shoes.length).toBeLessThan(shoesAlone.length);
      // Nothing is over the suit, and the shoes do not mask it.
      expect(suit.length).toBe(model.outfit([SUIT]).masks.garmentIndex[0]?.length);
      // Wearing a jacket over the suit masks the suit and leaves the jacket whole.
      const suitAlone = model.outfit([SUIT]).masks.garmentIndex[0] as Uint32Array;
      const coated = model.outfit([SUIT, COAT]).masks.garmentIndex as [Uint32Array, Uint32Array];
      expect(coated[0].length).toBeLessThan(suitAlone.length);
      expect(coated[1].length).toBe(model.outfit([COAT]).masks.garmentIndex[0]?.length);
    });

    it("hides no skin for a hat, and masks nothing under it", () => {
      const hat = model.outfit([HAT]);
      expect(hat.masks.bodyIndex.length / 6).toBe(bodyFaces.length);
      const withSuit = model.outfit([SUIT, HAT]);
      expect(withSuit.masks.garmentIndex[1]?.length).toBe(hat.masks.garmentIndex[0]?.length);
    });

    it("refuses a garment it does not have, one named twice, and any without a clothing pack", () => {
      expect(() => model.outfit(["suits/nope"])).toThrow(OutfitError);
      expect(() => model.outfit([SUIT, SUIT])).toThrow(/twice/);
      const bare = new HumanoidModel(parseHumanoidAssets(bodyPackData()), { subdivision: 0 });
      expect(() => bare.outfit([SUIT])).toThrow(/clothing pack/);
    });

    it("refuses garments whose binary has not arrived", () => {
      const pending = parseHumanoidAssets(bodyPackData(), undefined, {
        manifest: assets.clothingManifest as NonNullable<typeof assets.clothingManifest>,
      });
      const m = new HumanoidModel(pending, { subdivision: 0 });
      expect(() => m.outfit([SUIT])).toThrow(/not loaded yet/);
    });
  });

  describe("a garment's topology", () => {
    it("carries what the renderer needs, once per garment", () => {
      const t = model.garmentTopology(SUIT);
      const g = assets.garments.get(SUIT)?.entry;
      expect(t.id).toBe(SUIT);
      expect(t.kind).toBe("clothes");
      expect(t.vertexCount).toBeGreaterThanOrEqual(g?.vertexCount ?? Infinity);
      expect(t.skinIndex.length).toBe(t.vertexCount * 4);
      expect(t.uvs.length).toBe(t.vertexCount * 2);
      expect(model.garmentTopology(SUIT)).toBe(t);
    });
  });

  describe("evaluating a recipe with an outfit", () => {
    const recipe = createRecipe({ outfit: [SHOES, SUIT] });

    it("evaluates each garment on the morphed body, in outfit order", () => {
      const ev = model.evaluate(recipe);
      expect(ev.outfit.order).toEqual([SHOES, SUIT]);
      expect(ev.garments).toHaveLength(2);
      for (const [i, id] of ev.outfit.order.entries()) {
        const n = model.garmentTopology(id).vertexCount;
        expect(ev.garments[i]?.positions.length, id).toBe(n * 3);
        expect(ev.garments[i]?.normals.length, id).toBe(n * 3);
      }
    });

    it("sends the masks only to a caller that does not have them", () => {
      const first = model.evaluate(recipe);
      expect(first.outfit.masks?.bodyIndex.length).toBeGreaterThan(0);
      const again = model.evaluate(recipe, {}, first.outfit.key);
      expect(again.outfit.masks).toBeNull();
      const other = model.evaluate(recipe, {}, "something else");
      expect(other.outfit.masks).not.toBeNull();
      expect(model.evaluate(createRecipe()).outfit).toMatchObject({ key: "", order: [] });
    });

    it("makes a garment follow the figure's height", () => {
      const span = (height: number) => {
        const ev = model.evaluate(createRecipe({ macros: { height }, outfit: [SUIT] }));
        const p = ev.garments[0]?.positions as Float32Array;
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 1; i < p.length; i += 3) {
          lo = Math.min(lo, p[i] as number);
          hi = Math.max(hi, p[i] as number);
        }
        return hi - lo;
      };
      expect(span(1)).toBeGreaterThan(span(0) * 1.05);
    });

    it("stands the figure on its shoes, not on the feet inside them", () => {
      const lowest = (outfit: string[]) => {
        const ev = model.evaluate(createRecipe({ outfit }));
        let low = Infinity;
        for (const g of ev.garments)
          for (let i = 1; i < g.positions.length; i += 3)
            low = Math.min(low, g.positions[i] as number);
        return { ev, low };
      };
      const barefoot = model.evaluate(createRecipe()).groundOffset;
      // shoes03's soles reach 2.2 cm below the foot inside them.
      const { ev, low } = lowest(["shoes/shoes03"]);
      expect(ev.groundOffset - barefoot).toBeGreaterThan(0.02);
      // The lowest sole rests on the ground exactly.
      expect(low + ev.groundOffset).toBeCloseTo(0, 5);
    });
  });
});

describe("a recipe's outfit", () => {
  it("is optional, defaults to nothing and round-trips as JSON", () => {
    const r = createRecipe({ outfit: ["shoes/shoes01"] });
    expect(r.outfit).toEqual(["shoes/shoes01"]);
    expect(createRecipe().outfit).toBeUndefined();
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(recipeProblems(createRecipe())).toEqual([]);
    expect(recipeProblems(r)).toEqual([]);
  });

  it("is checked: an array of distinct ids", () => {
    const base = createRecipe();
    expect(recipeProblems({ ...base, outfit: "shoes" })).toEqual([
      "outfit must be an array of garment ids",
    ]);
    expect(recipeProblems({ ...base, outfit: [3] })).toContain("outfit[0] must be a garment id");
    expect(recipeProblems({ ...base, outfit: ["a", "a"] })).toContain("outfit names a twice");
  });
});
