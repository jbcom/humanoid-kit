import { describe, expect, it } from "vitest";
import { ATLAS_SIZE, bodyCoverage, placeIslands, takeRect } from "../scripts/lib/uvIslands.ts";
import type { AdultReservoirSpec } from "../src/format/assetFormat.ts";
import { OWNER_GRID } from "../src/surface/atlasPlan.ts";

/** Free UV space for the reservoirs' islands (scripts/lib/uvIslands.ts), on a small grid. */
const SIZE = 64;
const triangle = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => ({
  uvs: Float32Array.of(x0, y0, x1, y1, x2, y2),
  index: Uint32Array.of(0, 1, 2),
});

describe("the body's coverage of UV space", () => {
  it("marks the owner-map cells a triangle reaches and a cell round them, and nothing far from it", () => {
    const t = triangle(0.5, 0.5, 0.75, 0.5, 0.5, 0.75);
    const covered = bodyCoverage(t.uvs, t.index, SIZE);
    const at = (u: number, v: number) =>
      covered[Math.floor(v * SIZE) * SIZE + Math.floor(u * SIZE)];
    expect(at(0.55, 0.55)).toBe(1);
    // A cell outside the triangle's box: the planner counts it as the triangle's too.
    expect(at(0.5 - 1 / OWNER_GRID, 0.55)).toBe(1);
    expect(at(0.5 - 2.5 / OWNER_GRID, 0.55)).toBe(0);
    expect(at(0.05, 0.05)).toBe(0);
    expect(at(0.95, 0.95)).toBe(0);
  });

  it("leaves an island in cells no body triangle's footprint shares, so the planner can share its channel", () => {
    // The body's triangle, and an island taken beside it: their planned footprints
    // (`planAtlas`: the cells of each triangle's box and one round) do not meet.
    const t = triangle(0.5, 0.5, 0.75, 0.5, 0.5, 0.75);
    const covered = bodyCoverage(t.uvs, t.index, ATLAS_SIZE);
    const r = takeRect(covered, 40, 40, ATLAS_SIZE);
    if (!r) throw new Error("no room");
    const cells = (u0: number, v0: number, u1: number, v1: number) => {
      const out = new Set<number>();
      const c = (x: number) => Math.min(OWNER_GRID - 1, Math.max(0, Math.floor(x * OWNER_GRID)));
      for (let y = c(v0) - 1; y <= c(v1) + 1; y++)
        for (let x = c(u0) - 1; x <= c(u1) + 1; x++) out.add(y * OWNER_GRID + x);
      return out;
    };
    const body = cells(0.5, 0.5, 0.75, 0.75);
    const island = cells(
      r.x / ATLAS_SIZE,
      r.y / ATLAS_SIZE,
      (r.x + r.width) / ATLAS_SIZE,
      (r.y + r.height) / ATLAS_SIZE,
    );
    expect([...island].some((c) => body.has(c))).toBe(false);
  });
});

describe("taking free rectangles", () => {
  it("takes the first free place that fits, never twice the same", () => {
    const covered = new Uint8Array(SIZE * SIZE);
    const a = takeRect(covered, 10, 8, SIZE);
    const b = takeRect(covered, 10, 8, SIZE);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const [p, q] = [a, b] as [NonNullable<typeof a>, NonNullable<typeof b>];
    const apart =
      q.x >= p.x + p.width ||
      q.x + q.width <= p.x ||
      q.y >= p.y + p.height ||
      q.y + q.height <= p.y;
    expect(apart).toBe(true);
  });

  it("keeps a gutter between what it takes and what is there, and from the edge", () => {
    const covered = new Uint8Array(SIZE * SIZE);
    const r = takeRect(covered, 6, 6, SIZE);
    expect(r?.x).toBeGreaterThanOrEqual(6);
    expect(r?.y).toBeGreaterThanOrEqual(6);
    // The next one clears the first by the gutter.
    const next = takeRect(covered, 6, 6, SIZE);
    if (!r || !next) throw new Error("no room");
    const gap = Math.max(
      next.x - (r.x + r.width),
      r.x - (next.x + next.width),
      next.y - (r.y + r.height),
      r.y - (next.y + next.height),
    );
    expect(gap).toBeGreaterThanOrEqual(6);
  });

  it("returns null when nothing fits", () => {
    const covered = new Uint8Array(SIZE * SIZE).fill(1);
    expect(takeRect(covered, 4, 4, SIZE)).toBeNull();
    expect(takeRect(new Uint8Array(SIZE * SIZE), SIZE, SIZE, SIZE)).toBeNull();
  });
});

describe("placing islands", () => {
  const specs: AdultReservoirSpec[] = [
    { id: "a", loop: [1, 2, 3], cap: [0], rings: 2 },
    { id: "b", loop: [4, 5, 6], cap: [1], rings: 2 },
  ];
  const sizes = {
    a: { circumference: 0.1, length: 0.2, cap: 0.02 },
    b: { circumference: 0.1, length: 0.2, cap: 0.02 },
  };
  const layers = { a: "penis-skin", b: "testes-skin" };
  // A metre of skin is 4 UV units here, so a 0.2 m wall is 0.05 of the grid.
  const scale = { a: 4, b: 4 };

  it("gives each an island of the size asked for, its wall's length along u and its circumference along v", () => {
    const placed = placeIslands(specs, sizes, layers, scale, new Uint8Array(SIZE * SIZE), SIZE);
    for (const r of placed) {
      expect(r.layer).toBe(layers[r.id as "a" | "b"]);
      const isle = r.island;
      if (!isle) throw new Error("no island");
      expect(isle.along[1]).toBe(0);
      expect(isle.across[0]).toBe(0);
      // 0.2 m / (4 m per UV unit) of the grid, to a texel.
      expect(isle.along[0] * SIZE).toBeCloseTo(Math.ceil((0.2 / 4) * SIZE), 6);
      expect(isle.across[1] * SIZE).toBeCloseTo(Math.ceil((0.1 / 4) * SIZE), 6);
      expect(isle.cap.radius * SIZE * 2).toBeCloseTo(Math.ceil(2 * (0.02 / 4) * SIZE), 6);
    }
    expect(placed[0]?.island?.origin).not.toEqual(placed[1]?.island?.origin);
  });

  it("is the same every time, and says so when there is no room or no size", () => {
    const once = placeIslands(specs, sizes, layers, scale, new Uint8Array(SIZE * SIZE), SIZE);
    const twice = placeIslands(specs, sizes, layers, scale, new Uint8Array(SIZE * SIZE), SIZE);
    expect(twice).toEqual(once);
    expect(() =>
      placeIslands(specs, sizes, layers, scale, new Uint8Array(SIZE * SIZE).fill(1), SIZE),
    ).toThrow(/no free UV space/);
    expect(() => placeIslands(specs, {}, layers, scale, new Uint8Array(SIZE * SIZE), SIZE)).toThrow(
      /no island size/,
    );
  });
});
