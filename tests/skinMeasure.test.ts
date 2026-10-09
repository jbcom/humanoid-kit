import { describe, expect, it } from "vitest";
import { girthRatios, meshVolume, sliceLoops } from "../scripts/lib/skinMeasure.ts";

/** A closed prism of `sides` sides, radius `r`, from y = 0 to y = h, as outward triangles. */
function prism(sides: number, r: number, h: number) {
  const positions: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    positions.push(r * Math.cos(a), 0, r * Math.sin(a));
  }
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    positions.push(r * Math.cos(a), h, r * Math.sin(a));
  }
  positions.push(0, 0, 0, 0, h, 0);
  const bottom = sides * 2;
  const top = bottom + 1;
  const tris: number[] = [];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    tris.push(i, sides + i, sides + j, i, sides + j, j);
    tris.push(bottom, i, j);
    tris.push(top, sides + j, sides + i);
  }
  return { positions: Float32Array.from(positions), tris: Uint32Array.from(tris) };
}

describe("meshVolume", () => {
  it("is the enclosed volume of a closed outward-wound mesh", () => {
    const { positions, tris } = prism(64, 1, 2);
    const expected = 0.5 * 64 * Math.sin((Math.PI * 2) / 64) * 2;
    expect(meshVolume(positions, tris)).toBeCloseTo(expected, 4);
  });

  it("does not depend on where the mesh sits", () => {
    const { positions, tris } = prism(16, 1, 1);
    const moved = positions.map((v, i) => v + (i % 3 === 0 ? 5 : i % 3 === 1 ? -3 : 2));
    expect(meshVolume(moved, tris)).toBeCloseTo(meshVolume(positions, tris), 3);
  });
});

describe("sliceLoops", () => {
  it("measures the cross-section of a prism, whatever the plane's tilt", () => {
    const { positions, tris } = prism(64, 1, 4);
    const ring = 0.5 * 64 * Math.sin((Math.PI * 2) / 64);
    const flat = sliceLoops(positions, tris, [0, 2, 0], [0, 1, 0]);
    expect(flat).toHaveLength(1);
    expect(flat[0]?.area).toBeCloseTo(ring, 4);
    // A plane tilted by 45° cuts an ellipse of area ring / cos 45°.
    const s = Math.SQRT1_2;
    const tilted = sliceLoops(positions, tris, [0, 2, 0], [0, s, s]);
    expect(tilted[0]?.area).toBeCloseTo(ring / s, 3);
  });

  it("reports each loop's centre so a caller can pick the one at a joint", () => {
    const a = prism(16, 1, 4);
    const b = prism(16, 1, 4);
    const shift = 10;
    const both = {
      positions: Float32Array.from([
        ...a.positions,
        ...b.positions.map((v, i) => (i % 3 === 0 ? v + shift : v)),
      ]),
      tris: Uint32Array.from([...a.tris, ...b.tris.map((i) => i + a.positions.length / 3)]),
    };
    const loops = sliceLoops(both.positions, both.tris, [0, 2, 0], [0, 1, 0]);
    expect(loops).toHaveLength(2);
    const xs = loops.map((l) => l.centroid[0]).sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(0, 5);
    expect(xs[1]).toBeCloseTo(shift, 5);
  });

  it("finds nothing where the plane misses the mesh", () => {
    const { positions, tris } = prism(8, 1, 1);
    expect(sliceLoops(positions, tris, [0, 5, 0], [0, 1, 0])).toEqual([]);
  });
});

describe("girthRatios", () => {
  /** Four points around the y axis at height 0.5, radius 1. */
  const ring = Float32Array.from([1, 0.5, 0, -1, 0.5, 0, 0, 0.5, 1, 0, 0.5, -1]);
  const line = [
    [0, 0, 0],
    [0, 1, 0],
  ] as const;

  it("is 1 where the body keeps its distance from the limb's centreline", () => {
    expect(girthRatios(ring, ring, [0, 1, 2, 3], line, line)).toEqual([1, 1, 1, 1]);
  });

  it("falls with the distance to the centreline: a pinch is below 1, a bulge above", () => {
    const pinched = ring.map((v, i) => (i % 3 === 1 ? v : v * 0.25));
    const bulged = ring.map((v, i) => (i % 3 === 1 ? v : v * 1.5));
    expect(girthRatios(ring, pinched, [0, 1], line, line)).toEqual([0.25, 0.25]);
    expect(girthRatios(ring, bulged, [2], line, line)).toEqual([1.5]);
  });

  it("measures against the posed centreline, however the limb has moved", () => {
    const moved = ring.map((v, i) => (i % 3 === 0 ? v + 4 : v));
    const posedLine = [
      [4, 0, 0],
      [4, 1, 0],
    ] as const;
    expect(girthRatios(ring, moved, [0, 1, 2, 3], line, posedLine)).toEqual([1, 1, 1, 1]);
  });

  it("measures to the nearest segment of a bent centreline", () => {
    const bent = [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ] as const;
    // (0.5, 1.5, 0) is 0.5 from the second segment (0.71 from the first's end);
    // (0.5, 2, 0) is 1 from it: the ratio is 2 only if the nearest segment is used.
    const p = Float32Array.from([0.5, 1.5, 0]);
    const q = Float32Array.from([0.5, 2, 0]);
    expect(girthRatios(p, q, [0], bent, bent)).toEqual([2]);
  });
});
