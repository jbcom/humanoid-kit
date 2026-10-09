import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssetFormatError,
  groupFaces,
  jointPosition,
  loadHumanoidAssets,
  loadHumanoidAssetsStaged,
} from "../src/format/assetFormat.ts";
import { adultDir, bodyDir, bodyManifest } from "./fixtures.ts";

/** Serves pack files from disk at http://packs/<body|adult>/<file>, like a static host. */
function stubFetch(
  options: {
    decompressGz?: boolean;
    missing?: string;
    /** Answers this file only once `until` settles. */
    hold?: { file: string; until: Promise<void> };
  } = {},
) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    requested.push(input);
    const url = new URL(input);
    const [, pack, file] = url.pathname.split("/");
    if (options.hold && file === options.hold.file) await options.hold.until;
    const dir = pack === "adult" ? adultDir : bodyDir;
    const p = path.join(dir, file ?? "");
    if (file === options.missing || !fs.existsSync(p))
      return new Response("not found", { status: 404, statusText: "Not Found" });
    let bytes: Uint8Array = fs.readFileSync(p);
    // A host that sends .gz with Content-Encoding: gzip hands the page decoded bytes.
    if (options.decompressGz && p.endsWith(".gz")) bytes = gunzipSync(bytes);
    return new Response(Uint8Array.from(bytes));
  });
  return requested;
}

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
      bodyManifest.targets.entries.length + bodyManifest.modifierTargets.entries.length,
    );
  });

  it("hands over a figure before the modifier targets have arrived", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    stubFetch({ hold: { file: "modifier-targets.bin.gz", until: gate } });
    const staged = await loadHumanoidAssetsStaged({
      body: "http://packs/body",
      adultAnatomy: "http://packs/adult",
    });
    expect(staged.assets.modifierTargetsLoaded).toBe(false);
    expect(staged.assets.adultAnatomyLoaded).toBe(true);
    release();
    const assets = await staged.modifierTargets;
    expect(assets).toBe(staged.assets);
    expect(assets.modifierTargetsLoaded).toBe(true);
    expect([...assets.modifiers.values()].every((m) => assets.targets.has(m.hi))).toBe(true);
  });

  it("reports a modifier-target failure on the second stage only", async () => {
    stubFetch({ missing: "modifier-targets.bin.gz" });
    const staged = await loadHumanoidAssetsStaged({ body: "http://packs/body" });
    await expect(staged.modifierTargets).rejects.toThrow(/modifier-targets\.bin\.gz failed/);
    expect(staged.assets.modifierTargetsLoaded).toBe(false);
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
