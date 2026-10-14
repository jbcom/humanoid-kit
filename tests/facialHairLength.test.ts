import { describe, expect, it } from "vitest";
import type { BoundAsset } from "../src/format/assetFormat.ts";
import type { FacialHairGrowthRecipe, FacialHairLengthRecipe } from "../src/index.ts";
import {
  evaluateBinding,
  evaluateBindingWithGrowth,
  resolveOffsetScaleGrowth,
  sourceCardRoots,
} from "../src/mhclo/bound.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { assertValidRecipe, RecipeValidationError } from "../src/recipe/validate.ts";
import { loadHairFixtureAssets } from "./hairFixtures.ts";

const assets = loadHairFixtureAssets();
const model = new HumanoidModel(assets);
const beardIds = [...(assets.hair?.styles.values() ?? [])]
  .filter((style) => style.kind === "facial" && style.tags.includes("beard"))
  .map((style) => style.id);

type GrowthModelProbe = {
  evaluateShape(
    recipe: Recipe,
    signals: Readonly<Record<string, number>>,
  ): { control: Float32Array };
  hairPart(id: string, kind: "facial"): { asset: BoundAsset; control: Float32Array };
  bodyVertices: Uint32Array;
  drapeFacialGrowth(
    asset: BoundAsset,
    control: Float32Array,
    native: Float32Array,
    growth: ReturnType<typeof resolveOffsetScaleGrowth>,
    roots: Uint8Array,
    placed: Float32Array,
  ): void;
};
const growthProbe = model as unknown as GrowthModelProbe;

const lowestY = (positions: Float32Array) => {
  let low = Number.POSITIVE_INFINITY;
  for (let i = 1; i < positions.length; i += 3) low = Math.min(low, positions[i] as number);
  return low;
};

describe("authored facial-beard length", () => {
  const beardLength: FacialHairLengthRecipe = { "beard-viking": 5 };

  it("keeps the source mesh byte-for-byte placed at length one and lengthens only its free offsets", () => {
    const ordinary = createRecipe({ hair: { style: null }, facialHair: ["beard-viking"] });
    const one = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairLength: { "beard-viking": 1 },
    });
    const long = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairLength: { "beard-viking": 5 },
    });
    const ordinaryEvaluation = model.evaluate(ordinary);
    const oneEvaluation = model.evaluate(one);
    const longEvaluation = model.evaluate(long);
    const normalBeard = ordinaryEvaluation.facialHair[0];
    const oneBeard = oneEvaluation.facialHair[0];
    const longBeard = longEvaluation.facialHair[0];
    expect(Array.from(oneBeard?.positions ?? [])).toEqual(Array.from(normalBeard?.positions ?? []));
    expect(longBeard?.positions.length).toBe(normalBeard?.positions.length);
    expect(lowestY(longBeard?.positions ?? new Float32Array())).toBeLessThan(
      lowestY(normalBeard?.positions ?? new Float32Array()) - 0.15,
    );
    expect(Array.from(longEvaluation.positions)).toEqual(Array.from(ordinaryEvaluation.positions));
  });

  it("copies length settings and accepts only finite opt-in multipliers", () => {
    const lengths = { ...beardLength };
    const recipe = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairLength: lengths,
    });
    lengths["beard-viking"] = 2;
    expect(recipe.facialHairLength).toEqual({ "beard-viking": 5 });
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const candidate = { ...recipe, facialHairLength: { "beard-viking": bad } };
      expect(() => assertValidRecipe(candidate), String(bad)).toThrow(RecipeValidationError);
    }
  });

  it("rejects a finite multiplier that overflows Float32 geometry and restores defaults exactly", () => {
    const ordinary = createRecipe({ hair: { style: null }, facialHair: ["beard-viking"] });
    const expected = model.evaluate(ordinary).facialHair[0]?.positions.slice();
    const explosive = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairLength: { "beard-viking": Number.MAX_VALUE },
    });
    expect(() => model.evaluate(explosive)).toThrow(/finite Float32 output/);
    expect(Array.from(model.evaluate(ordinary).facialHair[0]?.positions ?? [])).toEqual(
      Array.from(expected ?? []),
    );
  });

  it("does not lengthen an unselected style or a moustache", () => {
    expect(() =>
      model.evaluate(
        createRecipe({
          hair: { style: null },
          facialHair: ["beard-viking"],
          facialHairLength: { "beard-scruffy": 5 },
        }),
      ),
    ).toThrow(/not selected/);
    expect(() =>
      model.evaluate(
        createRecipe({
          hair: { style: null },
          facialHair: ["moustache-viking"],
          facialHairLength: { "moustache-viking": 5 },
        }),
      ),
    ).toThrow(/not a beard style/);
  });

  it("grows an opted-in source beard through exact native placement to a vertical rest-floor bound", () => {
    const growth: FacialHairGrowthRecipe = { "beard-viking": 1 };
    const ordinary = createRecipe({ hair: { style: null }, facialHair: ["beard-viking"] });
    const hidden = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairGrowth: { "beard-viking": 0 },
    });
    const smaller = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairGrowth: { "beard-viking": 0.25 },
    });
    const native = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairGrowth: { "beard-viking": 0.5 },
    });
    const floor = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairGrowth: growth,
    });
    const expected = model.evaluate(ordinary).facialHair[0]?.positions.slice();
    expect(model.evaluate(hidden).facialHair).toEqual([]);
    const shortened = model.evaluate(smaller).facialHair[0];
    const source = model.evaluate(native).facialHair[0];
    const full = model.evaluate(floor);
    const floorBeard = full.facialHair[0];
    expect(lowestY(shortened?.positions ?? new Float32Array())).toBeGreaterThan(
      lowestY(expected ?? new Float32Array()),
    );
    expect(Array.from(source?.positions ?? [])).toEqual(Array.from(expected ?? []));
    expect(lowestY(floorBeard?.positions ?? new Float32Array())).toBeCloseTo(
      lowestY(full.positions),
      3,
    );
    expect(floorBeard?.positions.length).toBe(source?.positions.length);
    expect(Array.from(floorBeard?.positions ?? []).every(Number.isFinite)).toBe(true);
    expect(Array.from(model.evaluate(ordinary).facialHair[0]?.positions ?? [])).toEqual(
      Array.from(expected ?? []),
    );
  });

  it("keeps every shipped source beard's authored card roots attached through full growth", () => {
    expect(beardIds).toHaveLength(6);
    const recipe = createRecipe({ hair: { style: null } });
    const control = growthProbe.evaluateShape(recipe, {}).control;
    let restFloorY = Number.POSITIVE_INFINITY;
    for (const vertex of growthProbe.bodyVertices)
      restFloorY = Math.min(restFloorY, control[vertex * 3 + 1] as number);
    for (const id of beardIds) {
      const asset = growthProbe.hairPart(id, "facial").asset;
      const native = evaluateBinding(asset, control, new Float32Array(asset.entry.vertexCount * 3));
      const roots = sourceCardRoots(asset, control, native);
      expect(
        roots.reduce((count, root) => count + root, 0),
        id,
      ).toBeGreaterThan(0);
      const nativeEvaluation = model.evaluate(
        createRecipe({ hair: { style: null }, facialHair: [id] }),
      ).facialHair[0];
      const halfEvaluation = model.evaluate(
        createRecipe({
          hair: { style: null },
          facialHair: [id],
          facialHairGrowth: { [id]: 0.5 },
        }),
      ).facialHair[0];
      expect(
        Array.from(halfEvaluation?.positions ?? []),
        `${id} native source restoration`,
      ).toEqual(Array.from(nativeEvaluation?.positions ?? []));
      const growth = resolveOffsetScaleGrowth(asset, control, restFloorY, 1);
      const placed = evaluateBindingWithGrowth(
        asset,
        control,
        growth,
        new Float32Array(asset.entry.vertexCount * 3),
      );
      for (let vertex = 0; vertex < asset.entry.vertexCount; vertex++) {
        if (!roots[vertex]) continue;
        const k = vertex * 3;
        placed[k] = native[k] as number;
        placed[k + 1] = native[k + 1] as number;
        placed[k + 2] = native[k + 2] as number;
      }
      growthProbe.drapeFacialGrowth(asset, control, native, growth, roots, placed);
      for (let vertex = 0; vertex < asset.entry.vertexCount; vertex++) {
        if (!roots[vertex]) continue;
        const k = vertex * 3;
        expect(Array.from(placed.slice(k, k + 3)), `${id} root ${vertex}`).toEqual(
          Array.from(native.slice(k, k + 3)),
        );
      }
    }
  });

  it("validates opt-in growth independently of the existing source-offset multiplier", () => {
    const growth = { "beard-viking": 0.5 };
    const copied = createRecipe({
      hair: { style: null },
      facialHair: ["beard-viking"],
      facialHairGrowth: growth,
    });
    growth["beard-viking"] = 1;
    expect(copied.facialHairGrowth).toEqual({ "beard-viking": 0.5 });
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const candidate = {
        ...createRecipe({ hair: { style: null }, facialHair: ["beard-viking"] }),
        facialHairGrowth: { "beard-viking": bad },
      };
      expect(() => assertValidRecipe(candidate), String(bad)).toThrow(RecipeValidationError);
    }
    expect(() =>
      model.evaluate(
        createRecipe({
          hair: { style: null },
          facialHair: ["beard-viking"],
          facialHairLength: { "beard-viking": 5 },
          facialHairGrowth: { "beard-viking": 0.5 },
        }),
      ),
    ).toThrow(/cannot set both facialHairLength and facialHairGrowth/);
    expect(() =>
      model.evaluate(
        createRecipe({
          hair: { style: null },
          facialHair: ["beard-viking"],
          facialHairGrowth: { "beard-scruffy": 0.5 },
        }),
      ),
    ).toThrow(/not selected/);
    expect(() =>
      model.evaluate(
        createRecipe({
          hair: { style: null },
          facialHair: ["moustache-viking"],
          facialHairGrowth: { "moustache-viking": 0.5 },
        }),
      ),
    ).toThrow(/not a beard style/);
  });
});
