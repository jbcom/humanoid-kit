import { describe, expect, it } from "vitest";
import { groupFaces } from "../src/format/assetFormat.ts";
import { type GradedSource, refineGraded } from "../src/subdiv/gradedRefine.ts";
import { loadFixtureAssets } from "./fixtures.ts";

/** A quad mesh with positions, so refined positions can be checked. */
type Src = GradedSource & { positions: Float32Array };

/** A W×H grid of quads on z = 0 (x right, y up), with one continuous UV layout. */
function grid(W: number, H: number, z = (_x: number, _y: number) => 0): Src {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let y = 0; y <= H; y++)
    for (let x = 0; x <= W; x++) {
      positions.push(x, y, z(x, y));
      uvs.push(x / W, y / H);
    }
  const vid = (x: number, y: number) => y * (W + 1) + x;
  const faces: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      faces.push(vid(x, y), vid(x + 1, y), vid(x + 1, y + 1), vid(x, y + 1));
  return {
    vertexCount: (W + 1) * (H + 1),
    faceVerts: Uint32Array.from(faces),
    faceUvs: Uint32Array.from(faces),
    uvs: Float32Array.from(uvs),
    positions: Float32Array.from(positions),
  };
}

const sizes = (m: { faceStart: Uint32Array }) => {
  const out: Record<number, number> = {};
  for (let f = 0; f + 1 < m.faceStart.length; f++) {
    const n = (m.faceStart[f + 1] as number) - (m.faceStart[f] as number);
    out[n] = (out[n] ?? 0) + 1;
  }
  return out;
};

/** How many faces each undirected edge belongs to. */
function edgeUse(m: { faceStart: Uint32Array; faces: Uint32Array }) {
  const use = new Map<string, number>();
  for (let f = 0; f + 1 < m.faceStart.length; f++) {
    const s = m.faceStart[f] as number;
    const n = (m.faceStart[f + 1] as number) - s;
    for (let k = 0; k < n; k++) {
      const a = m.faces[s + k] as number;
      const b = m.faces[s + ((k + 1) % n)] as number;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  return use;
}

/** Positions of the refined control vertices, from the base's through the stencil. */
function positionsOf(src: Src, stencil: ReturnType<typeof refineGraded>["stencil"]) {
  const n = stencil.offsets.length - 1;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++)
    for (let k = stencil.offsets[i] as number; k < (stencil.offsets[i + 1] as number); k++)
      for (let c = 0; c < 3; c++)
        out[i * 3 + c] =
          (out[i * 3 + c] as number) +
          (stencil.weights[k] as number) *
            (src.positions[(stencil.src[k] as number) * 3 + c] as number);
  return out;
}

/** Total area of the refined polygons, each fanned from its centroid. */
function area(m: { faceStart: Uint32Array; faces: Uint32Array }, p: Float64Array) {
  let total = 0;
  for (let f = 0; f + 1 < m.faceStart.length; f++) {
    const s = m.faceStart[f] as number;
    const n = (m.faceStart[f + 1] as number) - s;
    const c = [0, 1, 2].map(
      (k) =>
        Array.from({ length: n }, (_, i) => p[(m.faces[s + i] as number) * 3 + k] as number).reduce(
          (a, b) => a + b,
          0,
        ) / n,
    );
    for (let i = 0; i < n; i++) {
      const a = m.faces[s + i] as number;
      const b = m.faces[s + ((i + 1) % n)] as number;
      const u = [0, 1, 2].map((k) => (p[a * 3 + k] as number) - (c[k] as number));
      const v = [0, 1, 2].map((k) => (p[b * 3 + k] as number) - (c[k] as number));
      total +=
        0.5 *
        Math.hypot(
          (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
          (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
          (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
        );
    }
  }
  return total;
}

/** In a 6×6 grid: the face at (2, 2) at level 2, its eight neighbours at level 1. */
const RING = {
  faces: [14, 7, 8, 9, 13, 15, 19, 20, 21],
  levels: [2, 1, 1, 1, 1, 1, 1, 1, 1],
};

const all = (src: Src) => Uint32Array.from({ length: src.faceVerts.length / 4 }, (_, i) => i);

describe("graded refinement", () => {
  it("leaves a mesh with no refinement exactly as it is", () => {
    const src = grid(3, 3);
    const m = refineGraded(src, all(src), { faces: [], levels: [] });
    expect(m.vertexCount).toBe(src.vertexCount);
    expect(Array.from(m.faces)).toEqual(Array.from(src.faceVerts));
    expect(sizes(m)).toEqual({ 4: 9 });
    expect(Array.from(m.faceUvs)).toEqual(Array.from(src.faceUvs));
    // The stencil is the identity on the control vertices.
    expect(m.stencil.offsets.length - 1).toBe(src.vertexCount);
    for (let i = 0; i < src.vertexCount; i++) {
      expect((m.stencil.offsets[i + 1] as number) - (m.stencil.offsets[i] as number)).toBe(1);
      expect(m.stencil.src[m.stencil.offsets[i] as number]).toBe(i);
    }
  });

  it("splits a refined face into cells and leaves hanging points as its neighbours' polygon vertices", () => {
    const src = grid(3, 3);
    const centre = 4;
    const m = refineGraded(src, all(src), { faces: [centre], levels: [1] });
    // 9 faces, one of them four cells; the four edge neighbours gain a vertex each.
    expect(sizes(m)).toEqual({ 4: 8, 5: 4 });
    expect(m.vertexCount).toBe(src.vertexCount + 5); // 4 edge midpoints + the centre
  });

  it("is conforming: every edge is shared by two faces, or lies on the original border", () => {
    const src = grid(5, 5);
    const m = refineGraded(src, all(src), { faces: [12, 7, 11, 13, 17], levels: [2, 1, 1, 1, 1] });
    const use = edgeUse(m);
    let border = 0;
    for (const n of use.values()) {
      expect([1, 2]).toContain(n);
      if (n === 1) border++;
    }
    expect(border).toBe(20); // the 5×5 grid's border, none of it refined
  });

  it("covers the same surface: planar area is unchanged and every new vertex stays on the plane", () => {
    const src = grid(6, 6);
    const m = refineGraded(src, all(src), RING);
    const p = positionsOf(src, m.stencil);
    expect(area(m, p)).toBeCloseTo(36, 9);
    for (let v = 0; v < m.vertexCount; v++) expect(p[v * 3 + 2]).toBeCloseTo(0, 12);
  });

  it("places new vertices bilinearly on their base face, and the stencil is a partition of unity", () => {
    const src = grid(3, 3, (x, y) => 0.3 * x * y + 0.1 * x);
    const m = refineGraded(src, all(src), { faces: [4], levels: [1] });
    const p = positionsOf(src, m.stencil);
    // The face's interior point is the one new vertex made from all four corners.
    const centreVertex = Array.from(
      { length: m.vertexCount - src.vertexCount },
      (_, i) => src.vertexCount + i,
    ).find(
      (v) => (m.stencil.offsets[v + 1] as number) - (m.stencil.offsets[v] as number) === 4,
    ) as number;
    const f = 4;
    let mean = 0;
    for (let k = 0; k < 4; k++)
      mean += (src.positions[(src.faceVerts[f * 4 + k] as number) * 3 + 2] as number) / 4;
    expect(p[centreVertex * 3 + 2]).toBeCloseTo(mean, 6);
    for (let i = 0; i < m.vertexCount; i++) {
      let sum = 0;
      for (let k = m.stencil.offsets[i] as number; k < (m.stencil.offsets[i + 1] as number); k++) {
        expect(m.stencil.weights[k]).toBeGreaterThanOrEqual(0);
        sum += m.stencil.weights[k] as number;
      }
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("refuses a jump of more than one level between neighbouring faces", () => {
    const src = grid(3, 3);
    expect(() => refineGraded(src, all(src), { faces: [4], levels: [2] })).toThrow(/level/);
    expect(() => refineGraded(src, all(src), { faces: [4, 3], levels: [2, 0] })).toThrow(/level/);
    expect(() => refineGraded(src, all(src), { faces: [4], levels: [5] })).toThrow(/level/);
    expect(() => refineGraded(src, all(src), { faces: [99], levels: [1] })).toThrow(/face/);
  });

  it("grades through two rings with polygons of at most six sides", () => {
    const src = grid(7, 7);
    const core = [24];
    const ring1 = [16, 17, 18, 23, 25, 30, 31, 32];
    const m = refineGraded(src, all(src), {
      faces: [...core, ...ring1],
      levels: [2, ...ring1.map(() => 1)],
    });
    for (const n of Object.keys(sizes(m))) expect(Number(n)).toBeLessThanOrEqual(6);
    for (const n of edgeUse(m).values()) expect([1, 2]).toContain(n);
  });

  it("keeps a UV seam a seam: refined points on it carry each side's own UV", () => {
    // Two quads sharing an edge, with different UVs on each side of it.
    const src: Src = {
      vertexCount: 6,
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0]),
      faceVerts: Uint32Array.from([0, 1, 4, 3, 1, 2, 5, 4]),
      // Face B's edge on the seam is at u = 0.6, face A's at 0.5: the shared vertices 1 and 4 have two UVs.
      uvs: Float32Array.from([0, 0, 0.5, 0, 0.5, 1, 0, 1, 0.6, 0, 1, 0, 1, 1, 0.6, 1]),
      faceUvs: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
    };
    const m = refineGraded(src, Uint32Array.from([0, 1]), { faces: [0, 1], levels: [1, 1] });
    const p = positionsOf(src, m.stencil);
    // The control midpoint of the shared edge (1,4) exists once ...
    const mids = Array.from({ length: m.vertexCount }, (_, v) => v).filter(
      (v) =>
        Math.abs((p[v * 3] as number) - 1) < 1e-9 &&
        Math.abs((p[v * 3 + 1] as number) - 0.5) < 1e-9,
    );
    expect(mids.length).toBe(1);
    // ... but is met by two UV points, one per face: u = 0.5 on face A's side, 0.6 on B's.
    const uvAt = (face: number) => {
      const s = m.faceStart[face] as number;
      const e = m.faceStart[face + 1] as number;
      for (let i = s; i < e; i++)
        if (m.faces[i] === mids[0]) return m.uvs[(m.faceUvs[i] as number) * 2] as number;
      return Number.NaN;
    };
    const uA = new Set<number>();
    const uB = new Set<number>();
    for (let f = 0; f < 4; f++) {
      const u = uvAt(f);
      if (!Number.isNaN(u)) uA.add(Number(u.toFixed(6)));
    }
    for (let f = 4; f < 8; f++) {
      const u = uvAt(f);
      if (!Number.isNaN(u)) uB.add(Number(u.toFixed(6)));
    }
    expect([...uA]).toEqual([0.5]);
    expect([...uB]).toEqual([0.6]);
  });

  it("is deterministic: the same input gives the same mesh, new vertices appended in a fixed order", () => {
    const src = grid(6, 6);
    const a = refineGraded(src, all(src), RING);
    const b = refineGraded(src, all(src), RING);
    expect(Array.from(a.faces)).toEqual(Array.from(b.faces));
    expect(Array.from(a.faceUvs)).toEqual(Array.from(b.faceUvs));
    expect(Array.from(a.stencil.weights)).toEqual(Array.from(b.stencil.weights));
  });

  it("refines the real body's pelvic faces without cracks and keeps its border", () => {
    const assets = loadFixtureAssets();
    const body = groupFaces(assets, "body");
    const P = assets.positions;
    const centroid = (f: number) =>
      [0, 1, 2].map(
        (k) =>
          [0, 1, 2, 3].reduce(
            (s, i) => s + (P[(assets.faceVerts[f * 4 + i] as number) * 3 + k] as number),
            0,
          ) / 4,
      ) as [number, number, number];
    const core = Array.from(body).filter((f) => {
      const [x, y, z] = centroid(f);
      return Math.abs(x) < 0.04 && y > -0.1 && y < 0.02 && z > 0.02;
    });
    expect(core.length).toBeGreaterThan(8);
    const coreSet = new Set(core);
    const vertsOfCore = new Set(
      core.flatMap((f) => [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number)),
    );
    const ring = Array.from(body).filter(
      (f) =>
        !coreSet.has(f) &&
        [0, 1, 2, 3].some((k) => vertsOfCore.has(assets.faceVerts[f * 4 + k] as number)),
    );
    const m = refineGraded({ ...assets, vertexCount: assets.manifest.vertexCount }, body, {
      faces: [...core, ...ring],
      levels: [...core.map(() => 2), ...ring.map(() => 1)],
    });
    const baseUse = edgeUse({
      faceStart: Uint32Array.from({ length: body.length + 1 }, (_, i) => i * 4),
      faces: Uint32Array.from(
        Array.from(body).flatMap((f) =>
          [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number),
        ),
      ),
    });
    const baseBorder = [...baseUse.values()].filter((n) => n === 1).length;
    const use = edgeUse(m);
    expect([...use.values()].every((n) => n === 1 || n === 2)).toBe(true);
    expect([...use.values()].filter((n) => n === 1).length).toBe(baseBorder);
    expect(m.vertexCount).toBeGreaterThan(assets.manifest.vertexCount + 500);
  });
});
