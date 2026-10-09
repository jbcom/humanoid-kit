import { describe, expect, it } from "vitest";
import { placeBodyArt } from "../src/bodyArt/decals.ts";
import {
  JEWELLERY_ROUGHNESS,
  jewelleryMesh,
  METAL_REFLECTANCE,
  TISSUE_DEPTH,
} from "../src/bodyArt/jewellery.ts";
import { bodySites } from "../src/bodyArt/sites.ts";
import type { Vec3 } from "../src/presence/presence.ts";
import { createBodyArt, JEWELLERY, METALS, PIERCING_SITES } from "../src/recipe/bodyArt.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const dot = (a: Vec3, b: readonly number[]) =>
  a[0] * (b[0] as number) + a[1] * (b[1] as number) + a[2] * (b[2] as number);
const sub = (a: readonly number[], b: readonly number[]): Vec3 => [
  (a[0] as number) - (b[0] as number),
  (a[1] as number) - (b[1] as number),
  (a[2] as number) - (b[2] as number),
];
const len = (a: Vec3) => Math.hypot(...a);

/** Every site pierced with `jewellery`, placed on the base mesh. */
const pierced = (jewellery: (typeof JEWELLERY)[number]) =>
  placeBodyArt(
    assets,
    createBodyArt({ piercings: PIERCING_SITES.map((site) => ({ site, jewellery })) }),
    assets.positions,
  ).piercings;

describe("placing piercings", () => {
  it("puts each at its site's vertex, skinned by that vertex's own bones", () => {
    const sites = bodySites(assets);
    for (const p of pierced("stud")) {
      const v = sites[p.site as (typeof PIERCING_SITES)[number]].vertex;
      expect(p.hole).toEqual([
        assets.positions[v * 3],
        assets.positions[v * 3 + 1],
        assets.positions[v * 3 + 2],
      ]);
      expect(p.skinIndex).toEqual(Array.from(assets.skinIndex.slice(v * 4, v * 4 + 4)));
      expect(p.skinWeight).toEqual(Array.from(assets.skinWeight.slice(v * 4, v * 4 + 4)));
    }
  });

  it("runs each hole along its site's channel, with a ring hanging square to it", () => {
    const sites = bodySites(assets);
    for (const p of pierced("ring")) {
      const site = sites[p.site as (typeof PIERCING_SITES)[number]];
      for (const a of [p.channel, p.down, p.normal]) expect(len(a)).toBeCloseTo(1, 6);
      expect(dot(p.channel, p.down)).toBeCloseTo(0, 6);
      const depth = TISSUE_DEPTH[p.site as (typeof PIERCING_SITES)[number]];
      if (site.channel === "normal") {
        // Into the skin, its middle halfway through the tissue.
        expect(dot(p.channel, p.normal)).toBeCloseTo(-1, 6);
        expect(len(sub(p.middle, p.hole))).toBeCloseTo(depth / 2, 6);
      } else {
        // Under the skin, along it.
        expect(Math.abs(dot(p.channel, p.normal))).toBeLessThan(1e-6);
        expect(dot(sub(p.middle, p.hole), p.normal)).toBeCloseTo(-depth / 2, 6);
      }
      if (site.channel === "across") expect(Math.abs(p.channel[0])).toBeGreaterThan(0.9);
      if (site.channel === "vertical") expect(Math.abs(p.channel[1])).toBeGreaterThan(0.5);
      // Rings hang down; through a ridge they loop out in front of it.
      if (site.channel === "vertical") expect(dot(p.down, p.normal)).toBeGreaterThan(0.99);
      else expect(p.down[1]).toBeLessThan(0);
    }
  });

  it("refuses a site that is not one of the body's: the adult pack names none yet", () => {
    const art = createBodyArt({ piercings: [{ site: "adult-pack-site" }] });
    expect(() => placeBodyArt(assets, art, assets.positions)).toThrow(RangeError);
  });
});

describe("jewellery", () => {
  const points = (m: ReturnType<typeof jewelleryMesh>) =>
    Array.from({ length: m.positions.length / 3 }, (_, i) =>
      Array.from(m.positions.slice(i * 3, i * 3 + 3)),
    );

  it("makes a closed, finite mesh with unit normals for every kind at every site", () => {
    for (const kind of JEWELLERY)
      for (const p of pierced(kind)) {
        const m = jewelleryMesh(p);
        expect(m.positions.length).toBeGreaterThan(0);
        expect(m.positions.every(Number.isFinite)).toBe(true);
        for (let i = 0; i < m.normals.length; i += 3)
          expect(
            Math.hypot(
              m.normals[i] as number,
              m.normals[i + 1] as number,
              m.normals[i + 2] as number,
            ),
          ).toBeCloseTo(1, 5);
        for (const i of m.index) expect(i).toBeLessThan(m.positions.length / 3);
      }
  });

  it("seats a stud on the skin, outside it", () => {
    for (const p of pierced("stud")) {
      const pts = points(jewelleryMesh(p));
      const out = pts.map((q) => dot(p.normal, sub(q, p.hole)));
      // Its top stands 1.6 radii out (a fifth of the ball is below the surface).
      expect(Math.max(...out)).toBeCloseTo(p.size * 0.8, 3);
      expect(Math.min(...out)).toBeGreaterThan(-p.size * 0.5);
    }
  });

  it("passes a ring through the hole's middle, hanging from it", () => {
    for (const p of pierced("ring")) {
      const pts = points(jewelleryMesh(p));
      // The wire's surface comes within its thickness of the middle, and most of the ring hangs below.
      const nearest = Math.min(...pts.map((q) => len(sub(q, p.middle))));
      expect(nearest).toBeLessThan(p.size * 0.1 + 0.001);
      const below = pts.filter((q) => dot(p.down, sub(q, p.middle)) > 0).length;
      expect(below / pts.length).toBeGreaterThan(0.9);
    }
  });

  it("lays a barbell's bar along the channel, a ball at each end", () => {
    for (const p of pierced("barbell")) {
      const along = points(jewelleryMesh(p)).map((q) => dot(p.channel, sub(q, p.middle)));
      expect(Math.max(...along)).toBeGreaterThan(p.size / 2);
      expect(Math.min(...along)).toBeLessThan(-p.size / 2);
    }
  });

  it("has a measured reflectance for every metal", () => {
    for (const metal of METALS)
      for (const c of METAL_REFLECTANCE[metal]) expect(c).toBeGreaterThan(0.2);
    expect(JEWELLERY_ROUGHNESS).toBeLessThan(0.3);
  });
});
