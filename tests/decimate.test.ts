import { describe, expect, it } from "vitest";
import { decimate } from "../src/bake/decimate.ts";

/** An n × m grid in the x-z plane over [0, 1] × [0, m/n], wound to face +y. */
function grid(n: number, m: number, lift: (x: number, z: number) => number = () => 0) {
  const positions: number[] = [];
  for (let j = 0; j <= m; j++)
    for (let i = 0; i <= n; i++) positions.push(i / n, lift(i / n, j / n), j / n);
  const index: number[] = [];
  const at = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < m; j++)
    for (let i = 0; i < n; i++) {
      index.push(at(i, j), at(i, j + 1), at(i + 1, j));
      index.push(at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
    }
  return { positions: Float32Array.from(positions), index: Uint32Array.from(index) };
}

/** A UV sphere: closed, every edge on two triangles. */
function sphere(rings: number, segments: number) {
  const positions: number[] = [0, 1, 0];
  for (let r = 1; r < rings; r++) {
    const phi = (Math.PI * r) / rings;
    for (let s = 0; s < segments; s++) {
      const th = (2 * Math.PI * s) / segments;
      positions.push(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
    }
  }
  positions.push(0, -1, 0);
  const south = positions.length / 3 - 1;
  const at = (r: number, s: number) => 1 + (r - 1) * segments + (s % segments);
  const index: number[] = [];
  for (let s = 0; s < segments; s++) index.push(0, at(1, s + 1), at(1, s));
  for (let r = 1; r < rings - 1; r++)
    for (let s = 0; s < segments; s++) {
      index.push(at(r, s), at(r, s + 1), at(r + 1, s));
      index.push(at(r, s + 1), at(r + 1, s + 1), at(r + 1, s));
    }
  for (let s = 0; s < segments; s++) index.push(south, at(rings - 1, s), at(rings - 1, s + 1));
  return { positions: Float32Array.from(positions), index: Uint32Array.from(index) };
}

const verticesOf = (index: Uint32Array) => new Set(index);

const faceNormalY = (p: Float32Array, index: Uint32Array, t: number) => {
  const [a, b, c] = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]].map(
    (v) => (v as number) * 3,
  ) as [number, number, number];
  const ux = (p[b] as number) - (p[a] as number);
  const uz = (p[b + 2] as number) - (p[a + 2] as number);
  const vx = (p[c] as number) - (p[a] as number);
  const vz = (p[c + 2] as number) - (p[a + 2] as number);
  return uz * vx - ux * vz;
};

describe("multi-pose half-edge decimation", () => {
  it("meets each target with a nested subset of the vertices", () => {
    const g = grid(20, 20);
    const [near, far] = decimate({ frames: [g.positions], index: g.index, targets: [200, 50] });
    if (!near || !far) throw new Error("two levels");
    expect(near.index.length / 3).toBeLessThanOrEqual(200);
    expect(far.index.length / 3).toBeLessThanOrEqual(50);
    expect(far.index.length / 3).toBeGreaterThan(10);
    const nearVerts = verticesOf(near.index);
    for (const v of verticesOf(far.index)) expect(nearVerts.has(v)).toBe(true);
    // Every removed vertex is owned by a vertex that remains at its level.
    for (const level of [near, far]) {
      const kept = verticesOf(level.index);
      for (const o of level.owner) expect(kept.has(o) || !g.index.includes(o)).toBe(true);
    }
  });

  it("keeps the border where it is: the corners and a flat sheet's facing", () => {
    const g = grid(16, 16);
    const [level] = decimate({ frames: [g.positions], index: g.index, targets: [40] });
    if (!level) throw new Error("one level");
    const kept = verticesOf(level.index);
    for (const corner of [0, 16, 16 * 17, 17 * 17 - 1]) expect(kept.has(corner)).toBe(true);
    for (let t = 0; t < level.index.length / 3; t++)
      expect(faceNormalY(g.positions, level.index, t)).toBeGreaterThan(0);
  });

  it("keeps a closed surface closed: every edge on exactly two triangles", () => {
    const s = sphere(16, 24);
    const [level] = decimate({ frames: [s.positions], index: s.index, targets: [120] });
    if (!level) throw new Error("one level");
    expect(level.index.length / 3).toBeLessThanOrEqual(120);
    const edges = new Map<string, number>();
    for (let t = 0; t < level.index.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = level.index[t + k] as number;
        const b = level.index[t + ((k + 1) % 3)] as number;
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    for (const n of edges.values()) expect(n).toBe(2);
  });

  it("keeps a crease that only one pose shows", () => {
    // Flat at rest; folded along x = 0.5 in the second frame.
    const flat = grid(20, 4);
    const folded = grid(20, 4, (x) => Math.abs(x - 0.5));
    const crease = (index: Uint32Array) =>
      [...verticesOf(index)].filter((v) => Math.abs((flat.positions[v * 3] as number) - 0.5) < 1e-6)
        .length;
    const restOnly = decimate({ frames: [flat.positions], index: flat.index, targets: [12] })[0];
    const bothPoses = decimate({
      frames: [flat.positions, folded.positions],
      index: flat.index,
      targets: [12],
    })[0];
    if (!restOnly || !bothPoses) throw new Error("levels");
    expect(crease(bothPoses.index)).toBeGreaterThanOrEqual(2);
    expect(crease(bothPoses.index)).toBeGreaterThan(crease(restOnly.index));
  });

  it("spends its triangles where importance asks", () => {
    const g = grid(20, 20);
    const importance = new Float32Array(21 * 21).fill(1);
    // The patch round the middle is precious.
    const precious = [10 * 21 + 10, 10 * 21 + 9, 9 * 21 + 10, 11 * 21 + 10, 10 * 21 + 11];
    for (const v of precious) importance[v] = 1e9;
    // A gentle dome, so removing any vertex costs something.
    const dome = grid(20, 20, (x, z) => 0.3 * Math.sin(Math.PI * x) * Math.sin(Math.PI * z));
    const [level] = decimate({
      frames: [dome.positions],
      index: dome.index,
      importance,
      targets: [60],
    });
    if (!level) throw new Error("one level");
    const kept = verticesOf(level.index);
    for (const v of precious) expect(kept.has(v)).toBe(true);
    expect(g.index.length).toBe(800 * 3);
  });

  it("never folds a closed tetrahedron (the last of a small closed part) flat", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const index = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
    const [level] = decimate({ frames: [positions], index, targets: [1] });
    expect(level?.index.length).toBe(12);
  });

  it("is deterministic", () => {
    const s = sphere(12, 16);
    const a = decimate({ frames: [s.positions], index: s.index, targets: [100, 40] });
    const b = decimate({ frames: [s.positions], index: s.index, targets: [100, 40] });
    expect(a.map((l) => [...l.index])).toEqual(b.map((l) => [...l.index]));
  });

  it("records a target the input already meets, and refuses bad input", () => {
    const g = grid(2, 2);
    const [level] = decimate({ frames: [g.positions], index: g.index, targets: [100] });
    expect(level?.index).toEqual(g.index);
    expect(() => decimate({ frames: [], index: g.index, targets: [1] })).toThrow(/frame/);
    expect(() =>
      decimate({ frames: [g.positions, new Float32Array(3)], index: g.index, targets: [1] }),
    ).toThrow(/same vertex count/);
    expect(() => decimate({ frames: [g.positions], index: g.index, targets: [1, 2] })).toThrow(
      /largest first/,
    );
  });
});
