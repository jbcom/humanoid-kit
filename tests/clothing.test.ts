import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileAsset } from "../scripts/lib/compileAsset.ts";
import {
  AssetFormatError,
  addGarments,
  type ClothingManifest,
  loadHumanoidAssetsStaged,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { GARMENT_LAYERS } from "../src/model/outfit.ts";
import { stubFetch } from "./fetchStub.ts";
import {
  bodyManifest,
  bodyPackData,
  clothingDir,
  clothingManifest,
  clothingPackData,
  loadClothedAssets,
} from "./fixtures.ts";

describe("the clothing pack", () => {
  const assets = loadClothedAssets();

  it("ships the nineteen garments the sourcing audit chose", () => {
    expect([...assets.garments.keys()].sort()).toEqual(
      [
        ...["01", "02", "03", "04", "05", "06"].map((n) => `suits/male_casualsuit${n}`),
        "suits/female_casualsuit01",
        "suits/female_casualsuit02",
        "suits/female_sportsuit01",
        "suits/female_elegantsuit01",
        "suits/male_elegantsuit01",
        "suits/male_worksuit01",
        ...["01", "02", "03", "04", "05", "06"].map((n) => `shoes/shoes${n}`),
        "hats/fedora01",
      ].sort(),
    );
    expect(assets.garmentsPending).toBe(false);
  });

  it("gives every garment a category it can stack as, and no id an attachment has", () => {
    for (const g of assets.garments.values())
      expect(Object.keys(GARMENT_LAYERS), g.entry.id).toContain(g.entry.kind);
    for (const id of assets.garments.keys()) expect(assets.attachments.has(id)).toBe(false);
  });

  it("labels every garment for a person, distinctly, without saying whom it is for", () => {
    // A wardrobe is browsed by what a garment is. The asset names (`male_casualsuit01`)
    // carry a sex a body does not need, and the garments bind to any figure.
    const labels = [...assets.garments.values()].map((g) => g.entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label.length, label).toBeGreaterThan(3);
      expect(label, label).not.toMatch(/\b(fe)?male\b|_|\d{2}$/i);
    }
  });

  it("binds every garment, so no mesh is left floating at the origin", () => {
    // A reader that mistook a keyword line for the end of the vertex block bound
    // none of shoes02, 03, 05 and 06.
    for (const g of assets.garments.values()) {
      expect(g.refVerts.length, g.entry.id).toBe(g.entry.vertexCount * 3);
      expect(g.entry.vertexCount, g.entry.id).toBeGreaterThan(500);
      const weightSum = g.weights.reduce((a, b) => a + b, 0);
      expect(weightSum / g.entry.vertexCount, g.entry.id).toBeCloseTo(1, 1);
    }
  });

  it("hides skin under every garment that covers any, and never under a hat", () => {
    for (const g of assets.garments.values()) {
      if (g.entry.kind === "hat") expect(g.deleteVerts.length).toBe(0);
      else expect(g.deleteVerts.length, g.entry.id).toBeGreaterThan(1000);
    }
  });

  it("records the SHA-256 of its binary and ships every texture it names", () => {
    const bytes = fs.readFileSync(path.join(clothingDir, clothingManifest.garments.file));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(clothingManifest.garments.sha256);
    for (const g of clothingManifest.garments.entries)
      for (const t of [g.material.texture, g.material.normalTexture])
        if (t) expect(fs.existsSync(path.join(clothingDir, t)), t).toBe(true);
  });

  it("is built against this body pack, and says where its garments came from", () => {
    expect(clothingManifest.bodySha256).toBe(bodyManifest.body.sha256);
    expect(clothingManifest.topology).toBe(bodyManifest.topology);
    expect(clothingManifest.source.license).toBe("CC0-1.0");
    const provenance = fs.readFileSync(path.join(clothingDir, "PROVENANCE.md"), "utf8");
    for (const g of clothingManifest.garments.entries) expect(provenance).toContain(g.id);
  });
});

describe("parsing a clothing pack", () => {
  it("refuses a pack built for a different body pack", () => {
    const other: ClothingManifest = { ...clothingManifest, bodySha256: "0".repeat(64) };
    expect(() => parseHumanoidAssets(bodyPackData(), undefined, { manifest: other })).toThrow(
      /different body pack/,
    );
    const wrongTopology = { ...clothingManifest, topology: "other-mesh" };
    expect(() =>
      parseHumanoidAssets(bodyPackData(), undefined, { manifest: wrongTopology }),
    ).toThrow(/different body pack/);
  });

  it("refuses a garment that shares an id with an attachment", () => {
    const [first, ...rest] = clothingManifest.garments.entries;
    const clash = {
      ...clothingManifest,
      garments: {
        ...clothingManifest.garments,
        entries: [{ ...first, id: "eyes/high-poly" }, ...rest],
      },
    } as ClothingManifest;
    expect(() => parseHumanoidAssets(bodyPackData(), undefined, { manifest: clash })).toThrow(
      /also an attachment/,
    );
  });

  it("leaves the garments pending until their binary is added, and takes it once", () => {
    const assets = parseHumanoidAssets(
      bodyPackData(),
      undefined,
      clothingPackData(false) as { manifest: ClothingManifest },
    );
    expect(assets.garmentsPending).toBe(true);
    expect(assets.garments.size).toBe(0);
    expect(assets.clothingManifest).toBe(clothingManifest);
    const { garments } = clothingPackData();
    addGarments(assets, garments as ArrayBuffer);
    expect(assets.garmentsPending).toBe(false);
    expect(assets.garments.size).toBe(clothingManifest.garments.entries.length);
    expect(() => addGarments(assets, garments as ArrayBuffer)).toThrow(/already loaded/);
  });

  it("changes nothing when a garment does not check", () => {
    const assets = parseHumanoidAssets(
      bodyPackData(),
      undefined,
      clothingPackData(false) as { manifest: ClothingManifest },
    );
    const { garments } = clothingPackData();
    expect(() => addGarments(assets, (garments as ArrayBuffer).slice(0, 1000))).toThrow(
      AssetFormatError,
    );
    expect(assets.garmentsPending).toBe(true);
    expect(assets.garments.size).toBe(0);
  });

  it("refuses garments added to assets with no clothing pack", () => {
    const assets = parseHumanoidAssets(bodyPackData());
    expect(assets.clothingManifest).toBeNull();
    expect(assets.garmentsPending).toBe(false);
    expect(() => addGarments(assets, new ArrayBuffer(0))).toThrow(/no clothing pack/);
  });
});

describe("loading the clothing pack", { timeout: 60_000 }, () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("brings the garments in a stage of their own, after the modifiers", async () => {
    const requested = stubFetch();
    const staged = await loadHumanoidAssetsStaged({
      body: "http://packs/body",
      clothing: "http://packs/clothing",
    });
    expect(staged.assets.garmentsPending).toBe(true);
    expect(staged.stages.map((s) => s.files).slice(0, 2)).toEqual([["modifiers"], ["garments"]]);
    expect(requested.some((u) => u.endsWith("garments.bin.gz"))).toBe(false);
    await staged.complete;
    expect(staged.assets.garmentsPending).toBe(false);
    expect(staged.assets.garments.size).toBe(19);
    // Texture URLs resolve against the clothing pack, for the renderer to load.
    const url = staged.assets.fileUrls.get("hats_fedora01_fedora_diffuse.webp");
    expect(url).toBe("http://packs/clothing/hats_fedora01_fedora_diffuse.webp");
  });

  it("adds no stage without a clothing pack", async () => {
    stubFetch();
    const staged = await loadHumanoidAssetsStaged({ body: "http://packs/body" });
    expect(staged.stages.flatMap((s) => s.files)).not.toContain("garments");
    expect(staged.assets.garmentsPending).toBe(false);
  });

  it("reports a failed garments fetch on that stage only", async () => {
    stubFetch({ missing: "garments.bin.gz" });
    const staged = await loadHumanoidAssetsStaged({
      body: "http://packs/body",
      clothing: "http://packs/clothing",
    });
    const stage = (id: string) => staged.stages.find((s) => s.files.includes(id));
    await expect(stage("garments")?.loaded).rejects.toThrow(/garments\.bin\.gz failed/);
    await expect(stage("modifiers")?.loaded).resolves.toBe(staged.assets);
    await expect(stage("baby")?.loaded).resolves.toBe(staged.assets);
    expect(staged.assets.garmentsPending).toBe(true);
  });
});

describe("the packer's licence gate for garments", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hk-gate-"));
  const CC0 =
    "# This asset was explicitly released as CC0 in september 2020. The license\n# text for CC0 can be found in the root of this repository.\n";
  const OBJ =
    "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nf 1/1 2/2 3/3 4/4\n";
  const write = (name: string, text: string) => fs.writeFileSync(path.join(dir, name), text);
  const mhclo = (header: string) =>
    `${header}name g\nobj_file g.obj\nmaterial g.mhmat\nz_depth 50\nverts 0\n0\n1\n2\n3\n`;
  const compile = () =>
    compileAsset(path.join(dir, "g.mhclo"), "g", "clothes", { normalMap: true });

  it("packs a garment whose every file states CC0 in its own header", () => {
    write("g.mhclo", mhclo(CC0));
    write("g.obj", `${CC0}${OBJ}`);
    write("g.mhmat", `${CC0}diffuseColor 1 1 1\n`);
    const asset = compile();
    expect(asset.vertexCount).toBe(4);
    expect(Object.keys(asset.evidence)).toHaveLength(3);
  });

  it("refuses a mesh that does not state it, even beside a CC0 mhclo", () => {
    write("g.mhclo", mhclo(CC0));
    write("g.obj", OBJ);
    write("g.mhmat", `${CC0}diffuseColor 1 1 1\n`);
    expect(compile).toThrow(/licence gate: .*g\.obj does not prove CC0/);
  });

  it("will not pack a CC0 mesh on a binding that states another licence without rebuilding it", () => {
    write("g.mhclo", mhclo("# license AGPL3\n"));
    write("g.obj", `${CC0}${OBJ}`);
    write("g.mhmat", `${CC0}diffuseColor 1 1 1\n`);
    expect(compile).toThrow(/licence gate: .*g\.mhclo: its binding is not CC0; pass the base body/);
  });

  it("leaves out a material that does not prove CC0, and the texture it names", () => {
    fs.writeFileSync(path.join(dir, "g.png"), "x");
    write("g.mhclo", mhclo(CC0));
    write("g.obj", `${CC0}${OBJ}`);
    write("g.mhmat", "diffuseTexture g.png\n");
    const asset = compile();
    expect(asset.material.texture).toBeNull();
    expect(asset.textures.size).toBe(0);
  });

  it("packs a team asset's textures, the normal map too, on the files' CC0 header", () => {
    fs.writeFileSync(path.join(dir, "g.png"), "x");
    fs.writeFileSync(path.join(dir, "g_n.png"), "x");
    write("g.mhclo", mhclo(CC0));
    write("g.obj", `${CC0}${OBJ}`);
    write("g.mhmat", `${CC0}diffuseTexture g.png\nnormalmapTexture g_n.png\n`);
    const asset = compile();
    expect([...asset.textures.values()].sort()).toEqual(["g_g.webp", "g_g_n.webp"]);
    expect(asset.material.normalTexture).toBe("g_g_n.webp");
    expect(
      Object.values(asset.evidence).filter((e) => e === "A: binary file of a team asset"),
    ).toHaveLength(2);
  });
});
