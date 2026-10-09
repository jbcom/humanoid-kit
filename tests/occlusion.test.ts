import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { bakeOcclusion, hemisphereDirections } from "../src/surface/occlusion.ts";
import { loadFixtureAssets } from "./fixtures.ts";

/** A 2 m square at height `y`, facing down and up (two triangles each side handled by DoubleSide). */
const plane = (y: number) => ({
  positions: new Float32Array([-1, y, -1, 1, y, -1, 1, y, 1, -1, y, 1]),
  index: new Uint32Array([0, 1, 2, 0, 2, 3]),
});
const point = { positions: new Float32Array([0, 0, 0]), normals: new Float32Array([0, 1, 0]) };

describe("bakeOcclusion", () => {
  it("uses unit directions in the upper hemisphere", () => {
    const d = hemisphereDirections(64);
    for (let i = 0; i < 64; i++) {
      expect(
        Math.hypot(d[i * 3] as number, d[i * 3 + 1] as number, d[i * 3 + 2] as number),
      ).toBeCloseTo(1, 6);
      expect(d[i * 3 + 2]).toBeGreaterThan(0);
    }
  });

  it("is open with nothing nearby, closed under a lid, and open past the distance", () => {
    expect(bakeOcclusion([plane(-5)], [point])[0]?.[0]).toBe(1);
    // Only near-horizontal rays escape a lid 1 cm away within 5 cm.
    expect(bakeOcclusion([plane(0.01)], [point])[0]?.[0]).toBeLessThan(0.1);
    expect(bakeOcclusion([plane(0.2)], [point], { distance: 0.05 })[0]?.[0]).toBe(1);
  });

  it("is deterministic", () => {
    const a = bakeOcclusion([plane(0.02)], [point], { distance: 0.05 });
    const b = bakeOcclusion([plane(0.02)], [point], { distance: 0.05 });
    expect(a).toEqual(b);
  });
});

describe("attachment occlusion on the figure", () => {
  const topology = new HumanoidModel(loadFixtureAssets(), { subdivision: 0 }).topology();
  const median = (id: string) => {
    const o = [...(topology.attachments.find((a) => a.id === id)?.occlusion ?? [])].sort(
      (p, q) => p - q,
    );
    expect(o.length).toBeGreaterThan(0);
    for (const v of o) expect(v >= 0 && v <= 1).toBe(true);
    return o[Math.floor(o.length / 2)] as number;
  };

  it("shades teeth inside the mouth more than the eyes under the lids", () => {
    expect(median("teeth/base")).toBeLessThan(median("eyes/high-poly"));
  });

  it("does not let the transparent cornea shade the iris", () => {
    // Measured: 39% of eye vertices are mostly open when the cornea is ignored,
    // 20% when the alpha-cut cornea is (wrongly) treated as solid.
    const occlusion = topology.attachments.find((a) => a.kind === "eyes")?.occlusion ?? [];
    const open = [...occlusion].filter((v) => v > 0.5).length / occlusion.length;
    expect(open).toBeGreaterThan(0.3);
  });
});
