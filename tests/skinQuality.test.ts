import { describe, expect, it } from "vitest";
import { SKIN_INFLUENCES } from "../src/format/assetFormat.ts";
import { HumanoidModel, type ModelOptions } from "../src/model/humanoidModel.ts";
import { projectSkinInfluences, type SkinInfluences } from "../src/model/skinQuality.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadClothedAssets, loadFixtureAssets } from "./fixtures.ts";
import { loadHairFixtureAssets } from "./hairFixtures.ts";

const source = {
  skinIndex: Uint8Array.from([4, 9, 3, 7, 1, 8, 5, 6]),
  skinWeight: Float32Array.from([0.03, 0.31, 0.02, 0.21, 0.09, 0.19, 0.15, 0]),
};

const maxPositiveInfluences = (skin: { skinWeight: Float32Array }) => {
  let max = 0;
  for (let v = 0; v < skin.skinWeight.length / SKIN_INFLUENCES; v++) {
    let positive = 0;
    for (let k = 0; k < SKIN_INFLUENCES; k++)
      if ((skin.skinWeight[v * SKIN_INFLUENCES + k] as number) > 0) positive++;
    max = Math.max(max, positive);
  }
  return max;
};

describe("runtime skin influence quality", () => {
  it("keeps the full MakeHuman source views byte-identical by default", () => {
    const result = projectSkinInfluences(source);
    expect(result.skinIndex).toBe(source.skinIndex);
    expect(result.skinWeight).toBe(source.skinWeight);
  });

  it.each([
    [4, [9, 7, 8, 5]],
    [5, [9, 7, 8, 5, 1]],
    [6, [9, 7, 8, 5, 1, 4]],
    [7, [9, 7, 8, 5, 1, 4, 3]],
  ] as const)("retains and normalises exactly %i influences", (quality, expected) => {
    const result = projectSkinInfluences(source, quality satisfies SkinInfluences);
    const nonzero = [...result.skinWeight].filter((weight) => weight > 0);
    expect(nonzero).toHaveLength(quality);
    expect([...result.skinIndex.slice(0, quality)]).toEqual(expected);
    expect(result.skinWeight.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    expect(result.skinWeight.slice(quality)).toEqual(new Float32Array(8 - quality));
  });

  it("refuses values outside the supported runtime ladder", () => {
    expect(() => projectSkinInfluences(source, 3 as SkinInfluences)).toThrow(/4 to 8/);
    expect(() => projectSkinInfluences(source, 8.5 as SkinInfluences)).toThrow(/integer/);
  });

  it("threads the typed model option through topology and CPU rig skinning", () => {
    const assets = loadFixtureAssets();
    const fullOptions: ModelOptions = { subdivision: 0, skinInfluences: 8 };
    const reducedOptions: ModelOptions = { subdivision: 0, skinInfluences: 4 };
    const full = new HumanoidModel(assets, fullOptions);
    const reduced = new HumanoidModel(assets, reducedOptions);
    const fullSkin = full.rigSkin();
    const reducedSkin = reduced.rigSkin();
    expect(fullSkin.skinIndex).toBe(assets.skinIndex);
    expect(fullSkin.skinWeight).toBe(assets.skinWeight);
    expect(reducedSkin.skinWeight).not.toBe(assets.skinWeight);

    for (let vertex = 0; vertex < assets.manifest.vertexCount; vertex++) {
      let retained = 0;
      let total = 0;
      let sourceTotal = 0;
      for (let place = 0; place < SKIN_INFLUENCES; place++) {
        const weight = reducedSkin.skinWeight[vertex * SKIN_INFLUENCES + place] as number;
        if (weight > 0) retained++;
        total += weight;
        sourceTotal += assets.skinWeight[vertex * SKIN_INFLUENCES + place] as number;
      }
      expect(retained).toBeLessThanOrEqual(4);
      expect(total).toBeCloseTo(sourceTotal > 0 ? 1 : 0, 6);
    }

    const topology = reduced.topology().body;
    expect(topology.skinWeight.length).toBe(topology.vertexCount * SKIN_INFLUENCES);
    for (let vertex = 0; vertex < topology.vertexCount; vertex++) {
      let retained = 0;
      for (let place = 0; place < SKIN_INFLUENCES; place++)
        if ((topology.skinWeight[vertex * SKIN_INFLUENCES + place] as number) > 0) retained++;
      expect(retained).toBeLessThanOrEqual(4);
    }
  });

  it("reprojects every subdivided and bound runtime surface after row mixing", () => {
    // A source-only projection passed this test before the final derived-skin
    // projection: Catmull-Clark and bindings reintroduced fifth through eighth
    // positive weights on their render rows.
    const quality = 4;
    const body = new HumanoidModel(loadFixtureAssets(), {
      subdivision: 1,
      skinInfluences: quality,
    });
    expect(maxPositiveInfluences(body.topology().body)).toBeLessThanOrEqual(quality);
    for (const attachment of body.topology().attachments)
      expect(maxPositiveInfluences(attachment)).toBeLessThanOrEqual(quality);

    const hair = new HumanoidModel(loadHairFixtureAssets(), {
      subdivision: 1,
      skinInfluences: quality,
    });
    expect(maxPositiveInfluences(hair.hairTopology("short02"))).toBeLessThanOrEqual(quality);

    const clothed = new HumanoidModel(loadClothedAssets(), {
      subdivision: 1,
      skinInfluences: quality,
    });
    expect(maxPositiveInfluences(clothed.garmentTopology("shoes/shoes03"))).toBeLessThanOrEqual(
      quality,
    );

    const adult = new HumanoidModel(loadFixtureAssets(true), {
      subdivision: 1,
      skinInfluences: quality,
    });
    const topology = adult.adultSurface();
    if (!topology) throw new Error("adult fixture has no surface");
    expect(maxPositiveInfluences(topology)).toBeLessThanOrEqual(quality);
    const evaluated = adult.evaluate(
      createRecipe({
        macros: { age: 30, gender: 1 },
        modifiers: { "genitals/anal-canal": 0 },
      }),
    );
    if (!evaluated.skin) throw new Error("adult fixture did not evaluate reservoir skin");
    expect(maxPositiveInfluences(evaluated.skin)).toBeLessThanOrEqual(quality);
  }, 180_000);
});
