import { describe, expect, it } from "vitest";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultPackData, bodyPackData, clothingPackData } from "./fixtures.ts";

const SUIT = "suits/male_casualsuit01";

/**
 * The adult surface refines the pelvis, so a control face there owns more
 * triangles than 2 × 4^level; what a garment hides must come off it too, face
 * by face, or a suit's trousers would leave the refined skin showing through
 * (or take neighbours with them).
 */
describe("an adult wearing garments", { timeout: 300_000 }, () => {
  const assets = parseHumanoidAssets(bodyPackData(), adultPackData(), clothingPackData());
  const model = new HumanoidModel(assets, { subdivision: 1 });
  const spec = assets.adultAnatomyManifest?.anatomy?.surface;
  const bare = createRecipe({ macros: { age: 30 } });
  const dressed = createRecipe({ macros: { age: 30 }, outfit: [SUIT] });
  const centroids = (ev: ReturnType<HumanoidModel["evaluate"]>, index: Uint32Array) => {
    const out: number[][] = [];
    for (let t = 0; t < index.length; t += 3) {
      const c = [0, 0, 0];
      for (let k = 0; k < 3; k++)
        for (let a = 0; a < 3; a++)
          c[a] = (c[a] as number) + (ev.positions[(index[t + k] as number) * 3 + a] as number) / 3;
      out.push(c);
    }
    return out;
  };

  it("hides the suit's faces from the refined surface and keeps their neighbours", () => {
    expect(spec?.faces.length).toBeGreaterThan(0);
    const unclothed = model.evaluate(bare);
    const ev = model.evaluate(dressed);
    expect(ev.surface).toBe("adult");
    expect(ev.outfit.key).toBe(`adult:${SUIT}`);
    const masked = ev.outfit.masks?.bodyIndex as Uint32Array;
    const adultSurface = model.adultSurface();
    if (!adultSurface) throw new Error("the adult pack has no refined surface");
    const whole = adultSurface.index.length;
    // The suit's trousers cover refined faces, and the surface still draws the rest.
    expect(masked.length).toBeGreaterThan(0);
    expect(masked.length).toBeLessThan(whole);
    expect(unclothed.outfit.masks?.bodyIndex.length).toBe(whole);

    // Independent of the triangle bookkeeping: a refined control face the suit
    // hides has nothing drawn at its middle, and has something drawn there bare.
    const deleted = new Set(assets.garments.get(SUIT)?.deleteVerts);
    const hidden = (spec?.faces ?? []).filter((f) =>
      [0, 1, 2, 3].every((k) => deleted.has(assets.faceVerts[f * 4 + k] as number)),
    );
    expect(hidden.length).toBeGreaterThan(0);
    const dressedAt = centroids(ev, masked);
    const bareAt = centroids(unclothed, unclothed.outfit.masks?.bodyIndex as Uint32Array);
    /** Distance from a control face's middle to the nearest triangle centre drawn. */
    const gap = (pts: number[][], f: number) => {
      const mid = [0, 1, 2].map(
        (a) =>
          [0, 1, 2, 3].reduce(
            (sum, k) =>
              sum + (ev.control[(assets.faceVerts[f * 4 + k] as number) * 3 + a] as number),
            0,
          ) / 4,
      );
      let best = Number.POSITIVE_INFINITY;
      for (const p of pts)
        best = Math.min(
          best,
          Math.hypot(
            (p[0] as number) - (mid[0] as number),
            (p[1] as number) - (mid[1] as number),
            (p[2] as number) - (mid[2] as number),
          ),
        );
      return best;
    };
    for (const f of hidden.filter((_, i) => i % 6 === 0)) {
      // A face is 1.5–2.5 cm across and its refined triangles a few millimetres:
      // bare, one is drawn within a cell of its middle; under the suit the whole
      // pelvis is covered and the nearest skin is trouser-leg distances away.
      expect(gap(bareAt, f), `face ${f} drawn bare`).toBeLessThan(0.008);
      expect(gap(dressedAt, f), `face ${f} drawn under the suit`).toBeGreaterThan(0.05);
    }
  });

  it("serves the mask only to a caller that does not hold it, per surface", () => {
    const first = model.evaluate(dressed);
    const again = model.evaluate(dressed, {}, first.outfit.key);
    expect(again.outfit.masks).toBeNull();
    // The same garments on the base surface are a different mask: the key differs.
    const minor = model.evaluate(createRecipe({ macros: { age: 15 }, outfit: [SUIT] }));
    expect(minor.surface).toBe("base");
    expect(minor.outfit.key).toBe(SUIT);
  });
});
