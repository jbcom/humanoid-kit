/**
 * Loading the packs in Node. A pack package exports its files as
 * `new URL(..., import.meta.url)`, which Node resolves to `file:` URLs, and
 * Node's own `fetch` does not implement that scheme: the loaders read them from
 * disk themselves, and a host that supplies its own `fetch` takes over every
 * request. These tests use the real packs through those real `file:` URLs and
 * never stub the global `fetch`.
 */
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { animationsPack } from "../packs/animations/index.js";
import { bodyPack } from "../packs/body/index.js";
import { eyesPack } from "../packs/eyes/index.js";
import { loadAnimationLibrary } from "../src/animation/library.ts";
import { loadEyeLibrary } from "../src/eyes/library.ts";
import {
  AssetFormatError,
  type FetchLike,
  fetchOk,
  loadHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";

describe("loading the packs in Node", { timeout: 60_000 }, () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exports file: URLs here, which is what the loaders must read", () => {
    expect(bodyPack.manifest.startsWith("file:")).toBe(true);
  });

  it("loads the body pack through its own file: URLs and evaluates a recipe", async () => {
    const assets = await loadHumanoidAssets({ body: bodyPack });
    expect(assets.targets.size).toBeGreaterThan(0);
    const model = new HumanoidModel(assets, { subdivision: 0 });
    const { positions } = model.evaluate(createRecipe({ macros: { age: 34, height: 0.7 } }));
    expect(positions.length).toBeGreaterThan(0);
    expect([...positions].every(Number.isFinite)).toBe(true);
  });

  it("loads the animation and eye libraries through file: URLs", async () => {
    const animations = await loadAnimationLibrary(animationsPack);
    const walk = animations.entry("walk_normal");
    expect(walk).toBeDefined();
    const clip = await animations.load("walk_normal", walk?.bones ?? []);
    expect(clip.frames).toBe(walk?.frames);
    const eyes = await loadEyeLibrary(eyesPack);
    expect(eyes.manifest.materials.length).toBeGreaterThan(0);
  });

  it("answers a file: URL that does not exist like a 404", async () => {
    const missing = new URL("../packs/body/data/no-such-file.bin", import.meta.url).href;
    await expect(fetchOk(missing)).rejects.toThrow(AssetFormatError);
    await expect(fetchOk(missing)).rejects.toThrow(/404/);
  });

  it("uses the host's fetch for every request when one is given", async () => {
    const platform = vi.fn(() => Promise.reject(new Error("the platform fetch was used")));
    vi.stubGlobal("fetch", platform);
    const requested: string[] = [];
    const hostFetch: FetchLike = async (url) => {
      requested.push(url);
      // Serve the real files, as a host with its own store would.
      return new Response(Uint8Array.from(await readFile(new URL(url))));
    };
    const assets = await loadHumanoidAssets({ body: bodyPack, fetch: hostFetch });
    expect(assets.targets.size).toBeGreaterThan(0);
    expect(requested).toContain(bodyPack.manifest);
    expect(requested.length).toBeGreaterThan(5);
    expect(platform).not.toHaveBeenCalled();

    const animations = await loadAnimationLibrary(animationsPack, { fetch: hostFetch });
    expect(requested).toContain(animationsPack.manifest);
    expect(animations.entry("walk_normal")).toBeDefined();
    expect(platform).not.toHaveBeenCalled();
  });

  it("reports a host fetch's error status as an AssetFormatError", async () => {
    const refuse: FetchLike = async () =>
      new Response("no", { status: 403, statusText: "Forbidden" });
    await expect(loadHumanoidAssets({ body: bodyPack, fetch: refuse })).rejects.toThrow(
      /403 Forbidden/,
    );
    await expect(loadAnimationLibrary(animationsPack, { fetch: refuse })).rejects.toThrow(
      AssetFormatError,
    );
  });
});
