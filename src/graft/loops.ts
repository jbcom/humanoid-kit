/**
 * Closed loops on meshes, for grafting (docs/GRAFT.md): welding a triangle
 * mesh's coincident vertices, finding its boundary loops, ordering a loop's
 * edges, and sampling, fairing and measuring a closed polyline.
 */
import { GraftError, type Vec3 } from "./types.ts";

/**
 * Per vertex, the first vertex at the same position (to `tolerance` of the
 * mesh's bounding diagonal): UV-seam duplicates map to one vertex.
 */
export function weldByPosition(positions: ArrayLike<number>, tolerance = 1e-6): Uint32Array {
  const n = positions.length / 3;
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++)
    for (let k = 0; k < 3; k++) {
      const x = positions[v * 3 + k] as number;
      lo[k] = Math.min(lo[k] as number, x);
      hi[k] = Math.max(hi[k] as number, x);
    }
  if (n === 0) {
    lo = [0, 0, 0];
    hi = [0, 0, 0];
  }
  const cell =
    Math.hypot(
      (hi[0] as number) - (lo[0] as number),
      (hi[1] as number) - (lo[1] as number),
      (hi[2] as number) - (lo[2] as number),
    ) * tolerance || 1e-12;
  const out = new Uint32Array(n);
  const seen = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const key = [0, 1, 2].map((k) => Math.round((positions[v * 3 + k] as number) / cell)).join(",");
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, v);
      out[v] = v;
    } else out[v] = first;
  }
  return out;
}

const edgeKey = (a: number, b: number): number =>
  a < b ? a * 0x100000000 + b : b * 0x100000000 + a;

/**
 * The directed edges used by exactly one triangle, over welded vertex ids
 * (`weld[v]`), as `[from, to]` in the triangle's winding.
 */
export function boundaryEdges(
  triangles: ArrayLike<number>,
  weld: ArrayLike<number>,
): [number, number][] {
  const uses = new Map<number, { count: number; from: number; to: number }>();
  for (let t = 0; t < triangles.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = weld[triangles[t + k] as number] as number;
      const b = weld[triangles[t + ((k + 1) % 3)] as number] as number;
      if (a === b) continue;
      const key = edgeKey(a, b);
      const u = uses.get(key);
      if (u) u.count++;
      else uses.set(key, { count: 1, from: a, to: b });
    }
  const out: [number, number][] = [];
  for (const u of uses.values()) if (u.count === 1) out.push([u.from, u.to]);
  return out;
}

/**
 * Orders undirected edges into closed loops. Throws unless every vertex on
 * them has exactly two edges (the edges form simple, disjoint loops).
 */
export function orderLoops(edges: readonly (readonly [number, number])[]): number[][] {
  const adj = new Map<number, number[]>();
  for (const [a, b] of edges) {
    (adj.get(a) ?? adj.set(a, []).get(a))?.push(b);
    (adj.get(b) ?? adj.set(b, []).get(b))?.push(a);
  }
  for (const [v, n] of adj)
    if (n.length !== 2)
      throw new GraftError(
        `the boundary is not simple: vertex ${v} has ${n.length} boundary edges`,
      );
  const seen = new Set<number>();
  const loops: number[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [start];
    seen.add(start);
    let prev = start;
    let at = (adj.get(start) as number[])[0] as number;
    while (at !== start) {
      loop.push(at);
      seen.add(at);
      const [x, y] = adj.get(at) as number[];
      const next = x === prev ? (y as number) : (x as number);
      prev = at;
      at = next;
    }
    loops.push(loop);
  }
  return loops;
}

/** A loop's length, over `positions` (xyz per vertex). */
export function loopLength(loop: readonly number[], positions: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++)
    s += dist(positions, loop[i] as number, loop[(i + 1) % loop.length] as number);
  return s;
}

const dist = (p: ArrayLike<number>, a: number, b: number): number =>
  Math.hypot(
    (p[a * 3] as number) - (p[b * 3] as number),
    (p[a * 3 + 1] as number) - (p[b * 3 + 1] as number),
    (p[a * 3 + 2] as number) - (p[b * 3 + 2] as number),
  );

/** Points (xyz) of a loop's vertices, in order. */
export function loopPoints(loop: readonly number[], positions: ArrayLike<number>): Float64Array {
  const out = new Float64Array(loop.length * 3);
  loop.forEach((v, i) => {
    for (let k = 0; k < 3; k++) out[i * 3 + k] = positions[v * 3 + k] as number;
  });
  return out;
}

/** Centroid of a closed polyline's points (their mean). */
export function centroid(points: ArrayLike<number>): Vec3 {
  const n = points.length / 3;
  const c: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (points[i * 3 + k] as number) / n;
  return c;
}

/** Newell's normal of a closed polyline: its vector area, whose direction the winding sets. */
export function newellNormal(points: ArrayLike<number>): Vec3 {
  const n = points.length / 3;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [x0, y0, z0] = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]] as Vec3;
    const [x1, y1, z1] = [points[j * 3], points[j * 3 + 1], points[j * 3 + 2]] as Vec3;
    out[0] += (y0 - y1) * (z0 + z1);
    out[1] += (z0 - z1) * (x0 + x1);
    out[2] += (x0 - x1) * (y0 + y1);
  }
  return out;
}

/**
 * Rest parameters of a closed polyline's vertices: the arc length from the
 * first vertex to each, over the whole length, in [0, 1).
 */
export function arcParams(points: ArrayLike<number>): Float64Array {
  const n = points.length / 3;
  const out = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    out[i] = total;
    total += Math.hypot(
      ...([0, 1, 2].map(
        (k) => (points[((i + 1) % n) * 3 + k] as number) - (points[i * 3 + k] as number),
      ) as Vec3),
    );
  }
  for (let i = 0; i < n; i++) out[i] = (out[i] as number) / (total || 1);
  return out;
}

/**
 * The closed polyline `points` (vertex `i` at rest parameter `params[i]`,
 * ascending from 0) evaluated at parameter `t` in [0, 1): linear between the
 * two vertices it lies between. Writes xyz into `out` at `o`.
 */
export function atParam(
  points: ArrayLike<number>,
  params: ArrayLike<number>,
  t: number,
  out: Float64Array | Float32Array,
  o = 0,
): void {
  const n = params.length;
  // The last vertex at or before t (params ascend, so a binary search finds it).
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((params[mid] as number) <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = lo;
  const b = (a + 1) % n;
  const ta = params[a] as number;
  const tb = b === 0 ? 1 : (params[b] as number);
  const f = tb > ta ? (t - ta) / (tb - ta) : 0;
  for (let k = 0; k < 3; k++)
    out[o + k] = (points[a * 3 + k] as number) * (1 - f) + (points[b * 3 + k] as number) * f;
}

/** `count` samples of a closed polyline at the parameters i / count (`atParam`). */
export function sampleLoop(
  points: ArrayLike<number>,
  params: ArrayLike<number>,
  count: number,
): Float64Array {
  const out = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) atParam(points, params, i / count, out, i * 3);
  return out;
}

/** The largest turn (radians) between consecutive segments of a closed polyline. */
export function maxTurn(points: ArrayLike<number>): number {
  const n = points.length / 3;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const u = [0, 1, 2].map((k) => (points[i * 3 + k] as number) - (points[p * 3 + k] as number));
    const w = [0, 1, 2].map((k) => (points[q * 3 + k] as number) - (points[i * 3 + k] as number));
    const lu = Math.hypot(...u);
    const lw = Math.hypot(...w);
    if (lu === 0 || lw === 0) continue;
    const c =
      ((u[0] as number) * (w[0] as number) +
        (u[1] as number) * (w[1] as number) +
        (u[2] as number) * (w[2] as number)) /
      (lu * lw);
    worst = Math.max(worst, Math.acos(Math.min(1, Math.max(-1, c))));
  }
  return worst;
}

/**
 * Fairs a closed polyline in place: Laplacian steps (each point halfway to its
 * neighbours' mean) until no point turns by more than `limit` radians, at most
 * `steps` times. Returns the largest turn left.
 */
export function fairLoop(points: Float64Array, limit: number, steps = 50): number {
  const n = points.length / 3;
  const next = new Float64Array(points.length);
  let turn = maxTurn(points);
  for (let s = 0; s < steps && turn > limit; s++) {
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n;
      const q = (i + 1) % n;
      for (let k = 0; k < 3; k++)
        next[i * 3 + k] =
          (points[i * 3 + k] as number) * 0.5 +
          ((points[p * 3 + k] as number) + (points[q * 3 + k] as number)) * 0.25;
    }
    points.set(next);
    turn = maxTurn(points);
  }
  return turn;
}
