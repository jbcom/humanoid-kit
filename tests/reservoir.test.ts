import { describe, expect, it } from "vitest";
import { findDisc } from "../scripts/lib/detail/disc.ts";
import { pelvicRefinement } from "../scripts/lib/pelvicRegion.ts";
import {
  buildRefinedSurfaceMesh,
  evaluateSurface,
  type QuadSource,
  type Reservoir,
  type SurfaceMesh,
} from "../src/build/surfaceMesh.ts";
import { groupFaces } from "../src/format/assetFormat.ts";
import { applyStencil } from "../src/subdiv/catmullClark.ts";
import { loadFixtureAssets } from "./fixtures.ts";

/**
 * Reservoirs (docs/research/ADULT-SCULPT-PLAN.md, section 6b): collapsed strips
 * on the refined surface that detail targets extrude. At rest the surface must be
 * exactly the one without them, at every subdivision level, with nothing to draw
 * in the strips; extruded they must close into a watertight tube.
 */
const assets = loadFixtureAssets();
const source: QuadSource = { ...assets, vertexCount: assets.manifest.vertexCount };
const body = groupFaces(assets, "body");
const P = assets.positions;
const refinement = pelvicRefinement(assets);

const built = new Map<string, SurfaceMesh>();
const memo = (id: string, make: () => SurfaceMesh) => {
  let m = built.get(id);
  if (!m) {
    m = make();
    built.set(id, m);
  }
  return m;
};
const free = (level: number) =>
  memo(`free${level}`, () => buildRefinedSurfaceMesh(source, body, refinement, level));

/** A disc of the real lattice on the front of the pelvis, near the midline. */
function disc(radius: number, offsetY = 0) {
  const lattice = free(1).lattice as NonNullable<SurfaceMesh["lattice"]>;
  const all = applyStencil(lattice.stencil, P, new Float32Array(lattice.vertexCount * 3));
  const at = (v: number) =>
    [all[v * 3], all[v * 3 + 1], all[v * 3 + 2]] as [number, number, number];
  const front = Array.from(lattice.region).filter(
    (v) => Math.abs(at(v)[0]) < 0.002 && at(v)[2] > 0.05,
  );
  const ys = front.map((v) => at(v)[1]);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2 + offsetY;
  const nearest = front.reduce((best, v) =>
    Math.abs(at(v)[1] - y) < Math.abs(at(best)[1] - y) ? v : best,
  );
  return { ...findDisc(lattice.polygons, at, at(nearest), radius), at };
}

const reservoir = (rings = 3, radius = 0.012): Reservoir => {
  const { cap, loop } = disc(radius);
  return { cap, loop, rings };
};
const withReservoir = (level: number, rings = 3) =>
  memo(`res${level}-${rings}`, () =>
    buildRefinedSurfaceMesh(source, body, refinement, level, [reservoir(rings)]),
  );

const firstReservoir = (mesh: SurfaceMesh) => {
  const r = mesh.lattice?.reservoirs[0];
  if (!r) throw new Error("no reservoir on the surface");
  return r;
};

const evaluate = (mesh: SurfaceMesh, detail?: Parameters<typeof evaluateSurface>[5]) => {
  const n = mesh.renderToSurface.length;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  evaluateSurface(mesh, P, positions, normals, undefined, detail);
  return { positions, normals };
};

/** Triangles of a mesh as sorted vertex-position keys, skipping the degenerate ones. */
function triangles(mesh: SurfaceMesh, positions: Float32Array) {
  const key = (r: number) =>
    [0, 1, 2].map((k) => (positions[r * 3 + k] as number).toFixed(7)).join(",");
  const area = (a: number, b: number, c: number) => {
    const ux = (positions[b * 3] as number) - (positions[a * 3] as number);
    const uy = (positions[b * 3 + 1] as number) - (positions[a * 3 + 1] as number);
    const uz = (positions[b * 3 + 2] as number) - (positions[a * 3 + 2] as number);
    const vx = (positions[c * 3] as number) - (positions[a * 3] as number);
    const vy = (positions[c * 3 + 1] as number) - (positions[a * 3 + 1] as number);
    const vz = (positions[c * 3 + 2] as number) - (positions[a * 3 + 2] as number);
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  };
  const real: string[] = [];
  let degenerate = 0;
  let largestDegenerate = 0;
  for (let t = 0; t < mesh.index.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => mesh.index[t + k] as number) as [number, number, number];
    const m = area(a, b, c);
    if (m > 1e-12) real.push([key(a), key(b), key(c)].sort().join("|"));
    else {
      degenerate++;
      largestDegenerate = Math.max(largestDegenerate, m);
    }
  }
  return { real: real.sort(), degenerate, largestDegenerate };
}

describe("reservoirs on the refined surface", { timeout: 600_000 }, () => {
  it("finds a disc on the lattice, and refuses what is not one", () => {
    const d = disc(0.012);
    expect(d.cap.length).toBeGreaterThan(10);
    expect(d.loop.length).toBeGreaterThan(8);
    expect(new Set(d.loop).size).toBe(d.loop.length);
    expect(d.loop[0]).toBe(Math.min(...d.loop));
    // A disc needs a polygon's centre inside it: a point's neighbourhood alone has none.
    expect(() => disc(0.0001)).toThrow(/no polygon/);
    const lattice = free(1).lattice as NonNullable<SurfaceMesh["lattice"]>;
    expect(() => findDisc(lattice.polygons, d.at, [0, 5, 5], 0.001)).toThrow(/no polygon/);
  });

  for (const level of [1, 2]) {
    it(`at level ${level} is the surface without it at rest, with strips of no area`, () => {
      const plain = free(level);
      const mesh = withReservoir(level);
      const rest = evaluate(plain);
      const res = evaluate(mesh);
      const a = triangles(plain, rest.positions);
      const b = triangles(mesh, res.positions);
      // Every triangle with area is the plain surface's, none added, none lost.
      expect(b.real.length).toBe(a.real.length);
      for (let i = 0; i < a.real.length; i++)
        if (a.real[i] !== b.real[i]) throw new Error(`triangle ${i} differs`);
      // The strips are all there and all of no area (three rings of two triangles per chain edge).
      const chain = firstReservoir(mesh).chain;
      expect(b.degenerate - a.degenerate).toBe(chain * 3 * 2);
      expect(b.largestDegenerate).toBeLessThan(1e-12);
    });

    it(`at level ${level} shades every copy as the vertex it copies, finite and unit`, () => {
      const mesh = withReservoir(level);
      const res = evaluate(mesh);
      const byPosition = new Map<string, string>();
      for (let r = 0; r < res.positions.length / 3; r++) {
        const p = [0, 1, 2].map((k) => (res.positions[r * 3 + k] as number).toFixed(7)).join(",");
        const n = [0, 1, 2].map((k) => (res.normals[r * 3 + k] as number).toFixed(5)).join(",");
        const seen = byPosition.get(p);
        if (seen !== undefined && seen !== n)
          throw new Error(`two normals at ${p}: ${seen} and ${n}`);
        byPosition.set(p, n);
        expect(Math.hypot(...[0, 1, 2].map((k) => res.normals[r * 3 + k] as number))).toBeCloseTo(
          1,
          4,
        );
      }
      expect(res.positions.every(Number.isFinite)).toBe(true);
    });
  }

  it("keeps each control face's triangles together, the strips with the face that owns their edge", () => {
    const mesh = withReservoir(1);
    const plain = free(1);
    const starts = mesh.faceTriangles as Uint32Array;
    const was = plain.faceTriangles as Uint32Array;
    expect(starts.length).toBe(was.length);
    expect(starts[starts.length - 1]).toBe(mesh.index.length / 3);
    const chain = firstReservoir(mesh).chain;
    let extra = 0;
    let owners = 0;
    for (let f = 0; f + 1 < starts.length; f++) {
      const grew =
        (starts[f + 1] as number) -
        (starts[f] as number) -
        ((was[f + 1] as number) - (was[f] as number));
      expect(grew % 2).toBe(0);
      if (grew > 0) owners++;
      extra += grew;
    }
    expect(extra).toBe(chain * 3 * 2);
    // The strips belong to the faces along the cap's edge: not to one face, not to all.
    expect(owners).toBeGreaterThan(1);
    expect(owners).toBeLessThanOrEqual(chain);
  });

  it("extrudes into a watertight tube: the rings follow the pull and the cap rides on the last", () => {
    const mesh = withReservoir(1);
    const lattice = mesh.lattice as NonNullable<SurfaceMesh["lattice"]>;
    const r = lattice.reservoirs[0] as (typeof lattice.reservoirs)[number];
    const n = r.loop.length;
    const height = 0.03;
    // Ring j (1..3) moves j/3 of the way; the cap's own vertices move the full height.
    const d = disc(0.012);
    const capVertices = new Set<number>();
    const polygons = lattice.polygons;
    const capSet = new Set(d.cap);
    for (let i = 0; i + 1 < polygons.start.length; i++)
      if (capSet.has(polygons.id[i] as number))
        for (let c = polygons.start[i] as number; c < (polygons.start[i + 1] as number); c++)
          capVertices.add(polygons.vertices[c] as number);
    const indices: number[] = [];
    const xyz: number[] = [];
    for (let j = 1; j <= r.rings; j++)
      for (let i = 0; i < n; i++) {
        indices.push(r.base + (j - 1) * n + i);
        xyz.push(0, 0, (height * j) / r.rings);
      }
    const loop = new Set(r.loop);
    lattice.region.forEach((v, idx) => {
      if (capVertices.has(v) && !loop.has(v)) {
        indices.push(idx);
        xyz.push(0, 0, height);
      }
    });
    const at = evaluate(mesh, { indices, xyz: Float32Array.from(xyz) });
    const rest = evaluate(mesh);
    // The loop vertices themselves have not moved; the last ring has moved the full height.
    let moved = 0;
    for (let v = 0; v < at.positions.length; v += 3) {
      const dz = (at.positions[v + 2] as number) - (rest.positions[v + 2] as number);
      if (Math.abs(dz) > 1e-9) moved++;
      expect(dz).toBeLessThanOrEqual(height + 1e-6);
    }
    expect(moved).toBeGreaterThan(n * 3);
    // Every edge of the extruded surface is used at most twice, and the open border is the plain surface's.
    const use = (m: SurfaceMesh) => {
      const edges = new Map<number, number>();
      const s = (v: number) => m.renderToSurface[v] as number;
      const count = m.topology.vertexCount;
      for (let t = 0; t < m.index.length; t += 3) {
        const tri = [0, 1, 2].map((k) => s(m.index[t + k] as number));
        if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
        for (let k = 0; k < 3; k++) {
          const a = tri[k] as number;
          const b = tri[(k + 1) % 3] as number;
          const key = a < b ? a * count + b : b * count + a;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      return edges;
    };
    for (const c of use(mesh).values()) expect([1, 2]).toContain(c);
    const border = (m: SurfaceMesh) => [...use(m).values()].filter((c) => c === 1).length;
    expect(border(mesh)).toBe(border(free(1)));
    // The wall is no longer collapsed: the strips now have area.
    const tri = triangles(mesh, at.positions);
    expect(tri.degenerate).toBeLessThan(triangles(mesh, rest.positions).degenerate);
  });

  it("refuses caps that overlap, loops that share a vertex, and a loop that is not the cap's boundary", () => {
    const one = reservoir(2);
    const build = (...specs: Reservoir[]) =>
      buildRefinedSurfaceMesh(source, body, refinement, 1, specs);
    expect(() => build(one, one)).toThrow(/overlaps|shares/);
    expect(() => build({ ...one, loop: [...one.loop].reverse() })).toThrow(
      /not the cap's boundary/,
    );
    expect(() => build({ ...one, rings: 0 })).toThrow(/at least one ring/);
    expect(() => build({ ...one, cap: [] })).toThrow(/no faces/);
  });

  it("is the same surface with no reservoirs given", () => {
    const a = free(1);
    const b = buildRefinedSurfaceMesh(source, body, refinement, 1, []);
    expect(b.topology.vertexCount).toBe(a.topology.vertexCount);
    expect(Array.from(b.index)).toEqual(Array.from(a.index));
    expect(b.lattice?.detailCount).toBe(b.lattice?.region.length);
  });
});
