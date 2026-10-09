import { describe, expect, it } from "vitest";
import {
  AssetFormatError,
  addHairStyle,
  type HairManifest,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyPackData } from "./fixtures.ts";
import { hairManifest, hairStyleBin, loadHairFixtureAssets } from "./hairFixtures.ts";

const assets = loadHairFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const cards = hairManifest.styles.filter((s) => s.kind === "beard");
const man = (beard: "none" | "stubble" | "full", age = 35, gender = 1) =>
  createRecipe({ macros: { age, gender }, bodyHair: { beard } });

describe("the hair pack's beard cards", () => {
  it("ship a full beard's cards, with a rank per vertex and no hairline or scalp", () => {
    expect(cards.map((c) => [c.id, c.tags])).toEqual([["beard-full", ["full"]]]);
    const asset = assets.hair?.bound.get("beard-full");
    const n = asset?.entry.vertexCount as number;
    expect(asset?.hair?.rank?.length).toBe(n);
    expect(asset?.hair?.fade.every((f) => f === 255)).toBe(true);
    expect(asset?.hair?.scalpVerts.length).toBe(0);
    // Ranks spread over the whole range, one per card of eight vertices.
    const ranks = new Set(asset?.hair?.rank);
    expect(ranks.size).toBeGreaterThan(100);
  });

  it("refuse ranks on scalp hair, and cards without them", () => {
    const scalp = hairManifest.styles.find((s) => s.kind === "scalp");
    const beard = cards[0];
    if (!scalp || !beard?.layout.rank) throw new Error("fixture styles missing");
    const tampered: HairManifest = {
      ...hairManifest,
      styles: [
        { ...scalp, layout: { ...scalp.layout, rank: beard.layout.rank } },
        { ...beard, layout: { ...beard.layout, rank: undefined } as never },
      ],
    };
    const fresh = parseHumanoidAssets(bodyPackData(), undefined, undefined, {
      manifest: tampered,
    });
    expect(() => addHairStyle(fresh, scalp.id, hairStyleBin(scalp.id))).toThrow(AssetFormatError);
    expect(() => addHairStyle(fresh, beard.id, hairStyleBin(beard.id))).toThrow(AssetFormatError);
  });
});

describe("the beard cards a recipe wears", () => {
  it("are the pack's cards for its style, where the face grows terminal hair", () => {
    expect(model.wornBeardCards(man("full"))).toBe("beard-full");
    // Stubble and shaven faces are the coat's alone.
    expect(model.wornBeardCards(man("stubble"))).toBeNull();
    expect(model.wornBeardCards(man("none"))).toBeNull();
    expect(model.wornBeardCards(createRecipe({ macros: { age: 35, gender: 1 } }))).toBeNull();
    // A child grows no terminal hair, so nothing is loaded for one.
    expect(model.wornBeardCards(man("full", 8))).toBeNull();
    // Nor does a face shaved to none by its density.
    expect(
      model.wornBeardCards(
        createRecipe({
          macros: { age: 35, gender: 1 },
          bodyHair: { beard: "full", density: { face: 0 } },
        }),
      ),
    ).toBeNull();
  });

  it("evaluate bound to the face, and leave every other part of the evaluation alone", () => {
    const shaven = model.evaluate(man("none"));
    const bearded = model.evaluate(man("full"));
    expect(shaven.beard).toBeNull();
    expect(bearded.beard?.id).toBe("beard-full");
    const topology = model.hairTopology("beard-full");
    expect(bearded.beard?.positions.length).toBe(topology.vertexCount * 3);
    expect(bearded.positions).toEqual(shaven.positions);
    expect(bearded.hair).toBeNull();
    // On the face: from the throat to below the eyes, measured down from the top of
    // the evaluated head (the eyes are some 12 cm below it, the throat some 30).
    const ys = (bearded.beard?.positions ?? new Float32Array()).filter((_, i) => i % 3 === 1);
    const top = Math.max(...bearded.positions.filter((_, i) => i % 3 === 1));
    expect(Math.max(...ys)).toBeLessThan(top - 0.1);
    expect(Math.min(...ys)).toBeGreaterThan(top - 0.4);
  });

  it("carry their ranks to the render vertices, and scalp styles none", () => {
    const rank = model.hairTopology("beard-full").rank;
    expect(rank).not.toBeNull();
    for (const r of rank ?? []) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
    const scalp = hairManifest.styles.find((s) => s.kind === "scalp")?.id as string;
    expect(model.hairTopology(scalp).rank).toBeNull();
  });
});
