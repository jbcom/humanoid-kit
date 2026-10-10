/**
 * The hair pack's baked occlusion against what the code bakes now. Casting every
 * ray of every style is slow under coverage instrumentation, so it runs in the
 * uninstrumented `bake` project (vitest.config.ts).
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { cutoutOf, HAIR_STYLES } from "../../scripts/lib/packHair.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { hairDir, hairManifest, loadHairFixtureAssets } from "../hairFixtures.ts";

describe("the shipped hair occlusion", { timeout: 300_000 }, () => {
  it("is what the code bakes, to a byte: a crop, a long style and one bound to helper-hair", () => {
    const assets = loadHairFixtureAssets();
    const model = new HumanoidModel(assets, { subdivision: 0 });
    // The packer bakes every style with the same code; a sample keeps the bake quick.
    for (const s of hairManifest.styles.filter((x) =>
      ["short04", "long01", "braid01"].includes(x.id),
    )) {
      const asset = assets.hair?.bound.get(s.id);
      if (!asset) throw new Error(`${s.id} not loaded`);
      const fresh = model.bakeHairOcclusion(asset);
      expect(fresh.length, s.id).toBe(s.vertexCount);
      let worst = 0;
      fresh.forEach((v, k) => {
        worst = Math.max(worst, Math.abs(v - (asset.occlusion[k] as number) / 255));
      });
      // One byte per value: at most half a step of rounding.
      expect(worst, s.id).toBeLessThanOrEqual(0.5 / 255 + 1e-6);
    }
  });

  it("carries the growth, fade, fin and scalp the code measures now, to a byte", async () => {
    const assets = loadHairFixtureAssets();
    const model = new HumanoidModel(assets, { subdivision: 0 });
    for (const s of hairManifest.styles.filter((x) =>
      ["short04", "afro01", "braid01"].includes(x.id),
    )) {
      const asset = assets.hair?.bound.get(s.id);
      if (!asset?.hair) throw new Error(`${s.id} not loaded`);
      const feather = HAIR_STYLES.find((x) => x.id === s.id)?.feather;
      const cutout = await cutoutOf(path.join(hairDir, s.material.texture as string));
      const fresh = model.bakeHairFields(asset, {
        ...(feather !== undefined && { feather }),
        cutout,
      });
      expect(fresh.growth, `${s.id} growth`).toEqual(asset.hair.growth);
      expect(fresh.uvScale, `${s.id} uvScale`).toEqual(asset.hair.uvScale);
      expect(fresh.fade, `${s.id} fade`).toEqual(asset.hair.fade);
      expect(fresh.fin, `${s.id} fin`).toEqual(asset.hair.fin);
      expect(fresh.scalpVerts, `${s.id} scalp vertices`).toEqual(asset.hair.scalpVerts);
      expect(fresh.scalpWeights, `${s.id} scalp weights`).toEqual(asset.hair.scalpWeights);
    }
  });

  it("does not depend on the model's subdivision level", () => {
    const assets = loadHairFixtureAssets();
    const asset = assets.hair?.bound.get("short04");
    if (!asset) throw new Error("short04 not loaded");
    const level0 = new HumanoidModel(assets, { subdivision: 0 }).bakeHairOcclusion(asset);
    const level1 = new HumanoidModel(assets, { subdivision: 1 }).bakeHairOcclusion(asset);
    expect(level1).toEqual(level0);
  });
});
