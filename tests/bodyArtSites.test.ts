import { describe, expect, it } from "vitest";
import { bodySites, resolveAnchor } from "../src/bodyArt/sites.ts";
import { PIERCING_SITES } from "../src/recipe/bodyArt.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const sites = bodySites(assets);
const at = (v: number) => [0, 1, 2].map((k) => assets.positions[v * 3 + k] as number);

describe("body-art sites", () => {
  it("finds every piercing site on the base mesh, mirrored exactly left to right", () => {
    for (const site of PIERCING_SITES) expect(sites[site].vertex, site).toBeGreaterThanOrEqual(0);
    for (const pair of ["ear-lobe", "ear-helix", "nostril", "brow"] as const) {
      const [l, r] = [at(sites[`${pair}.L`].vertex), at(sites[`${pair}.R`].vertex)];
      expect(l[0], pair).toBeGreaterThan(0);
      expect(l[0]).toBeCloseTo(-(r[0] as number), 5);
      expect(l[1]).toBeCloseTo(r[1] as number, 5);
      expect(l[2]).toBeCloseTo(r[2] as number, 5);
    }
    for (const site of ["septum", "lower-lip", "navel"] as const)
      expect(Math.abs(at(sites[site].vertex)[0] as number), site).toBeLessThan(1e-4);
  });

  it("puts each site where its feature is", () => {
    const [lobe, helix] = [at(sites["ear-lobe.L"].vertex), at(sites["ear-helix.L"].vertex)];
    // The lobe hangs below the helix's top, by most of an ear (about 6 cm long).
    expect((helix[1] as number) - (lobe[1] as number)).toBeGreaterThan(0.03);
    const [nostril, septum] = [at(sites["nostril.L"].vertex), at(sites.septum.vertex)];
    // The septum lies between the nostrils, within a few millimetres of their middle.
    expect(Math.abs((septum[1] as number) - (nostril[1] as number))).toBeLessThan(0.008);
    expect(Math.abs((septum[2] as number) - (nostril[2] as number))).toBeLessThan(0.012);
    const [brow, lip, navel] = [
      at(sites["brow.L"].vertex),
      at(sites["lower-lip"].vertex),
      at(sites.navel.vertex),
    ];
    expect(brow[1]).toBeGreaterThan(nostril[1] as number);
    expect(lip[1]).toBeLessThan(nostril[1] as number);
    expect(navel[1]).toBeLessThan((lip[1] as number) - 0.3);
    expect(sites.septum.channel).toBe("across");
    expect(sites["ear-lobe.L"].channel).toBe("normal");
  });

  it("resolves an anchor to its vertex, and refuses one it cannot place", () => {
    expect(resolveAnchor(assets, "navel")).toBe(sites.navel.vertex);
    expect(resolveAnchor(assets, 12)).toBe(12);
    expect(() => resolveAnchor(assets, "elbow")).toThrow(RangeError);
    expect(() => resolveAnchor(assets, assets.manifest.vertexCount)).toThrow(RangeError);
  });
});
