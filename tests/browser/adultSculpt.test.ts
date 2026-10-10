/**
 * The sculpted organ and sac as the renderer draws them: the posed, refined
 * positions the worker sends for an adult figure, measured as a ruler and a
 * hand would (docs/research/ADULT-SCULPT-PLAN.md, section 6d).
 *
 * A reservoir's wall lies on an island of its own in UV space, laid out by ring
 * along and by place round across (`src/build/reservoir.ts`), so each rendered
 * vertex's UV says where on the wall it is: that is how the shaft's rings and the
 * sac's skin are found among the surface's vertices, at any subdivision.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import adultManifest from "../../packs/adult-anatomy/data/manifest.json";
import type { AdultAnatomyManifest } from "../../src/format/assetFormat.ts";
import type { AdultSurfaceTopology } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { readSac } from "../sacShape.ts";
import { inlineWorkerClient } from "./inlineClient.ts";

type V3 = [number, number, number];
const manifest = adultManifest as unknown as AdultAnatomyManifest;
const reservoir = (id: string) => {
  const r = manifest.anatomy?.reservoirs?.find((x) => x.id === id);
  if (!r?.island) throw new Error(`no island for ${id}`);
  return { ...r, island: r.island };
};

const client = inlineWorkerClient({ subdivision: 1 }, { adultAnatomy: true });
let topology: AdultSurfaceTopology;
afterAll(() => client.dispose());
beforeAll(async () => {
  await client.complete;
  const t = await client.adultSurface();
  if (!t) throw new Error("no adult surface");
  topology = t;
}, 120_000);

/** A man of 30 with the organ and the sac at their default sizes (the pooled and European means). */
const man = createRecipe({
  macros: { age: 30, gender: 1 },
  modifiers: { "genitals/phallus-size": 0.65, "genitals/testes-size": 0.6 },
});

async function positionsOf(signals: Record<string, number> = {}): Promise<Float32Array> {
  const e = await client.evaluate(man, "sculpt", signals);
  if (e.surface !== "adult") throw new Error("the figure was not drawn on the adult surface");
  return e.positions;
}

const vertex = (p: Float32Array, v: number): V3 => [
  p[v * 3] as number,
  p[v * 3 + 1] as number,
  p[v * 3 + 2] as number,
];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** Each render vertex's place on a reservoir's wall: its ring (0 at the loop) and its share round, or null off the wall. */
function wallCoordinates(id: string): ({ ring: number; round: number } | null)[] {
  const { island, rings } = reservoir(id);
  const along = island.along;
  const across = island.across;
  const aa = along[0] * along[0] + along[1] * along[1];
  const cc = across[0] * across[0] + across[1] * across[1];
  const out: ({ ring: number; round: number } | null)[] = [];
  for (let v = 0; v < topology.vertexCount; v++) {
    const du = (topology.uvs[v * 2] as number) - island.origin[0];
    const dv = (topology.uvs[v * 2 + 1] as number) - island.origin[1];
    const ring = ((du * along[0] + dv * along[1]) / aa) * rings;
    const round = (du * across[0] + dv * across[1]) / cc;
    out.push(ring >= -1e-6 && ring <= rings + 1e-6 && round >= -1e-6 && round <= 1 + 1e-6 ? { ring, round } : null);
  }
  return out;
}

/** Whether a render vertex's UV is on a reservoir's cap disc. */
function onCap(id: string): boolean[] {
  const { island } = reservoir(id);
  const out: boolean[] = [];
  for (let v = 0; v < topology.vertexCount; v++) {
    const du = (topology.uvs[v * 2] as number) - island.cap.centre[0];
    const dv = (topology.uvs[v * 2 + 1] as number) - island.cap.centre[1];
    out.push(Math.hypot(du, dv) <= island.cap.radius + 1e-6);
  }
  return out;
}

/** The surface's triangles whose three corners pass `keep`. */
function triangles(keep: (v: number) => boolean): [number, number, number][] {
  const out: [number, number, number][] = [];
  const I = topology.index;
  for (let t = 0; t + 2 < I.length; t += 3) {
    const tri: [number, number, number] = [I[t] as number, I[t + 1] as number, I[t + 2] as number];
    if (tri.every(keep)) out.push(tri);
  }
  return out;
}

/** Where a level of a per-vertex value crosses the triangles: its length, and the centroid of the crossing. */
function isoLine(
  p: Float32Array,
  tris: readonly [number, number, number][],
  value: (v: number) => number,
  level: number,
): { length: number; centre: V3 } {
  let length = 0;
  const centre = [0, 0, 0];
  for (const tri of tris) {
    const ends: V3[] = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e] as number;
      const b = tri[(e + 1) % 3] as number;
      const fa = value(a) - level;
      const fb = value(b) - level;
      if (fa < 0 === fb < 0) continue;
      const t = fa / (fa - fb);
      const pa = vertex(p, a);
      const pb = vertex(p, b);
      ends.push([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t]);
    }
    if (ends.length !== 2) continue;
    const [e0, e1] = ends as [V3, V3];
    const l = len(sub(e1, e0));
    length += l;
    for (let k = 0; k < 3; k++)
      centre[k] = (centre[k] as number) + (((e0[k] as number) + (e1[k] as number)) / 2) * l;
  }
  const [cx, cy, cz] = centre as V3;
  return { length, centre: length > 0 ? [cx / length, cy / length, cz / length] : [cx, cy, cz] };
}

/** The length round the triangles where a plane cuts them, counting only within `reach` of `point`. */
function planeSection(
  p: Float32Array,
  tris: readonly [number, number, number][],
  point: V3,
  normal: V3,
  reach: number,
): number {
  let sum = 0;
  for (const tri of tris) {
    const ends: V3[] = [];
    for (let e = 0; e < 3; e++) {
      const pa = vertex(p, tri[e] as number);
      const pb = vertex(p, tri[(e + 1) % 3] as number);
      const fa = dot(sub(pa, point), normal);
      const fb = dot(sub(pb, point), normal);
      if (fa < 0 === fb < 0) continue;
      const t = fa / (fa - fb);
      ends.push([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t]);
    }
    if (ends.length !== 2) continue;
    const [e0, e1] = ends as [V3, V3];
    const mid: V3 = [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2, (e0[2] + e1[2]) / 2];
    if (len(sub(mid, point)) <= reach) sum += len(sub(e1, e0));
  }
  return sum;
}

describe("the shaft as drawn", { timeout: 300_000 }, () => {
  it("is 9.3 cm round at mid-shaft for the mean flaccid size (Veale 2015), within 5%", async () => {
    const p = await positionsOf();
    const wall = wallCoordinates("phallic");
    const R = reservoir("phallic").rings;
    const tris = triangles((v) => wall[v] !== null);
    const ringOf = (v: number) => (wall[v] as { ring: number }).ring;
    // The wall's rings as drawn: each ring's length round and its centre, at every step.
    const levels = Array.from({ length: R * 4 - 1 }, (_, i) => (i + 1) / 4);
    const lines = levels.map((level) => ({ level, ...isoLine(p, tris, ringOf, level) }));
    // The corona is the widest ring of the last 40%; the sulcus the narrowest behind it.
    const tail = lines.filter((l) => l.level >= 0.6 * R);
    const corona = tail.reduce((a, b) => (b.length > a.length ? b : a));
    const shaft = lines.filter((l) => l.level >= 0.4 * R && l.level < corona.level);
    const sulcus = shaft.reduce((a, b) => (b.length < a.length ? b : a));
    // Halfway along the centreline from ring 1 (the free shaft's start) to the sulcus.
    const path = lines.filter((l) => l.level >= 1 && l.level <= sulcus.level);
    const arc = [0];
    for (let i = 1; i < path.length; i++)
      arc.push((arc[i - 1] as number) + len(sub((path[i] as { centre: V3 }).centre, (path[i - 1] as { centre: V3 }).centre)));
    const half = (arc[arc.length - 1] as number) / 2;
    const i = arc.findIndex((a) => a >= half);
    const a = path[Math.max(0, i - 1)] as { centre: V3; length: number };
    const b = path[i] as { centre: V3 };
    const tangent = sub(b.centre, a.centre);
    const t = len(tangent);
    const girth = planeSection(
      p,
      tris,
      a.centre,
      [tangent[0] / t, tangent[1] / t, tangent[2] / t],
      (2 * a.length) / (2 * Math.PI),
    );
    expect(Math.abs(girth / 0.0931 - 1), `girth ${(girth * 100).toFixed(2)} cm`).toBeLessThan(0.05);
  });
});

describe("the sac as drawn", { timeout: 300_000 }, () => {
  it("is one connected skin surface, a disc joined to the body all round its loop", async () => {
    const p = await positionsOf();
    const wall = wallCoordinates("labioscrotal");
    const cap = onCap("labioscrotal");
    const onSac = (v: number) => wall[v] !== null || (cap[v] as boolean);
    // The wall, the cap and the skin round them meet at UV seams, where a surface vertex
    // is drawn as two render vertices evaluated alike: weld them by their exact position.
    const weld = new Map<string, number>();
    const welded = (v: number) => {
      const key = `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`;
      let id = weld.get(key);
      if (id === undefined) weld.set(key, (id = weld.size));
      return id;
    };
    const tris = triangles(onSac).map((t) => t.map(welded) as [number, number, number]);
    expect(tris.length).toBeGreaterThan(1000);
    // One piece: every triangle reached from the first through shared vertices.
    const byVertex = new Map<number, number[]>();
    tris.forEach((tri, i) => {
      for (const v of tri) {
        const list = byVertex.get(v) ?? [];
        list.push(i);
        byVertex.set(v, list);
      }
    });
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      const i = stack.pop() as number;
      for (const v of tris[i] as [number, number, number])
        for (const j of byVertex.get(v) ?? [])
          if (!seen.has(j)) {
            seen.add(j);
            stack.push(j);
          }
    }
    expect(seen.size).toBe(tris.length);
    // A disc: no edge shared by more than two triangles, Euler characteristic 1, and its
    // border all on the body's own skin (the sac continues the skin; it is not laid on it).
    const edges = new Map<string, number>();
    for (const [a, b, c] of tris)
      for (const [x, y] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        const key = x < y ? `${x},${y}` : `${y},${x}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    expect(Math.max(...edges.values())).toBe(2);
    expect(new Set(tris.flat()).size - edges.size + tris.length).toBe(1);
    const bodyVertices = new Set(
      triangles((v) => !onSac(v)).flatMap((t) => t.map(welded)),
    );
    const border = [...edges].filter(([, n]) => n === 1).flatMap(([k]) => k.split(",").map(Number));
    expect(border.length).toBeGreaterThan(0);
    for (const v of border) expect(bodyVertices.has(v), `border vertex ${v}`).toBe(true);
  });

  it("does not pass through itself or through the body: no two triangles cross", async () => {
    const p = await positionsOf();
    const wall = wallCoordinates("labioscrotal");
    const cap = onCap("labioscrotal");
    const onSac = (v: number) => wall[v] !== null || (cap[v] as boolean);
    const sac = triangles(onSac);
    // Everything near the sac: its own triangles and the body's within its reach.
    const pts = sac.flatMap((t) => t.map((v) => vertex(p, v)));
    const lo = [0, 1, 2].map((k) => Math.min(...pts.map((q) => q[k] as number)) - 0.01);
    const hi = [0, 1, 2].map((k) => Math.max(...pts.map((q) => q[k] as number)) + 0.01);
    const inBox = (v: number) => {
      const q = vertex(p, v);
      return q.every((x, k) => x >= (lo[k] as number) && x <= (hi[k] as number));
    };
    const near = triangles(inBox);
    const crossings = countCrossings(p, sac, near);
    expect(crossings, `${crossings} crossing pairs`).toBe(0);
  });

  it("reads as two lobes with a median raphe: the midline in behind both lobes at the front and above them at the bottom", async () => {
    const p = await positionsOf();
    const wall = wallCoordinates("labioscrotal");
    const cap = onCap("labioscrotal");
    const points: V3[] = [];
    for (let v = 0; v < topology.vertexCount; v++) if (wall[v] !== null || cap[v]) points.push(vertex(p, v));
    const read = readSac(points, 0);
    expect(read.front, `front ${(read.front * 1000).toFixed(1)} mm`).toBeGreaterThan(0.002);
    expect(read.bottom, `bottom ${(read.bottom * 1000).toFixed(1)} mm`).toBeGreaterThan(0.0003);
  });
});

/**
 * Pairs of triangles, one of `a` and one of `b`, that share no vertex and cross:
 * an edge of one passes through the other. A uniform grid finds the candidates.
 */
function countCrossings(
  p: Float32Array,
  a: readonly [number, number, number][],
  b: readonly [number, number, number][],
): number {
  const cell = 0.004;
  const grid = new Map<string, number[]>();
  /** The grid cells a triangle's bounding box covers. */
  const cells = (t: readonly number[]): string[] => {
    const q = t.map((v) => vertex(p, v));
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(...q.map((x) => x[k] as number)) / cell));
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(...q.map((x) => x[k] as number)) / cell));
    const out: string[] = [];
    for (let i0 = lo[0] as number; i0 <= (hi[0] as number); i0++)
      for (let j0 = lo[1] as number; j0 <= (hi[1] as number); j0++)
        for (let k0 = lo[2] as number; k0 <= (hi[2] as number); k0++) out.push(`${i0},${j0},${k0}`);
    return out;
  };
  b.forEach((t, i) => {
    for (const key of cells(t)) {
      const list = grid.get(key) ?? [];
      list.push(i);
      grid.set(key, list);
    }
  });
  const tested = new Set<string>();
  let count = 0;
  a.forEach((ta) => {
    const candidates = new Set<number>();
    for (const key of cells(ta)) for (const i of grid.get(key) ?? []) candidates.add(i);
    for (const i of candidates) {
      const tb = b[i] as [number, number, number];
      if (ta.some((v) => tb.includes(v))) continue;
      const key = [...ta, ...tb].sort((m, n) => m - n).join(",");
      if (tested.has(key)) continue;
      tested.add(key);
      const A = ta.map((v) => vertex(p, v)) as [V3, V3, V3];
      const B = tb.map((v) => vertex(p, v)) as [V3, V3, V3];
      if (edgesCross(A, B) || edgesCross(B, A)) count++;
    }
  });
  return count;
}

/** Whether an edge of triangle `e` passes through the interior of triangle `t` (Möller-Trumbore). */
function edgesCross(e: [V3, V3, V3], t: [V3, V3, V3]): boolean {
  const [t0, t1, t2] = t;
  const e1 = sub(t1, t0);
  const e2 = sub(t2, t0);
  for (let k = 0; k < 3; k++) {
    const o = e[k] as V3;
    const d = sub(e[(k + 1) % 3] as V3, o);
    const h: V3 = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-14) continue;
    const s = sub(o, t0);
    const u = dot(s, h) / det;
    if (u <= 1e-6 || u >= 1 - 1e-6) continue;
    const q: V3 = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = dot(d, q) / det;
    if (v <= 1e-6 || u + v >= 1 - 1e-6) continue;
    const w = dot(e2, q) / det;
    if (w > 1e-6 && w < 1 - 1e-6) return true;
  }
  return false;
}
