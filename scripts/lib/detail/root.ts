/**
 * A reservoir as detail targets address it (`src/build/reservoir.ts`): the rest
 * positions of its loop and of the cap's interior vertices, and the detail index
 * of every vertex a target may move. Shared by the generators that draw a shape
 * out of a reservoir (`phallus.ts`, `scrotum.ts`).
 *
 * A detail target lists the cap's interior vertices (indices of the refined
 * region, which come first) and then each ring's vertices (ring 1, loop position
 * 0 to n - 1, then ring 2, and so on). `RootShape` keeps that order: a shape is
 * one position per such vertex, and a target is the difference of two shapes.
 */
import type { AdultReservoirSpec } from "../../../src/format/assetFormat.ts";
import type { AdultDetailLattice } from "../../../src/model/humanoidModel.ts";
import type { Vec3 } from "./disc.ts";
import type { SculptPart } from "./sculpt.ts";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

export interface ReservoirRoot {
  id: string;
  rings: number;
  /** Detail index of ring 1, loop position 0. */
  base: number;
  /** Rest positions of the loop's vertices, in the spec's order, metres. */
  loop: readonly Vec3[];
  /** The cap's interior vertices, by ascending detail index. */
  cap: readonly { index: number; position: Vec3 }[];
  /**
   * The cap's polygons, each corner either a loop vertex (`loop`: its place in `loop`)
   * or an interior one (`cap`: its place in `cap`), in the lattice's winding.
   */
  capPolygons: readonly (readonly ({ loop: number } | { cap: number })[])[];
  /** Unit outward normal of the skin over the root. */
  normal: Vec3;
  /** Mean of the loop. */
  centre: Vec3;
}

/** One position per vertex a target of this root may move: the cap's, then each ring's. */
export type RootShape = readonly Vec3[];

/** The root of one reservoir on the lattice the pack's targets are authored against. */
export function reservoirRoot(
  lattice: AdultDetailLattice,
  spec: AdultReservoirSpec,
): ReservoirRoot {
  const info = lattice.reservoirs.find((r) => r.id === spec.id);
  if (!info) throw new Error(`the lattice has no reservoir ${spec.id}`);
  const region = new Map<number, number>();
  lattice.regionIds.forEach((id, i) => {
    region.set(id, i);
  });
  const at = (r: number): Vec3 => [
    lattice.positions[r * 3] as number,
    lattice.positions[r * 3 + 1] as number,
    lattice.positions[r * 3 + 2] as number,
  ];
  const regionOf = (v: number) => {
    const r = region.get(v);
    if (r === undefined) throw new Error(`reservoir ${spec.id}: vertex ${v} is not in the region`);
    return r;
  };
  const loopRegion = spec.loop.map(regionOf);
  const inLoop = new Set(spec.loop);
  const poly = lattice.polygons;
  const cap = new Set(spec.cap);
  const interior = new Set<number>();
  for (let i = 0; i + 1 < poly.start.length; i++) {
    if (!cap.has(poly.id[i] as number)) continue;
    for (let c = poly.start[i] as number; c < (poly.start[i + 1] as number); c++) {
      const v = poly.vertices[c] as number;
      if (!inLoop.has(v)) interior.add(regionOf(v));
    }
  }
  const centre = [0, 0, 0] as [number, number, number];
  const sum = [0, 0, 0] as [number, number, number];
  for (const r of loopRegion) {
    const p = at(r);
    for (const k of [0, 1, 2] as const) {
      centre[k] += p[k] / loopRegion.length;
      sum[k] += lattice.normals[r * 3 + k] as number;
    }
  }
  const length = Math.hypot(...sum);
  const capIndices = [...interior].sort((a, b) => a - b);
  const capPlace = new Map(capIndices.map((r, j) => [r, j]));
  const loopPlace = new Map(spec.loop.map((v, i) => [v, i]));
  const capPolygons: ({ loop: number } | { cap: number })[][] = [];
  for (let i = 0; i + 1 < poly.start.length; i++) {
    if (!cap.has(poly.id[i] as number)) continue;
    const corners: ({ loop: number } | { cap: number })[] = [];
    for (let c = poly.start[i] as number; c < (poly.start[i + 1] as number); c++) {
      const v = poly.vertices[c] as number;
      const l = loopPlace.get(v);
      corners.push(l !== undefined ? { loop: l } : { cap: capPlace.get(regionOf(v)) as number });
    }
    capPolygons.push(corners);
  }
  return {
    id: spec.id,
    rings: info.rings,
    base: info.base,
    loop: loopRegion.map(at),
    cap: capIndices.map((index) => ({ index, position: at(index) })),
    capPolygons,
    normal: [sum[0] / length, sum[1] / length, sum[2] / length],
    centre,
  };
}

/** Detail index of ring `ring` (1 to rings), loop position `i`. */
export const ringIndex = (root: ReservoirRoot, ring: number, i: number): number =>
  root.base + (ring - 1) * root.loop.length + i;

/** The detail indices a target of this root may move, ascending, in `RootShape` order. */
export function rootIndices(root: ReservoirRoot): number[] {
  const out = root.cap.map((c) => c.index);
  for (let j = 1; j <= root.rings; j++)
    for (let i = 0; i < root.loop.length; i++) out.push(ringIndex(root, j, i));
  return out;
}

/** The shape at rest: the cap where it is, every ring on its loop. */
export function restShape(root: ReservoirRoot): RootShape {
  const out: Vec3[] = root.cap.map((c) => c.position);
  for (let j = 1; j <= root.rings; j++) out.push(...root.loop);
  return out;
}

/**
 * The target that takes shape `from` to shape `to`, over the vertices that move
 * by more than `epsilon` metres. A vertex that does not move is left out so the
 * target stays sparse.
 */
export function shapeDifference(
  root: ReservoirRoot,
  from: RootShape,
  to: RootShape,
  epsilon = 2e-6,
): { indices: number[]; xyz: number[] } {
  const all = rootIndices(root);
  if (from.length !== all.length || to.length !== all.length)
    throw new Error(`reservoir ${root.id}: a shape has the wrong number of vertices`);
  const indices: number[] = [];
  const xyz: number[] = [];
  all.forEach((index, k) => {
    const a = from[k] as Vec3;
    const b = to[k] as Vec3;
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    if (Math.hypot(...d) <= epsilon) return;
    indices.push(index);
    xyz.push(...d);
  });
  return { indices, xyz };
}

/** A reservoir's cap as a surface (the skin it covers at rest): the loop's vertices, then the interior's, its polygons fanned into triangles. */
export function capSurface(root: ReservoirRoot): SculptPart {
  const n = root.loop.length;
  const positions = new Float64Array((n + root.cap.length) * 3);
  root.loop.forEach((p, i) => {
    positions.set(p, i * 3);
  });
  root.cap.forEach((c, j) => {
    positions.set(c.position, (n + j) * 3);
  });
  const index = (corner: { loop: number } | { cap: number }) =>
    "loop" in corner ? corner.loop : n + corner.cap;
  const triangles: number[] = [];
  for (const poly of root.capPolygons)
    for (let k = 1; k + 1 < poly.length; k++)
      triangles.push(
        index(poly[0] as { loop: number } | { cap: number }),
        index(poly[k] as { loop: number } | { cap: number }),
        index(poly[k + 1] as { loop: number } | { cap: number }),
      );
  return {
    positions,
    triangles: Uint32Array.from(triangles),
    boundary: root.loop.map((_, i) => i),
  };
}

/**
 * The point of a surface nearest `p` (by its triangles; a cap is a few hundred), and
 * the unit normal of the triangle it is on, turned to the side `up` points to.
 */
export function nearestOnSurface(
  surface: SculptPart,
  p: Vec3,
  up: Vec3,
): { point: Vec3; normal: Vec3 } {
  const P = surface.positions;
  const T = surface.triangles;
  const at = (v: number): Vec3 => [
    P[v * 3] as number,
    P[v * 3 + 1] as number,
    P[v * 3 + 2] as number,
  ];
  let best = 0;
  let point: Vec3 = at(T[0] as number);
  let far = Number.POSITIVE_INFINITY;
  for (let t = 0; t < T.length; t += 3) {
    const q = closestOnTriangle(
      p,
      at(T[t] as number),
      at(T[t + 1] as number),
      at(T[t + 2] as number),
    );
    const d = len(sub(q, p));
    if (d < far) {
      far = d;
      point = q;
      best = t;
    }
  }
  const a = at(T[best] as number);
  const n = cross(sub(at(T[best + 1] as number), a), sub(at(T[best + 2] as number), a));
  const l = len(n) * Math.sign(dot(n, up));
  return { point, normal: [n[0] / l, n[1] / l, n[2] / l] };
}

/** The point of triangle abc nearest p (Ericson, "Real-Time Collision Detection", 5.1.5). */
function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const along = (o: Vec3, d: Vec3, t: number): Vec3 => [
    o[0] + d[0] * t,
    o[1] + d[1] * t,
    o[2] + d[2] * t,
  ];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return along(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return along(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    return along(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}
