import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyStencil,
  catmullClarkLevel,
  composeStencils,
  type QuadTopology,
  type Stencil,
  subdivideUvLinear,
} from "../src/subdiv/catmullClark.ts";

/** Unit cube as 6 outward-wound quads. */
const cube: QuadTopology = {
  vertexCount: 8,
  faces: Uint32Array.from([0, 3, 2, 1, 4, 5, 6, 7, 0, 1, 5, 4, 1, 2, 6, 5, 2, 3, 7, 6, 3, 0, 4, 7]),
};
const cubePositions = Float32Array.from([
  -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
]);

/** n×n open grid of quads in the XY plane. */
function grid(n: number): { topo: QuadTopology; positions: Float32Array } {
  const faces: number[] = [];
  const positions: number[] = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) positions.push(x, y, 0);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x;
      faces.push(a, a + 1, a + n + 2, a + n + 1);
    }
  return {
    topo: { vertexCount: (n + 1) * (n + 1), faces: Uint32Array.from(faces) },
    positions: Float32Array.from(positions),
  };
}

const rowSums = (s: Stencil) => {
  const out: number[] = [];
  for (let i = 0; i + 1 < s.offsets.length; i++) {
    let t = 0;
    for (let k = s.offsets[i] as number; k < (s.offsets[i + 1] as number); k++)
      t += s.weights[k] as number;
    out.push(t);
  }
  return out;
};

describe("catmullClarkLevel", () => {
  it("produces 4 quads per quad and V+E+F vertices", () => {
    const { topology } = catmullClarkLevel(cube);
    expect(topology.faces.length).toBe(6 * 16);
    expect(topology.vertexCount).toBe(8 + 12 + 6);
  });

  it("is affine invariant: every stencil row sums to 1", () => {
    for (const t of [cube, grid(3).topo]) {
      for (const s of rowSums(catmullClarkLevel(t).stencil)) expect(s).toBeCloseTo(1, 6);
    }
  });

  it("moves a cube corner to the known Catmull–Clark position (5/9 of the way to the centre)", () => {
    const { stencil } = catmullClarkLevel(cube);
    const out = applyStencil(stencil, cubePositions, new Float32Array(26 * 3));
    // Valence-3 corner of a cube: (F + 2R + 0·P)/3 with F = 2/3·(±1), R = 2/3·(±1) per axis → 5/9.
    expect(out[0]).toBeCloseTo(-5 / 9, 5);
    expect(out[1]).toBeCloseTo(-5 / 9, 5);
    expect(out[2]).toBeCloseTo(-5 / 9, 5);
  });

  it("keeps an open grid planar and its corners fixed (crease rules on borders)", () => {
    const { topo, positions } = grid(4);
    const { stencil, topology } = catmullClarkLevel(topo);
    const out = applyStencil(stencil, positions, new Float32Array(topology.vertexCount * 3));
    for (let i = 0; i < topology.vertexCount; i++) expect(out[i * 3 + 2]).toBe(0);
    expect([out[0], out[1]]).toEqual([0, 0]);
    const last = 4 * 5 + 4;
    expect([out[last * 3], out[last * 3 + 1]]).toEqual([4, 4]);
  });

  it("is translation-equivariant for any translation", () => {
    const { stencil } = catmullClarkLevel(cube);
    fc.assert(
      fc.property(
        fc.float({ min: -100, max: 100, noNaN: true }),
        fc.float({ min: -100, max: 100, noNaN: true }),
        (dx, dy) => {
          const moved = cubePositions.map((p, i) => p + (i % 3 === 0 ? dx : i % 3 === 1 ? dy : 0));
          const a = applyStencil(stencil, cubePositions, new Float32Array(78));
          const b = applyStencil(stencil, Float32Array.from(moved), new Float32Array(78));
          for (let i = 0; i < 26; i++) {
            expect((b[i * 3] as number) - (a[i * 3] as number)).toBeCloseTo(dx, 3);
            expect((b[i * 3 + 1] as number) - (a[i * 3 + 1] as number)).toBeCloseTo(dy, 3);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("composeStencils", () => {
  it("equals applying the two levels in sequence", () => {
    const l1 = catmullClarkLevel(cube);
    const l2 = catmullClarkLevel(l1.topology);
    const composed = composeStencils(l1.stencil, l2.stencil);
    const step = applyStencil(
      l2.stencil,
      applyStencil(l1.stencil, cubePositions, new Float32Array(26 * 3)),
      new Float32Array(l2.topology.vertexCount * 3),
    );
    const direct = applyStencil(
      composed,
      cubePositions,
      new Float32Array(l2.topology.vertexCount * 3),
    );
    for (let i = 0; i < direct.length; i++) expect(direct[i]).toBeCloseTo(step[i] as number, 5);
  });
});

describe("subdivideUvLinear", () => {
  it("follows the same corner order as the position topology", () => {
    const { topo } = grid(1);
    const uvs = Float32Array.from([0, 0, 1, 0, 0, 1, 1, 1]);
    const faceUvs = Uint32Array.from([0, 1, 3, 2]);
    const sub = subdivideUvLinear(uvs, faceUvs);
    const pos = catmullClarkLevel(topo).topology;
    expect(sub.faceUvs.length).toBe(pos.faces.length);
    // Child 0 of face 0: corner, next-edge midpoint, face centre, previous-edge midpoint.
    const uv = (i: number) => [
      sub.uvs[(sub.faceUvs[i] as number) * 2],
      sub.uvs[(sub.faceUvs[i] as number) * 2 + 1],
    ];
    expect(uv(0)).toEqual([0, 0]);
    expect(uv(1)).toEqual([0.5, 0]);
    expect(uv(2)).toEqual([0.5, 0.5]);
    expect(uv(3)).toEqual([0, 0.5]);
  });
});
