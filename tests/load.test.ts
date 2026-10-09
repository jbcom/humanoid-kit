import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssetFormatError,
  groupFaces,
  jointPosition,
  loadHumanoidAssets,
  loadHumanoidAssetsStaged,
} from "../src/format/assetFormat.ts";
import { stubFetch } from "./fetchStub.ts";
import { adultDir, bodyDir, bodyManifest } from "./fixtures.ts";

// Each load decodes and parses the full pack (~2 s), so these get room.
describe("loadHumanoidAssets", { timeout: 60_000 }, () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("loads a pack from a directory URL, with or without a trailing slash", async () => {
    stubFetch();
    const a = await loadHumanoidAssets({ body: "http://packs/body" });
    const b = await loadHumanoidAssets({ body: "http://packs/body/" });
    expect(a.targets.size).toBe(b.targets.size);
    expect(a.adultAnatomyLoaded).toBe(false);
    // Texture URLs resolve against the pack, for the renderer to load.
    expect([...a.fileUrls.values()].every((u) => u.startsWith("http://packs/body/"))).toBe(true);
  });

  it("loads explicit per-file URLs, as the pack packages export them, plus the adult pack", async () => {
    stubFetch();
    const files = (dir: string, prefix: string) =>
      Object.fromEntries(fs.readdirSync(dir).map((f) => [f, `http://packs/${prefix}/${f}`]));
    const assets = await loadHumanoidAssets({
      body: { manifest: "http://packs/body/manifest.json", files: files(bodyDir, "body") },
      adultAnatomy: {
        manifest: "http://packs/adult/manifest.json",
        files: files(adultDir, "adult"),
      },
    });
    expect(assets.adultAnatomyLoaded).toBe(true);
    expect([...assets.modifiers.values()].some((m) => m.adultOnly)).toBe(true);
  });

  it("accepts targets a host has already decompressed", async () => {
    stubFetch({ decompressGz: true });
    const assets = await loadHumanoidAssets({ body: "http://packs/body" });
    expect(assets.targets.size).toBe(
      bodyManifest.targets.reduce((n, f) => n + f.entries.length, 0),
    );
  });

  it("hands over the first figure before the rest arrives, fetching stage after stage", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const requested = stubFetch({ hold: { file: "targets-child.bin.gz", until: gate } });
    const staged = await loadHumanoidAssetsStaged({
      body: "http://packs/body",
      adultAnatomy: "http://packs/adult",
      firstFigureAge: 25,
    });
    expect([...staged.assets.targetFilesPending].sort()).toEqual(
      ["adult", "baby", "child", "modifiers", "old"].sort(),
    );
    expect(staged.stages.map((s) => s.files)).toEqual([
      ["child"],
      ["old"],
      ["baby"],
      ["modifiers", "adult"],
    ]);
    // Nothing after the held stage was fetched: stages share the link in turn.
    await new Promise((r) => setTimeout(r, 20));
    expect(requested.some((u) => u.endsWith("targets-old.bin.gz"))).toBe(false);
    release();
    const assets = await staged.complete;
    expect(assets).toBe(staged.assets);
    expect(assets.targetFilesPending.size).toBe(0);
    const order = ["child", "old", "baby", "modifiers"].map((id) =>
      requested.findIndex((u) => u.endsWith(`targets-${id}.bin.gz`)),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("reports a failed stage on that stage and the ones that need it, not the first", async () => {
    stubFetch({ missing: "targets-modifiers.bin.gz" });
    const staged = await loadHumanoidAssetsStaged({ body: "http://packs/body" });
    await expect(staged.stages.at(-1)?.loaded).rejects.toThrow(/targets-modifiers\.bin\.gz failed/);
    await expect(staged.complete).rejects.toThrow(/targets-modifiers/);
    await expect(staged.stages[0]?.loaded).resolves.toBe(staged.assets);
    expect(staged.assets.targetFilesPending.has("modifiers")).toBe(true);
  });

  it("reports a failed fetch and a missing per-file URL", async () => {
    stubFetch({ missing: "attachments.bin.gz" });
    await expect(loadHumanoidAssets({ body: "http://packs/body" })).rejects.toThrow(
      /attachments\.bin\.gz failed: 404 Not Found/,
    );
    stubFetch();
    await expect(
      loadHumanoidAssets({ body: { manifest: "http://packs/body/manifest.json", files: {} } }),
    ).rejects.toThrow(AssetFormatError);
  });
});

describe("mesh helpers", { timeout: 60_000 }, () => {
  it("finds face groups and joint centroids, and names what is missing", async () => {
    stubFetch();
    const assets = await loadHumanoidAssets({ body: "http://packs/body" });
    vi.unstubAllGlobals();
    expect(groupFaces(assets, "body").length).toBeGreaterThan(10000);
    expect(() => groupFaces(assets, "no-such-group")).toThrow(/no face group/);
    const out = new Float32Array(3);
    jointPosition(assets, assets.positions, "head____head", out);
    expect(out[1]).toBeGreaterThan(0.5);
    expect(() => jointPosition(assets, assets.positions, "no-such-joint", out)).toThrow(/no joint/);
  });
});
