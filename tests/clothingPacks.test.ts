import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wardrobeOf } from "../src/editor/wardrobe.ts";
import {
  AssetFormatError,
  addGarments,
  type ClothingManifest,
  garmentsFile,
  loadHumanoidAssetsStaged,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { stubFetch } from "./fetchStub.ts";
import {
  bodyPackData,
  clothingDir,
  clothingManifest,
  clothingPackData,
  consumerClothingManifest,
} from "./fixtures.ts";

const period = consumerClothingManifest("period");
const shipped = clothingManifest.garments.entries.length;

describe("more than one clothing pack", () => {
  it("parses every pack beside the body and wears garments from any of them in one outfit", () => {
    const { garments } = clothingPackData();
    const assets = parseHumanoidAssets(bodyPackData(), undefined, [
      clothingPackData(),
      { manifest: period, garments: garments as ArrayBuffer },
    ]);
    expect(assets.clothingManifests).toEqual([clothingManifest, period]);
    expect(assets.pendingGarmentPacks.size).toBe(0);
    expect(assets.garments.size).toBe(2 * shipped);
    const model = new HumanoidModel(assets);
    const outfit = model.outfit(["shoes/shoes01", "period/suits/male_worksuit01"]);
    // The system shoes declare z_depth 5 against the suit's 50: innermost, under the hem.
    expect(outfit.order).toEqual(["shoes/shoes01", "period/suits/male_worksuit01"]);
  });

  it("names the garment and both packs when two packs share a garment id", () => {
    const twin = { ...consumerClothingManifest("period"), garments: clothingManifest.garments };
    expect(() =>
      parseHumanoidAssets(bodyPackData(), undefined, [
        { manifest: clothingManifest },
        { manifest: twin as ClothingManifest },
      ]),
    ).toThrow(`garment ${clothingManifest.garments.entries[0]?.id} is in clothing packs 0 and 1`);
  });

  it("checks every pack against the body pack", () => {
    const stray = { ...period, bodySha256: "0".repeat(64) };
    expect(() =>
      parseHumanoidAssets(bodyPackData(), undefined, [
        { manifest: clothingManifest },
        { manifest: stray },
      ]),
    ).toThrow(/clothing pack 1 was built for a different body pack/);
  });

  it("keeps each pack's garments pending until that pack's binary is added", () => {
    const { garments } = clothingPackData();
    const assets = parseHumanoidAssets(bodyPackData(), undefined, [
      { manifest: clothingManifest },
      { manifest: period },
    ]);
    expect([...assets.pendingGarmentPacks]).toEqual([0, 1]);
    addGarments(assets, 1, garments as ArrayBuffer);
    expect([...assets.pendingGarmentPacks]).toEqual([0]);
    expect(assets.garments.has("period/shoes/shoes01")).toBe(true);
    expect(assets.garments.has("shoes/shoes01")).toBe(false);
    expect(() => addGarments(assets, 1, garments as ArrayBuffer)).toThrow(/already loaded/);
    expect(() => addGarments(assets, 2, garments as ArrayBuffer)).toThrow(/no clothing pack 2/);
    addGarments(assets, 0, garments as ArrayBuffer);
    expect(assets.pendingGarmentPacks.size).toBe(0);
    expect(assets.garments.size).toBe(2 * shipped);
  });

  it("lists every pack's garments in the wardrobe, pack by pack", () => {
    const list = wardrobeOf([clothingManifest, period]);
    expect(list).toHaveLength(2 * shipped);
    expect(list[shipped]?.id).toBe(`period/${clothingManifest.garments.entries[0]?.id}`);
    expect(wardrobeOf([])).toEqual([]);
  });

  it("names each pack's garments file apart, the first as it always was", () => {
    expect(garmentsFile(0)).toBe("garments");
    expect(garmentsFile(1)).toBe("garments.1");
  });
});

describe("loading more than one clothing pack", { timeout: 60_000 }, () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("brings every pack's garments in one stage after the modifiers, textures resolved per pack", async () => {
    stubFetch({ packs: { period: { manifest: period, dir: clothingDir } } });
    const staged = await loadHumanoidAssetsStaged({
      body: "http://packs/body",
      clothing: ["http://packs/clothing", "http://packs/period"],
    });
    expect(staged.stages.map((s) => s.files).slice(0, 2)).toEqual([
      ["modifiers"],
      ["garments", "garments.1"],
    ]);
    await staged.complete;
    expect(staged.assets.pendingGarmentPacks.size).toBe(0);
    expect(staged.assets.garments.size).toBe(2 * shipped);
    expect(staged.assets.fileUrls.get("hats_fedora01_fedora_diffuse.webp")).toBe(
      "http://packs/clothing/hats_fedora01_fedora_diffuse.webp",
    );
    expect(staged.assets.fileUrls.get("period_hats_fedora01_fedora_diffuse.webp")).toBe(
      "http://packs/period/period_hats_fedora01_fedora_diffuse.webp",
    );
  });

  it("keeps the garments of a pack that loaded when another pack's garments fail", async () => {
    const elsewhere = { ...period, garments: { ...period.garments, file: "period.bin.gz" } };
    stubFetch({ packs: { period: { manifest: elsewhere, dir: clothingDir } } });
    const staged = await loadHumanoidAssetsStaged({
      body: "http://packs/body",
      clothing: ["http://packs/clothing", "http://packs/period"],
    });
    const stage = staged.stages.find((s) => s.files.includes(garmentsFile(0)));
    await expect(stage?.loaded).rejects.toThrow(/period\.bin\.gz failed/);
    expect([...staged.assets.pendingGarmentPacks]).toEqual([1]);
    expect(staged.assets.garments.size).toBe(shipped);
    const model = new HumanoidModel(staged.assets);
    expect(model.outfit(["shoes/shoes01"]).order).toEqual(["shoes/shoes01"]);
    expect(() => model.outfit(["period/shoes/shoes01"])).toThrow(/not loaded yet/);
  });

  it("refuses two packs that name one texture file at different URLs", async () => {
    const sameTextures = {
      ...period,
      garments: {
        ...period.garments,
        entries: period.garments.entries.map((g, i) => ({
          ...g,
          material: clothingManifest.garments.entries[i]?.material ?? g.material,
        })),
      },
    };
    stubFetch({ packs: { period: { manifest: sameTextures, dir: clothingDir } } });
    await expect(
      loadHumanoidAssetsStaged({
        body: "http://packs/body",
        clothing: ["http://packs/clothing", "http://packs/period"],
      }),
    ).rejects.toThrow(AssetFormatError);
  });
});
