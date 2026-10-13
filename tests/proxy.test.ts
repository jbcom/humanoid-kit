import { describe, expect, it } from "vitest";
import { addProxies, parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { BODY_REGIONS } from "../src/makehuman/regions.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import {
  boundProxy,
  fitProxy,
  PROXY_IDS,
  ProxyError,
  proxyIndex,
  proxyTopology,
} from "../src/model/proxy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  bodyManifest,
  bodyPackData,
  clothingPackData,
  loadMiniatureAssets,
  proxyPackFile,
} from "./fixtures.ts";

const extentY = (p: Float32Array) => {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < p.length; i += 3) {
    lo = Math.min(lo, p[i] as number);
    hi = Math.max(hi, p[i] as number);
  }
  return { lo, hi, height: hi - lo };
};

describe("MakeHuman proxy bodies", { timeout: 120_000 }, () => {
  const assets = loadMiniatureAssets();
  const model = new HumanoidModel(assets, { subdivision: 0 });

  it("ships MakeHuman's three low-poly proxies with their own vertex counts", () => {
    const entries = bodyManifest.proxies?.entries ?? [];
    expect(entries.map((e) => e.id)).toEqual([...PROXY_IDS]);
    expect(Object.fromEntries(entries.map((e) => [e.id, e.vertexCount]))).toEqual({
      proxy741: 741,
      male1591: 1591,
      female1605: 1605,
    });
    // proxy741 is "Minimal poly character (741 vertices, 730 FACES)": all quads.
    expect(proxyTopology(assets, "proxy741").index.length / 3).toBe(1460);
  });

  it("adds the proxy file once, and names what is missing", () => {
    const bare = parseHumanoidAssets(bodyPackData(), undefined, clothingPackData(false));
    expect(bare.proxies.size).toBe(0);
    expect(() => boundProxy(bare, "proxy741")).toThrow(/has not loaded/);
    expect(() => boundProxy(bare, "proxy9")).toThrow(ProxyError);
    addProxies(bare, proxyPackFile());
    expect([...bare.proxies.keys()]).toEqual([...PROXY_IDS]);
    expect(() => addProxies(bare, proxyPackFile())).toThrow(/already loaded/);
  });

  it("fits every proxy to the body it stands for, and follows the body's shape", () => {
    for (const height of [0.1, 0.9]) {
      const ev = model.evaluate(createRecipe({ macros: { height } }));
      const body = extentY(ev.positions);
      const control = Float32Array.from(ev.control);
      for (const id of PROXY_IDS) {
        const proxy = extentY(fitProxy(assets, id, control));
        // The same figure: crown and soles within two centimetres.
        expect(Math.abs(proxy.hi - body.hi)).toBeLessThan(0.02);
        expect(Math.abs(proxy.lo - body.lo)).toBeLessThan(0.02);
      }
    }
  });

  it("skins each proxy vertex by its base vertices' weights, normalised", () => {
    for (const id of PROXY_IDS) {
      const { skinWeight } = proxyTopology(assets, id);
      for (let v = 0; v < skinWeight.length; v += 4) {
        const sum =
          (skinWeight[v] as number) +
          (skinWeight[v + 1] as number) +
          (skinWeight[v + 2] as number) +
          (skinWeight[v + 3] as number);
        expect(sum).toBeCloseTo(1, 5);
      }
    }
  });

  it("hides what the outfit covers and keeps the head and hands", () => {
    const outfit = model.outfit(["suits/male_worksuit01", "shoes/shoes01"]);
    const all = proxyTopology(assets, "proxy741").index;
    const shown = proxyIndex(assets, "proxy741", outfit.bodyVisible);
    expect(proxyIndex(assets, "proxy741", null)).toBe(all);
    // MakeHuman's suits delete sparingly (no gap may open at a seam): the base body
    // keeps about 79% of its triangles under this outfit and the proxy about 57%.
    expect(shown.length).toBeLessThan(all.length * 0.65);
    // Every triangle wholly on the head stays.
    const ev = model.evaluate(createRecipe({ outfit: outfit.order }));
    const control = Float32Array.from(ev.control);
    const fitted = fitProxy(assets, "proxy741", control);
    const crown = extentY(fitted).hi;
    const kept = new Set<string>();
    for (let t = 0; t < shown.length; t += 3)
      kept.add([shown[t], shown[t + 1], shown[t + 2]].join(","));
    let head = 0;
    for (let t = 0; t < all.length; t += 3) {
      const ys = [all[t], all[t + 1], all[t + 2]].map(
        (v) => fitted[(v as number) * 3 + 1] as number,
      );
      if (Math.min(...ys) > crown - 0.18) {
        head++;
        expect(kept.has([all[t], all[t + 1], all[t + 2]].join(","))).toBe(true);
      }
    }
    expect(head).toBeGreaterThan(50);
    expect(BODY_REGIONS).toContain("head");
  });
});
