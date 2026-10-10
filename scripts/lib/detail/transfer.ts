/**
 * Projects a sculpted part onto a reservoir (docs/research/ADULT-SCULPT-PLAN.md,
 * section 6d, step 4): the shape a target of the reservoir takes so that its
 * rings and cap lie on the part's surface.
 *
 * Both are discs. The part's boundary is its cut. The reservoir's boundary is its
 * loop, with the rings and then the cap inside it. The part is mapped to the unit
 * disc by Floater's mean-value map: its boundary goes to the circle by arclength,
 * from a reference direction it shares with the loop, and the map is bijective for
 * a convex boundary. The disc's radius is then remapped so that the part's area
 * falls on the reservoir's vertices evenly: ring k of R sits where the share of the
 * part's area between it and the tip is the share of the reservoir's vertices from
 * ring k inward. A cap vertex reads the part at its own place in the loop's disc,
 * inside the last ring. Each reservoir vertex then takes the part's point at its
 * disc coordinate.
 */
import type { Vec3 } from "./disc.ts";
import type { ReservoirRoot, RootShape } from "./root.ts";
import { cutOutline, partAxis, type SculptPart, withSkirt } from "./sculpt.ts";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * A closed loop's points as a share of its length, from the point furthest along
 * `reference` and turning counter-clockwise about `axis` (seen from where it points).
 * Returns the order of the points in that sense and each one's share, 0 to 1.
 */
export function loopParameter(
  points: readonly Vec3[],
  axis: Vec3,
  reference: Vec3,
): { order: number[]; share: number[] } {
  const n = points.length;
  const centre = points.reduce<Vec3>(
    (s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n],
    [0, 0, 0],
  );
  let turning = 0;
  for (let i = 0; i < n; i++)
    turning += dot(
      cross(sub(points[i] as Vec3, centre), sub(points[(i + 1) % n] as Vec3, centre)),
      axis,
    );
  const forward = turning > 0;
  let start = 0;
  for (let i = 1; i < n; i++)
    if (dot(sub(points[i] as Vec3, centre), reference) > dot(sub(points[start] as Vec3, centre), reference))
      start = i;
  const order = Array.from({ length: n }, (_, k) => (forward ? start + k : start - k + n) % n);
  const steps = order.map((v, k) => len(sub(points[order[(k + 1) % n] as number] as Vec3, points[v] as Vec3)));
  const total = steps.reduce((s, x) => s + x, 0);
  const share: number[] = new Array(n);
  let run = 0;
  order.forEach((v, k) => {
    share[v] = run / total;
    run += steps[k] as number;
  });
  return { order, share };
}

/** The part on the unit disc: two coordinates per vertex. */
export function meanValueDisc(part: SculptPart, boundaryShare: ReadonlyMap<number, number>): Float64Array {
  const P = part.positions;
  const n = P.length / 3;
  const at = (v: number): Vec3 => [P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number];
  // Mean-value weights: w_ij = (tan(a/2) + tan(b/2)) / |pi - pj|, the angles at i either side of ij.
  const weights = new Map<number, Map<number, number>>();
  const addWeight = (i: number, j: number, w: number) => {
    let row = weights.get(i);
    if (!row) weights.set(i, (row = new Map()));
    row.set(j, (row.get(j) ?? 0) + w);
  };
  const T = part.triangles;
  for (let t = 0; t < T.length; t += 3) {
    const tri = [T[t], T[t + 1], T[t + 2]] as number[];
    for (let c = 0; c < 3; c++) {
      const i = tri[c] as number;
      const j = tri[(c + 1) % 3] as number;
      const k = tri[(c + 2) % 3] as number;
      const e1 = sub(at(j), at(i));
      const e2 = sub(at(k), at(i));
      const angle = Math.atan2(len(cross(e1, e2)), dot(e1, e2));
      const half = Math.tan(angle / 2);
      addWeight(i, j, half / len(e1));
      addWeight(i, k, half / len(e2));
    }
  }
  const uv = new Float64Array(n * 2);
  const fixed = new Uint8Array(n);
  for (const [v, s] of boundaryShare) {
    uv[v * 2] = Math.cos(2 * Math.PI * s);
    uv[v * 2 + 1] = Math.sin(2 * Math.PI * s);
    fixed[v] = 1;
  }
  const rows = [...weights].filter(([v]) => !fixed[v]);
  const sums = rows.map(([, row]) => [...row.values()].reduce((s, w) => s + w, 0));
  sums.forEach((s, r) => {
    if (!(s > 0) || !Number.isFinite(s))
      throw new Error(`transfer: vertex ${(rows[r] as [number, unknown])[0]} has degenerate weights (${s})`);
  });
  // Each free vertex is the weighted mean of its neighbours: s_i x_i - sum w_ij x_j = 0,
  // with the boundary's terms moved to the right. The matrix is a non-symmetric
  // M-matrix; BiCGSTAB with a Jacobi preconditioner solves it for each coordinate.
  const free = new Map<number, number>();
  rows.forEach(([v], r) => {
    free.set(v, r);
  });
  const m = rows.length;
  const cols = rows.map(([, row]) =>
    [...row]
      .filter(([j]) => free.has(j))
      .map(([j, w]) => [free.get(j) as number, w] as const),
  );
  const multiply = (x: Float64Array, out: Float64Array) => {
    for (let r = 0; r < m; r++) {
      let s = (sums[r] as number) * (x[r] as number);
      for (const [c, w] of cols[r] as (readonly [number, number])[]) s -= w * (x[c] as number);
      out[r] = s;
    }
  };
  for (const axis of [0, 1]) {
    const b = new Float64Array(m);
    rows.forEach(([, row], r) => {
      let s = 0;
      for (const [j, w] of row) if (fixed[j]) s += w * (uv[j * 2 + axis] as number);
      b[r] = s;
    });
    const x = bicgstab(multiply, b, Float64Array.from(sums));
    rows.forEach(([v], r) => {
      uv[v * 2 + axis] = x[r] as number;
    });
  }
  return uv;
}

/** Solves A x = b by BiCGSTAB with the Jacobi preconditioner `diagonal`; throws unless it converges. */
function bicgstab(
  multiply: (x: Float64Array, out: Float64Array) => void,
  b: Float64Array,
  diagonal: Float64Array,
): Float64Array {
  const n = b.length;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = (b[i] as number) / (diagonal[i] as number);
  const r = new Float64Array(n);
  const ax = new Float64Array(n);
  multiply(x, ax);
  for (let i = 0; i < n; i++) r[i] = (b[i] as number) - (ax[i] as number);
  const r0 = Float64Array.from(r);
  const p = new Float64Array(n);
  const v = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const s = new Float64Array(n);
  const t = new Float64Array(n);
  const dotp = (a: Float64Array, c: Float64Array) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += (a[i] as number) * (c[i] as number);
    return sum;
  };
  const norm = Math.sqrt(dotp(b, b)) || 1;
  let rho = 1;
  let alpha = 1;
  let omega = 1;
  for (let it = 0; it < 10 * n + 1000; it++) {
    const rhoNext = dotp(r0, r);
    if (rhoNext === 0) break;
    const beta = (rhoNext / rho) * (alpha / omega);
    rho = rhoNext;
    for (let i = 0; i < n; i++)
      p[i] = (r[i] as number) + beta * ((p[i] as number) - omega * (v[i] as number));
    for (let i = 0; i < n; i++) y[i] = (p[i] as number) / (diagonal[i] as number);
    multiply(y, v);
    alpha = rho / dotp(r0, v);
    for (let i = 0; i < n; i++) s[i] = (r[i] as number) - alpha * (v[i] as number);
    for (let i = 0; i < n; i++) z[i] = (s[i] as number) / (diagonal[i] as number);
    multiply(z, t);
    const tt = dotp(t, t);
    omega = tt > 0 ? dotp(t, s) / tt : 0;
    for (let i = 0; i < n; i++)
      x[i] = (x[i] as number) + alpha * (y[i] as number) + omega * (z[i] as number);
    for (let i = 0; i < n; i++) r[i] = (s[i] as number) - omega * (t[i] as number);
    if (Math.sqrt(dotp(r, r)) / norm < 1e-12) return x;
    if (!Number.isFinite(omega) || omega === 0) break;
  }
  throw new Error("transfer: the mean-value map did not converge");
}

/** Locates a disc coordinate among the part's triangles and returns its point on the part. */
class DiscLookup {
  private readonly cells: number[][];
  private readonly part: SculptPart;
  private readonly uv: Float64Array;
  private static readonly N = 64;
  constructor(part: SculptPart, uv: Float64Array) {
    this.part = part;
    this.uv = uv;
    const N = DiscLookup.N;
    this.cells = Array.from({ length: N * N }, () => []);
    const T = part.triangles;
    const cell = (x: number) => Math.min(N - 1, Math.max(0, Math.floor(((x + 1) / 2) * N)));
    for (let t = 0; t < T.length / 3; t++) {
      const xs = [0, 1, 2].map((c) => uv[(T[t * 3 + c] as number) * 2] as number);
      const ys = [0, 1, 2].map((c) => uv[(T[t * 3 + c] as number) * 2 + 1] as number);
      for (let i = cell(Math.min(...xs)); i <= cell(Math.max(...xs)); i++)
        for (let j = cell(Math.min(...ys)); j <= cell(Math.max(...ys)); j++)
          (this.cells[i * N + j] as number[]).push(t);
    }
  }

  private barycentric(t: number, x: number, y: number): [number, number, number] {
    const T = this.part.triangles;
    const uv = this.uv;
    const [a, b, c] = [0, 1, 2].map((k) => T[t * 3 + k] as number) as [number, number, number];
    const ax = uv[a * 2] as number;
    const ay = uv[a * 2 + 1] as number;
    const v0x = (uv[b * 2] as number) - ax;
    const v0y = (uv[b * 2 + 1] as number) - ay;
    const v1x = (uv[c * 2] as number) - ax;
    const v1y = (uv[c * 2 + 1] as number) - ay;
    const v2x = x - ax;
    const v2y = y - ay;
    const den = v0x * v1y - v1x * v0y;
    const s = (v2x * v1y - v1x * v2y) / den;
    const r = (v0x * v2y - v2x * v0y) / den;
    return [1 - s - r, s, r];
  }

  point(x: number, y: number): Vec3 {
    const N = DiscLookup.N;
    const cell = (q: number) => Math.min(N - 1, Math.max(0, Math.floor(((q + 1) / 2) * N)));
    let best = -1;
    let bestW: [number, number, number] = [1, 0, 0];
    let bestOut = Number.POSITIVE_INFINITY;
    for (const t of this.cells[cell(x) * N + cell(y)] as number[]) {
      const w = this.barycentric(t, x, y);
      const out = -Math.min(w[0], w[1], w[2]);
      if (out < bestOut) {
        bestOut = out;
        best = t;
        bestW = w;
        if (out <= 0) break;
      }
    }
    if (best < 0) throw new Error(`transfer: no triangle near (${x}, ${y})`);
    // A point a hair outside every triangle (on the circle's chords) clamps to the nearest.
    const w = bestW.map((v) => Math.max(0, v));
    const sum = w[0]! + w[1]! + w[2]!;
    const P = this.part.positions;
    const T = this.part.triangles;
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const v = T[best * 3 + c] as number;
      for (let k = 0; k < 3; k++)
        out[k] = (out[k] as number) + ((w[c] as number) / sum) * (P[v * 3 + k] as number);
    }
    return out as unknown as Vec3;
  }
}

/**
 * A disc's area by radius in its map (`meanValueDisc`): the share of its area
 * within a radius of the centre (vertex areas, a third of each triangle's), and
 * the radius within which a share of it lies.
 */
function areaByRadius(mesh: SculptPart, uv: Float64Array) {
  const P = mesh.positions;
  const point = (v: number): Vec3 => [P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number];
  const count = P.length / 3;
  const area = new Float64Array(count);
  const T = mesh.triangles;
  for (let t = 0; t < T.length; t += 3) {
    const [a, b, c] = [T[t], T[t + 1], T[t + 2]] as [number, number, number];
    const A = len(cross(sub(point(b), point(a)), sub(point(c), point(a)))) / 2;
    area[a] = (area[a] as number) + A / 3;
    area[b] = (area[b] as number) + A / 3;
    area[c] = (area[c] as number) + A / 3;
  }
  const radius = (v: number) => Math.hypot(uv[v * 2] as number, uv[v * 2 + 1] as number);
  const byRadius = Array.from({ length: count }, (_, v) => v).sort((a, b) => radius(a) - radius(b));
  const total = area.reduce((s, x) => s + x, 0);
  const radii = [0];
  const shares = [0];
  let run = 0;
  for (const v of byRadius) {
    run += area[v] as number;
    radii.push(radius(v));
    shares.push(run / total);
  }
  radii.push(1);
  shares.push(1);
  /** Interpolates `to` at `x` among the increasing `from`. */
  const lerp = (from: number[], to: number[], x: number) => {
    let lo = 0;
    let hi = from.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((from[mid] as number) < x) lo = mid;
      else hi = mid;
    }
    const f0 = from[lo] as number;
    const f1 = from[hi] as number;
    const t = f1 > f0 ? Math.min(1, Math.max(0, (x - f0) / (f1 - f0))) : 0;
    return (to[lo] as number) + t * ((to[hi] as number) - (to[lo] as number));
  };
  return {
    radiusAt: (share: number) => lerp(shares, radii, share),
    shareAt: (r: number) => lerp(radii, shares, r),
  };
}

/** A reservoir's cap as a surface: the loop's vertices, then the interior's, its polygons fanned into triangles. */
function capSurface(root: ReservoirRoot): SculptPart {
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
  return { positions, triangles: Uint32Array.from(triangles), boundary: root.loop.map((_, i) => i) };
}

/** Options of a projection. */
export interface TransferOptions {
  /** The direction both loops start from (dorsal for a shaft, forward for a sac). */
  reference: Vec3;
}

/**
 * Where each point of a cut lands on a reservoir's loop, seen along `axis`: the
 * loop's point in the point's direction from the loop's centre, and its share of
 * the loop's arclength (`loopParameter`'s).
 */
export function landOnLoop(
  root: ReservoirRoot,
  loopParam: { order: number[]; share: number[] },
  cut: readonly Vec3[],
  axis: Vec3,
): { point: Vec3; share: number }[] {
  const seed: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(sub(seed, [axis[0] * dot(seed, axis), axis[1] * dot(seed, axis), axis[2] * dot(seed, axis)]));
  const e2 = cross(axis, e1);
  const centre = root.centre;
  const angleOf = (p: Vec3) => {
    const o = sub(p, centre);
    return Math.atan2(dot(o, e2), dot(o, e1));
  };
  const n = root.loop.length;
  const order = loopParam.order;
  // The loop's vertices in its own order, with their angles seen along the axis.
  const ring = order.map((v) => ({
    p: root.loop[v] as Vec3,
    angle: angleOf(root.loop[v] as Vec3),
    share: loopParam.share[v] as number,
  }));
  // Each cut point's share of the loop in its own direction.
  const angular = cut.map((c) => {
    const want = angleOf(c);
    for (let k = 0; k < n; k++) {
      const a = ring[k] as (typeof ring)[number];
      const b = ring[(k + 1) % n] as (typeof ring)[number];
      // The segment's sweep of angle, the short way round.
      let span = b.angle - a.angle;
      if (span > Math.PI) span -= 2 * Math.PI;
      if (span < -Math.PI) span += 2 * Math.PI;
      let off = want - a.angle;
      if (off > Math.PI) off -= 2 * Math.PI;
      if (off < -Math.PI) off += 2 * Math.PI;
      if (span === 0 || off / span < 0 || off / span > 1) continue;
      const s1 = k + 1 === n ? 1 : b.share;
      return a.share + (s1 - a.share) * (off / span);
    }
    throw new Error("transfer: a point of the cut has no place on the loop seen along the axis");
  });
  // A cut that is not star-shaped about the loop's centre turns back on itself here
  // and there: the shares are unwrapped, made monotone (pool-adjacent-violators), and
  // averaged with the cut's own arclength so neighbours never land on one point.
  const m = cut.length;
  const step = (i: number) => {
    let d = (angular[(i + 1) % m] as number) - (angular[i] as number);
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    return d;
  };
  let total = 0;
  for (let i = 0; i < m; i++) total += step(i);
  const sense = total >= 0 ? 1 : -1;
  const unwrapped = [0];
  for (let i = 0; i + 1 < m; i++) unwrapped.push((unwrapped[i] as number) + sense * step(i));
  const blocks: { sum: number; count: number }[] = [];
  for (const u of unwrapped) {
    blocks.push({ sum: u, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1] as { sum: number; count: number };
      const prev = blocks[blocks.length - 2] as { sum: number; count: number };
      if (prev.sum / prev.count <= last.sum / last.count) break;
      prev.sum += last.sum;
      prev.count += last.count;
      blocks.pop();
    }
  }
  const monotone = blocks.flatMap((b) => Array.from({ length: b.count }, () => b.sum / b.count));
  const lengths = cut.map((c, i) => {
    const d = cut[(i + 1) % m] as Vec3;
    return Math.hypot(d[0] - c[0], d[1] - c[1], d[2] - c[2]);
  });
  const perimeter = lengths.reduce((s, l) => s + l, 0);
  if (Math.abs(Math.abs(total) - 1) > 1e-6)
    throw new Error("transfer: the cut does not go once round the loop seen along the axis");
  let run = 0;
  const shares = cut.map((_, i) => {
    const arc = run / perimeter;
    run += lengths[i] as number;
    const s = (angular[0] as number) + sense * ((monotone[i] as number) + arc) / 2;
    return ((s % 1) + 1) % 1;
  });
  return shares.map((share) => ({ point: pointAtShare(root, loopParam, share), share }));
}

/** The point of a loop at a share of its arclength (`loopParameter`'s). */
function pointAtShare(
  root: ReservoirRoot,
  loopParam: { order: number[]; share: number[] },
  share: number,
): Vec3 {
  const n = root.loop.length;
  const order = loopParam.order;
  for (let k = 0; k < n; k++) {
    const a = order[k] as number;
    const b = order[(k + 1) % n] as number;
    const s0 = loopParam.share[a] as number;
    const s1 = k + 1 === n ? 1 : (loopParam.share[b] as number);
    if (share < s0 || share > s1) continue;
    const t = s1 > s0 ? (share - s0) / (s1 - s0) : 0;
    const p = root.loop[a] as Vec3;
    const q = root.loop[b] as Vec3;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  }
  return root.loop[order[0] as number] as Vec3;
}

/** How near the midline (the cut's centre's x) the pole is looked for, metres. */
const POLE_MIDLINE = 0.003;

/**
 * The part's pole, which the cap's centre reads: of the vertices on the midline,
 * the one furthest out along the part's axis (a shaft's meatus, the bottom of a sac
 * between its lobes).
 */
export function partPole(part: SculptPart): number {
  const axis = partAxis(part);
  const outline = cutOutline(part);
  const midX = outline.reduce((s, p) => s + p[0], 0) / outline.length;
  const P = part.positions;
  let best = -1;
  let far = Number.NEGATIVE_INFINITY;
  for (let v = 0; v < P.length / 3; v++) {
    if (Math.abs((P[v * 3] as number) - midX) > POLE_MIDLINE) continue;
    const d =
      (P[v * 3] as number) * axis[0] + (P[v * 3 + 1] as number) * axis[1] + (P[v * 3 + 2] as number) * axis[2];
    if (d > far) {
      far = d;
      best = v;
    }
  }
  if (best < 0) throw new Error("transfer: the part has no vertex on its midline");
  return best;
}

/** The disc automorphism that takes `a` (inside the unit disc) to the centre: (z - a) / (1 - conj(a) z). */
function moebius(ax: number, ay: number) {
  return (x: number, y: number): [number, number] => {
    const nx = x - ax;
    const ny = y - ay;
    // 1 - conj(a) z = 1 - (ax x + ay y) - i (ax y - ay x)
    const dx = 1 - (ax * x + ay * y);
    const dy = -(ax * y - ay * x);
    const den = dx * dx + dy * dy;
    return [(nx * dx + ny * dy) / den, (ny * dx - nx * dy) / den];
  };
}

/**
 * The part with a skirt that meets the reservoir's loop (`withSkirt`): seen along
 * the part's axis (as its footprint was found), each cut vertex lands where the ray
 * from the loop's centre in its own direction meets the loop, so the skirted part's
 * boundary is the loop itself. Returns the skirted part and each boundary vertex's
 * share of the loop's arclength from the reference.
 */
export function skirtOnto(
  root: ReservoirRoot,
  part: SculptPart,
  options: TransferOptions,
): { skirted: SculptPart; boundaryShare: Map<number, number> } {
  const loopParam = loopParameter(root.loop, root.normal, options.reference);
  const landed = landOnLoop(root, loopParam, cutOutline(part), partAxis(part));
  const skirted = withSkirt(part, (i) => (landed[i] as { point: Vec3 }).point);
  const boundaryShare = new Map<number, number>();
  skirted.boundary.forEach((v, i) => {
    boundaryShare.set(v, (landed[i] as { share: number }).share);
  });
  return { skirted, boundaryShare };
}

/**
 * The shape of the reservoir whose vertices lie on the part (`RootShape` order:
 * the cap's, then each ring's), with each vertex's disc coordinate.
 */
export function projectPart(root: ReservoirRoot, part: SculptPart, options: TransferOptions): RootShape {
  const loopParam = loopParameter(root.loop, root.normal, options.reference);
  const { skirted, boundaryShare } = skirtOnto(root, part, options);
  const count = skirted.positions.length / 3;
  const mapped = meanValueDisc(skirted, boundaryShare);
  // Move the pole to the disc's centre, so the cap is centred on it; the boundary
  // stays on the circle, each point turned along it as `turned` gives.
  const pole = partPole(part);
  const toCentre = moebius(mapped[pole * 2] as number, mapped[pole * 2 + 1] as number);
  const uv = new Float64Array(mapped.length);
  for (let v = 0; v < count; v++) {
    const [x, y] = toCentre(mapped[v * 2] as number, mapped[v * 2 + 1] as number);
    uv[v * 2] = x;
    uv[v * 2 + 1] = y;
  }
  /** The angle at which the boundary point at this share of the cut now lies. */
  const turned = (share: number) => {
    const [x, y] = toCentre(Math.cos(2 * Math.PI * share), Math.sin(2 * Math.PI * share));
    return Math.atan2(y, x);
  };

  const partArea = areaByRadius(skirted, uv);

  // The reservoir's own disc: the loop by its arclength from the same reference.
  const n = root.loop.length;
  const R = root.rings;
  const capShare = root.cap.length / (root.cap.length + R * n);
  const lookup = new DiscLookup(skirted, uv);
  const at = (share: number, t: number) => {
    const r = partArea.radiusAt(share);
    const angle = turned(t);
    return lookup.point(r * Math.cos(angle), r * Math.sin(angle));
  };
  // The cap on a disc of its own: its boundary is the loop at the loop's shares, so a cap
  // vertex's angle is its share round, and its area from the centre its share of the cap.
  const capMesh = capSurface(root);
  const capBoundary = new Map(root.loop.map((_, i) => [i, loopParam.share[i] as number] as const));
  const capUv = meanValueDisc(capMesh, capBoundary);
  const capArea = areaByRadius(capMesh, capUv);
  const shape: Vec3[] = root.cap.map((_, j) => {
    const v = n + j;
    const x = capUv[v * 2] as number;
    const y = capUv[v * 2 + 1] as number;
    const round = (((Math.atan2(y, x) / (2 * Math.PI)) % 1) + 1) % 1;
    return at(capShare * capArea.shareAt(Math.hypot(x, y)), round);
  });
  for (let k = 1; k <= R; k++) {
    const inside = capShare + ((1 - capShare) * (R - k)) / R;
    for (let i = 0; i < n; i++) shape.push(at(inside, loopParam.share[i] as number));
  }
  return shape;
}
