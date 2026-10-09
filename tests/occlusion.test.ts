import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { OCCLUSION_KEYS, occlusionCorners } from "../src/rig/occlusionKeys.ts";
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

  it("reuses a baseline exactly where nothing within reach moved, and only there", () => {
    const targets = [
      {
        // Under the lid, beside the long triangle, and far from both.
        positions: new Float32Array([0, 0, 0, 0.5, 0, 0, 5, 0, 0]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      },
    ];
    const lid = (y: number) => ({
      positions: new Float32Array([-0.05, y, -0.05, 0.05, y, -0.05, 0.05, y, 0.05]),
      index: new Uint32Array([0, 1, 2]),
    });
    // A long thin triangle whose corners are out of reach of x = 0.5 but whose
    // middle passes over it; it stays out of reach of the vertex at x = 0.
    const sliver = (y: number) => ({
      positions: new Float32Array([0.2, y, 0, 0.8, y, 0.002, 0.8, y, -0.002]),
      index: new Uint32Array([0, 1, 2]),
    });
    const before = [lid(0.01), sliver(5)];
    const after = [lid(5), sliver(0.01)];
    const values = bakeOcclusion(before, targets);
    const full = bakeOcclusion(after, targets)[0] as Float32Array;
    const reused = bakeOcclusion(after, targets, {
      baseline: { occluders: before, targets, values },
    })[0] as Float32Array;
    // The lid left (only its old place was near) and the sliver arrived (only its middle is near).
    expect(Array.from(reused)).toEqual(Array.from(full));
    expect(full[0]).toBeGreaterThan(values[0]?.[0] as number);
    expect(() =>
      bakeOcclusion([plane(1)], targets, { baseline: { occluders: before, targets, values } }),
    ).toThrow(/differ/);
  });

  it("is deterministic", () => {
    const a = bakeOcclusion([plane(0.02)], [point], { distance: 0.05 });
    const b = bakeOcclusion([plane(0.02)], [point], { distance: 0.05 });
    expect(a).toEqual(b);
  });
});

const CORNERS = occlusionCorners(OCCLUSION_KEYS.length);
/** Corner `m` of an attachment's per-vertex occlusion (0 = rest). */
const corner = (occlusion: Float32Array | undefined, m: number) =>
  (occlusion ?? new Float32Array(0)).filter((_, k) => k % CORNERS === m);

describe("attachment occlusion on the figure", () => {
  const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 0 });
  const topology = model.topology();
  const median = (id: string) => {
    const o = [...corner(topology.attachments.find((a) => a.id === id)?.occlusion, 0)].sort(
      (p, q) => p - q,
    );
    expect(o.length).toBeGreaterThan(0);
    for (const v of o) expect(v >= 0 && v <= 1).toBe(true);
    return o[Math.floor(o.length / 2)] as number;
  };

  it("shades teeth inside the mouth more than the eyes under the lids", () => {
    expect(median("teeth/base")).toBeLessThan(median("eyes/high-poly"));
  });

  it("uncovers the front teeth as the mouth opens, most with jaw and lips together", () => {
    const i = topology.attachments.findIndex((a) => a.id === "teeth/base");
    const occ = topology.attachments[i]?.occlusion;
    const z = model.evaluate(createRecipe()).attachments[i]?.positions ?? new Float32Array(0);
    const n = z.length / 3;
    const front = [...Array(n).keys()]
      .sort((a, b) => (z[b * 3 + 2] as number) - (z[a * 3 + 2] as number))
      .slice(0, Math.ceil(n * 0.05));
    const p90 = (m: number) => {
      const c = corner(occ, m);
      const v = front.map((k) => c[k] as number).sort((a, b) => a - b);
      return v[Math.floor(v.length * 0.9)] as number;
    };
    // Corner bits: 1 = jaw open, 2 = lips apart, 4 = smile. Measured on the
    // default figure, corners 0-7: 0.03 0.31 0.53 0.69 0.06 0.69 0.62 0.75.
    // The keys interact both ways, so a sum of single keys would be wrong:
    // a smile uncovers the teeth only with the jaw open (more than the sum),
    // while jaw and lips uncover the same teeth (less than the sum).
    expect(p90(0)).toBeLessThan(0.05);
    expect(p90(1)).toBeGreaterThan(p90(0) + 0.2);
    expect(p90(2)).toBeGreaterThan(p90(0) + 0.2);
    expect(p90(5)).toBeGreaterThan(p90(1) + p90(4) + 0.2);
    expect(p90(3)).toBeLessThan(p90(1) + p90(2));
  });

  it("does not let the transparent cornea shade the iris", () => {
    // Measured: 39% of eye vertices are mostly open when the cornea is ignored,
    // 20% when the alpha-cut cornea is (wrongly) treated as solid.
    const occlusion = corner(topology.attachments.find((a) => a.kind === "eyes")?.occlusion, 0);
    const open = [...occlusion].filter((v) => v > 0.5).length / occlusion.length;
    expect(open).toBeGreaterThan(0.3);
  });
});
