import { describe, expect, it } from "vitest";
import { bodyCoverage, placeIslands, takeRect } from "../scripts/lib/uvIslands.ts";
import type { AdultReservoirSpec } from "../src/format/assetFormat.ts";

/** Free UV space for the reservoirs' islands (scripts/lib/uvIslands.ts), on a small grid. */
const SIZE = 64;
const triangle = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => ({
  uvs: Float32Array.of(x0, y0, x1, y1, x2, y2),
  index: Uint32Array.of(0, 1, 2),
});

describe("the body's coverage of UV space", () => {
  it("marks a triangle and a gutter round it, and nothing far from it", () => {
    const t = triangle(0.5, 0.5, 0.75, 0.5, 0.5, 0.75);
    const covered = bodyCoverage(t.uvs, t.index, SIZE);
    const at = (u: number, v: number) =>
      covered[Math.floor(v * SIZE) * SIZE + Math.floor(u * SIZE)];
    expect(at(0.55, 0.55)).toBe(1);
    // Just outside an edge, within the gutter.
    expect(at(0.5 - 3 / SIZE, 0.55)).toBe(1);
    expect(at(0.05, 0.05)).toBe(0);
    expect(at(0.95, 0.95)).toBe(0);
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
