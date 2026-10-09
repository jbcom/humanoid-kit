import { describe, expect, it } from "vitest";
import { meanCurvature, triangleEdges } from "../src/build/curvature.ts";

/** A UV sphere of radius r with exact outward normals. */
function sphere(r: number, rings = 24, segments = 48) {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const theta = (i / rings) * Math.PI;
    for (let j = 0; j < segments; j++) {
      const phi = (j / segments) * 2 * Math.PI;
      const n = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      normals.push(...n);
      positions.push(...n.map((c) => c * r));
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j;
      const b = i * segments + ((j + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      index.push(a, c, b, b, c, d);
    }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    index: Uint32Array.from(index),
  };
}

describe("meanCurvature", () => {
  it("measures 1/r on a sphere, whatever its size", () => {
    for (const r of [0.003, 0.025, 0.06]) {
      const s = sphere(r);
      const k = meanCurvature(
        s.positions,
        s.normals,
        triangleEdges(s.index),
        new Float32Array(s.positions.length / 3),
      );
      // Away from the poles, where the UV sphere's edges are regular.
      const equator = Array.from(k.slice(12 * 48, 13 * 48));
      for (const v of equator) expect(Math.abs(v * r - 1)).toBeLessThan(0.05);
    }
  });

  it("is zero on a plane and clamped at the maximum", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const edges = triangleEdges(new Uint32Array([0, 1, 2]));
    expect(Array.from(meanCurvature(positions, normals, edges, new Float32Array(3)))).toEqual([
      0, 0, 0,
    ]);
    const tiny = sphere(0.0001);
    const k = meanCurvature(
      tiny.positions,
      tiny.normals,
      triangleEdges(tiny.index),
      new Float32Array(tiny.positions.length / 3),
      1000,
    );
    expect(Math.max(...k)).toBe(1000);
  });

  it("lists each undirected edge once", () => {
    // Two triangles sharing an edge: 5 unique edges.
    expect(triangleEdges(new Uint32Array([0, 1, 2, 2, 1, 3])).length / 2).toBe(5);
  });
});
