import { describe, expect, it } from "vitest";
import {
  BODY_REGIONS,
  buildBoneField,
  buildRegionField,
  regionOfBone,
} from "../src/makehuman/regions.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const n = assets.manifest.vertexCount;

describe("buildBoneField", () => {
  const names = ["arms", "rest"] as const;
  const zoneOfBone = (bone: string) => (/^(shoulder|upperarm|lowerarm)/.test(bone) ? 0 : 1);

  it("is a partition of unity over any partition of the bones", () => {
    const field = buildBoneField(assets, names, zoneOfBone, 1);
    expect(field.names).toEqual(names);
    for (let v = 0; v < n; v++) {
      const sum =
        ((field.masks[0] as Float32Array)[v] as number) +
        ((field.masks[1] as Float32Array)[v] as number);
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it("follows the skin weights exactly when it does not smooth", () => {
    const field = buildBoneField(assets, names, zoneOfBone, 1, 0);
    const bones = assets.manifest.skeleton.bones;
    for (const v of [0, 1000, 5000, 9000, 12000]) {
      let arm = 0;
      for (let k = 0; k < 4; k++)
        if (zoneOfBone(bones[assets.skinIndex[v * 4 + k] as number]?.name ?? "") === 0)
          arm += assets.skinWeight[v * 4 + k] as number;
      const total = [0, 1, 2, 3].reduce((s, k) => s + (assets.skinWeight[v * 4 + k] as number), 0);
      expect((field.masks[0] as Float32Array)[v]).toBeCloseTo(total > 0 ? arm / total : 0, 5);
    }
  });

  it("puts a vertex with no skin weight in the fallback zone", () => {
    // The pack's own vertices all carry weight, so strip it from a block of them.
    const weights = Float32Array.from(assets.skinWeight);
    const bare = Array.from({ length: 50 }, (_, i) => 100 + i);
    for (const v of bare) weights.fill(0, v * 4, v * 4 + 4);
    const field = buildBoneField({ ...assets, skinWeight: weights }, names, () => 0, 1, 0);
    for (const v of bare) {
      expect((field.masks[1] as Float32Array)[v]).toBe(1);
      expect((field.masks[0] as Float32Array)[v]).toBe(0);
    }
    // And a vertex that has weight is not touched by the fallback.
    expect((field.masks[0] as Float32Array)[1000]).toBe(1);
  });

  it("is what buildRegionField builds for the shape traits' regions", () => {
    const direct = buildRegionField(assets);
    const viaBones = buildBoneField(
      assets,
      BODY_REGIONS,
      (bone) => BODY_REGIONS.indexOf(regionOfBone(bone)),
      BODY_REGIONS.indexOf("chest"),
    );
    expect(direct.names).toEqual(BODY_REGIONS);
    direct.masks.forEach((m, r) => {
      expect(Array.from(m)).toEqual(Array.from(viaBones.masks[r] as Float32Array));
    });
  });
});
