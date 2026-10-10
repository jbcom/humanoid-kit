/**
 * Projects a sculpted part onto a reservoir (docs/research/ADULT-SCULPT-PLAN.md,
 * section 6d, step 4): the shape a target of the reservoir takes so that its
 * rings and cap lie on the part's surface.
 *
 * Both are discs. The part's boundary is its cut. The reservoir's boundary is its
 * loop, with the rings and then the cap inside it. The first ring lies on the skin
 * just inside the loop, on a smooth line (`skinLine`), and the part is attached
 * there: a skirt carries its cut to the line. The skirted part is mapped to the unit
 * disc by Floater's mean-value map: its boundary goes to the circle by arclength,
 * from a reference direction it shares with the loop, and the map is bijective for
 * a convex boundary. The disc's radius is then remapped so that the part's area
 * falls on the reservoir's vertices evenly: ring k of R sits where the share of the
 * part's area between it and the tip is the share of the reservoir's vertices from
 * ring k inward. A cap vertex reads the part at its own place in the loop's disc,
 * inside the last ring. Each reservoir vertex then takes the part's point at its
 * disc coordinate.
 */
import type { Skin } from "./contact.ts";
import type { Vec3 } from "./disc.ts";
import { capSurface, nearestOnSurface, type ReservoirRoot, type RootShape } from "./root.ts";
import {
  cutOutline,
  partAxis,
  type SculptPart,
  trimmedUnder,
  underRoot,
  withSkirt,
} from "./sculpt.ts";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/**
 * A closed loop's points as a share of its length, turning counter-clockwise about
 * `axis` (seen from where it points), from where the loop crosses its midline on the
 * `reference` side: the plane through its centre that holds `axis` and `reference`.
 * Returns the order of the points in that sense, from the first after that crossing,
 * and each one's share, 0 to 1.
 *
 * The start is a crossing, not the point furthest along `reference`: that point is
 * not one place on either curve a part is moved between. A cut's front is flat, so
 * any of a dozen vertices along it is furthest by a hair; a loop that gives way round
 * a neighbouring reservoir has two horns, one each side of its dent. The two starts
 * fell on opposite sides of the midline, and every point of the cut landed a sixth
 * of the way round the loop from where it belonged, which twisted the skirt into
 * folds. Both curves are a figure's, and each crosses the figure's midline once on
 * the reference side, so the crossing is the same place on both.
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
  const round = Array.from({ length: n }, (_, k) => (forward ? k : n - k) % n);
  // The midline's crossings, each where an edge's ends lie on either side of the plane;
  // the one furthest along `reference` is the start, at `lead` short of the vertex after it.
  const lateral = cross(axis, reference);
  const side = (v: number) => dot(sub(points[v] as Vec3, centre), lateral);
  let first = -1;
  let lead = 0;
  let far = 0;
  for (let k = 0; k < n; k++) {
    const a = round[k] as number;
    const b = round[(k + 1) % n] as number;
    const sa = side(a);
    const sb = side(b);
    if (sa < 0 === sb < 0) continue;
    const t = sa / (sa - sb);
    const pa = points[a] as Vec3;
    const pb = points[b] as Vec3;
    const crossing: Vec3 = [
      pa[0] + (pb[0] - pa[0]) * t,
      pa[1] + (pb[1] - pa[1]) * t,
      pa[2] + (pb[2] - pa[2]) * t,
    ];
    const ahead = dot(sub(crossing, centre), reference);
    if (ahead > far) {
      far = ahead;
      first = (k + 1) % n;
      lead = len(sub(pb, crossing));
    }
  }
  if (first < 0)
    throw new Error("transfer: the loop does not cross its midline on the reference side");
  const order = Array.from({ length: n }, (_, k) => round[(first + k) % n] as number);
  const steps = order.map((v, k) =>
    len(sub(points[order[(k + 1) % n] as number] as Vec3, points[v] as Vec3)),
  );
  const total = steps.reduce((s, x) => s + x, 0);
  const share: number[] = new Array(n);
  let run = lead;
  order.forEach((v, k) => {
    share[v] = run / total;
    run += steps[k] as number;
  });
  return { order, share };
}

/** The part on the unit disc: two coordinates per vertex. */
export function meanValueDisc(
  part: SculptPart,
  boundaryShare: ReadonlyMap<number, number>,
): Float64Array {
  const P = part.positions;
  const n = P.length / 3;
  const at = (v: number): Vec3 => [
    P[v * 3] as number,
    P[v * 3 + 1] as number,
    P[v * 3 + 2] as number,
  ];
  // Mean-value weights: w_ij = (tan(a/2) + tan(b/2)) / |pi - pj|, the angles at i either side of ij.
  const weights = new Map<number, Map<number, number>>();
  const addWeight = (i: number, j: number, w: number) => {
    const row = weights.get(i) ?? new Map<number, number>();
    weights.set(i, row);
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
  const fixed = new Uint8Array(n);
  const boundary = new Float64Array(n * 2);
  for (const [v, s] of boundaryShare) {
    boundary[v * 2] = Math.cos(2 * Math.PI * s);
    boundary[v * 2 + 1] = Math.sin(2 * Math.PI * s);
    fixed[v] = 1;
  }
  const free = [...weights.keys()].filter((v) => !fixed[v]);
  // A map that lets a bulge (a lobe of a sac) take a small corner of the disc samples it
  // coarsely there, and the reservoir folds across it. Each pass divides every weight by
  // its neighbour's stretch (Yoshizawa, Belyaev and Seidel 2004, "A fast and simple
  // stretch-minimizing mesh parameterization"), which opens the squeezed regions. The
  // weights stay positive, so every pass is still a bijection onto the disc; the map with
  // the least stretch is kept.
  let uv = solveDisc(weights, free, fixed, boundary);
  let stretch = mapStretch(part, uv);
  for (let pass = 0; pass < STRETCH_PASSES; pass++) {
    const reweighted = new Map<number, Map<number, number>>();
    for (const [i, row] of weights)
      reweighted.set(i, new Map([...row].map(([j, w]) => [j, w / (stretch.vertex[j] as number)])));
    const next = solveDisc(reweighted, free, fixed, boundary);
    const nextStretch = mapStretch(part, next);
    if (!(nextStretch.total < stretch.total)) break;
    weights.clear();
    for (const [i, row] of reweighted) weights.set(i, row);
    uv = next;
    stretch = nextStretch;
  }
  return uv;
}

/** Passes of stretch reweighting the disc map may take (it stops sooner once stretch stops falling). */
const STRETCH_PASSES = 8;

/**
 * Each free vertex the weighted mean of its neighbours, the fixed ones where
 * `boundary` puts them: s_i x_i - sum w_ij x_j = 0, with the boundary's terms on the
 * right. The matrix is a non-symmetric M-matrix; BiCGSTAB with a Jacobi
 * preconditioner solves it for each coordinate.
 */
function solveDisc(
  weights: ReadonlyMap<number, ReadonlyMap<number, number>>,
  free: readonly number[],
  fixed: Uint8Array,
  boundary: Float64Array,
): Float64Array {
  const uv = Float64Array.from(boundary);
  const index = new Map(free.map((v, r) => [v, r] as const));
  const rows = free.map((v) => weights.get(v) as ReadonlyMap<number, number>);
  const sums = rows.map((row) => [...row.values()].reduce((s, w) => s + w, 0));
  sums.forEach((s, r) => {
    if (!(s > 0) || !Number.isFinite(s))
      throw new Error(`transfer: vertex ${free[r]} has degenerate weights (${s})`);
  });
  const m = free.length;
  const cols = rows.map((row) =>
    [...row].filter(([j]) => index.has(j)).map(([j, w]) => [index.get(j) as number, w] as const),
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
    rows.forEach((row, r) => {
      let s = 0;
      for (const [j, w] of row) if (fixed[j]) s += w * (boundary[j * 2 + axis] as number);
      b[r] = s;
    });
    const x = bicgstab(multiply, b, Float64Array.from(sums));
    free.forEach((v, r) => {
      uv[v * 2 + axis] = x[r] as number;
    });
  }
  return uv;
}

/**
 * How much a disc map stretches the surface (Sander et al. 2001's L2 stretch of the
 * map from the disc to the surface, the surface scaled to the disc's area): per
 * vertex, the area-weighted root mean square over its triangles, and over the whole.
 */
function mapStretch(part: SculptPart, uv: Float64Array): { vertex: Float64Array; total: number } {
  const P = part.positions;
  const T = part.triangles;
  const n = P.length / 3;
  const at = (v: number): Vec3 => [
    P[v * 3] as number,
    P[v * 3 + 1] as number,
    P[v * 3 + 2] as number,
  ];
  let surface = 0;
  let disc = 0;
  const tris = T.length / 3;
  const area3 = new Float64Array(tris);
  const sigma2 = new Float64Array(tris);
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]] as [number, number, number];
    const [q1, q2, q3] = [at(a), at(b), at(c)];
    const [s1, t1, s2, t2, s3, t3] = [a, b, c].flatMap((v) => [
      uv[v * 2] as number,
      uv[v * 2 + 1] as number,
    ]) as [number, number, number, number, number, number];
    const A2 = ((s2 - s1) * (t3 - t1) - (s3 - s1) * (t2 - t1)) / 2;
    const A3 = len(cross(sub(q2, q1), sub(q3, q1))) / 2;
    area3[t] = A3;
    surface += A3;
    disc += Math.abs(A2);
    if (Math.abs(A2) < 1e-18) {
      sigma2[t] = Number.POSITIVE_INFINITY;
      continue;
    }
    const Ss = [0, 1, 2].map(
      (k) =>
        ((q1[k] as number) * (t2 - t3) +
          (q2[k] as number) * (t3 - t1) +
          (q3[k] as number) * (t1 - t2)) /
        (2 * A2),
    );
    const St = [0, 1, 2].map(
      (k) =>
        ((q1[k] as number) * (s3 - s2) +
          (q2[k] as number) * (s1 - s3) +
          (q3[k] as number) * (s2 - s1)) /
        (2 * A2),
    );
    const dd = (v: number[]) => v.reduce((s, x) => s + x * x, 0);
    sigma2[t] = (dd(Ss) + dd(St)) / 2;
  }
  // The surface scaled to the disc's area, so a map that keeps area everywhere has stretch 1.
  const scale = disc / surface;
  const sum = new Float64Array(n);
  const weight = new Float64Array(n);
  let total = 0;
  for (let t = 0; t < tris; t++) {
    const s2 = (sigma2[t] as number) * scale;
    total += (area3[t] as number) * s2;
    for (let c = 0; c < 3; c++) {
      const v = T[t * 3 + c] as number;
      sum[v] = (sum[v] as number) + (area3[t] as number) * s2;
      weight[v] = (weight[v] as number) + (area3[t] as number);
    }
  }
  const vertex = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    const s = (weight[v] as number) > 0 ? Math.sqrt((sum[v] as number) / (weight[v] as number)) : 1;
    vertex[v] = Number.isFinite(s) && s > 0 ? s : 1;
  }
  return { vertex, total: Math.sqrt(total / surface) };
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
    const sum = w.reduce((s, v) => s + v, 0);
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
  const point = (v: number): Vec3 => [
    P[v * 3] as number,
    P[v * 3 + 1] as number,
    P[v * 3 + 2] as number,
  ];
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

/** Options of a projection. */
export interface TransferOptions {
  /** The direction both loops start from (dorsal for a shaft, forward for a sac). */
  reference: Vec3;
  /** The skin round the reservoirs (`contact.ts`): the part is cut where it comes out of it. */
  skin: Pick<Skin, "surfaceDepth">;
}

/**
 * Where each point of a cut lands on a reservoir's loop: at the same share of the
 * loop's arclength as the point's of the cut's, both measured as `loopParameter`
 * measures them, from the point furthest along `reference` and turning the same
 * way about the root's normal. The correspondence is monotone whatever either
 * curve's shape: a loop that gives way round a neighbouring reservoir is dented,
 * and reading a cut point's place on it by its direction from the loop's centre
 * folds the skirt across the dent.
 */
export function landOnLoop(
  root: ReservoirRoot,
  loopParam: { order: number[]; share: number[] },
  cut: readonly Vec3[],
  reference: Vec3,
): { point: Vec3; share: number }[] {
  const cutParam = loopParameter(cut, root.normal, reference);
  return cut.map((_, i) => {
    const share = cutParam.share[i] as number;
    return { point: pointAtShare(root, loopParam, share), share };
  });
}

/**
 * The point of a loop at a share of its arclength (`loopParameter`'s). The share
 * starts between the last vertex and the first, so a share short of the first
 * vertex's lies on that edge, a whole turn on.
 */
function pointAtShare(
  root: ReservoirRoot,
  loopParam: { order: number[]; share: number[] },
  share: number,
): Vec3 {
  const n = root.loop.length;
  const order = loopParam.order;
  const lead = loopParam.share[order[0] as number] as number;
  const s = share < lead ? share + 1 : share;
  for (let k = 0; k < n; k++) {
    const a = order[k] as number;
    const b = order[(k + 1) % n] as number;
    const s0 = loopParam.share[a] as number;
    const s1 = k + 1 === n ? lead + 1 : (loopParam.share[b] as number);
    if (s < s0 || s > s1) continue;
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const p = root.loop[a] as Vec3;
    const q = root.loop[b] as Vec3;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  }
  return root.loop[order[0] as number] as Vec3;
}

/**
 * The part's pole, which the cap's centre reads: of the points where the part's
 * surface crosses its midline (the plane through its cut's centre square to x), the
 * one furthest out along the part's axis (a shaft's meatus, the bottom of a sac
 * between its lobes). It lies on the edge from `a` to `b`, `t` of the way along.
 *
 * The pole is a crossing, not a vertex near the midline: a sac's lobes bulge lower
 * than the floor of the cleft between them, so the furthest vertex within any
 * tolerance of the midline is on a lobe's flank at the tolerance's edge (3 mm out
 * picked the left lobe 6 mm below the cleft), and the rings centred there wrapped one
 * lobe and crowded down the back.
 */
export function partPole(part: SculptPart): { a: number; b: number; t: number } {
  const axis = partAxis(part);
  const outline = cutOutline(part);
  const midX = outline.reduce((s, p) => s + p[0], 0) / outline.length;
  const P = part.positions;
  const T = part.triangles;
  let pole: { a: number; b: number; t: number } | null = null;
  let far = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < T.length; i++) {
    const a = T[i] as number;
    const b = T[i - (i % 3) + ((i + 1) % 3)] as number;
    const xa = (P[a * 3] as number) - midX;
    const xb = (P[b * 3] as number) - midX;
    if (xa < 0 === xb < 0) continue;
    const t = xa / (xa - xb);
    const d = [0, 1, 2].reduce(
      (s, k) =>
        s +
        ((P[a * 3 + k] as number) + ((P[b * 3 + k] as number) - (P[a * 3 + k] as number)) * t) *
          (axis[k] as number),
      0,
    );
    if (d > far) {
      far = d;
      pole = { a, b, t };
    }
  }
  if (!pole) throw new Error("transfer: the part does not cross its midline");
  return pole;
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

/** The share of a part's area that may lie under the skin at its root and be cut away (`seatedOn`). */
const ROOT_SLIVER = 0.15;

/**
 * The part seated on the skin at the root. Where no more than `ROOT_SLIVER` of its
 * area is under the skin there, it is cut where it comes out (`trimmedUnder`), and its
 * cut lies on the skin all round. Where more is under, it was placed too deep, and it
 * is moved out along the root's normal, without turning or reshaping it, until none of
 * its cut is under.
 *
 * A sculpt's cut is where its author's figure's skin was, and placed on ours by a fit
 * over the whole asset it is sunk or tilted against our skin. From a cut under the skin
 * the skirt, which leaves the way the part's surface does, into the body, turns back
 * out to the skin line and folds over the part's top. The two errors want different
 * mends. The flaccid shaft's cut is level with the skin at the back of the root and
 * 12 mm under at the front: a sliver of its root (6 % of it) is under, and cut away
 * there it meets the skin all round; moved out until none of it was under, it stood a
 * centimetre off the skin at the back, and its rim was a shelf round the root. The
 * sac's is 6 to 17 mm under all round, and its back lies along the perineum under the
 * same cap: 44 % of it is under, and cut away it lost its back; it was placed too deep,
 * and is moved out. Turning a part to lay its cut on the skin turned the erect shaft by
 * 44 degrees, chasing the curve of the groin, and is not done.
 *
 * What is under the skin is the region under it that reaches the cut (`underRoot`), so
 * a part pressing into skin elsewhere is not cut there; that is the contact's to rest
 * (`contact.ts`). An erect sculpt's cut is wider than the flaccid one the cap was found
 * from, and its root passes under the belly past the cap's edge: it is the root still.
 */
export function seatedOn(
  root: ReservoirRoot,
  part: SculptPart,
  skin: Pick<Skin, "surfaceDepth">,
): SculptPart {
  const N = root.normal;
  const depthAt = (p: Vec3) => skin.surfaceDepth(p).depth;
  const under = underRoot(part, depthAt);
  if (surfaceArea(part, under) / surfaceArea(part) <= ROOT_SLIVER)
    return trimmedUnder(part, depthAt, under);
  // Moved out by the cut's greatest depth, none of the cut is under, and nothing is cut.
  const rise = Math.max(0, ...cutOutline(part).map((p) => -depthAt(p)));
  return {
    ...part,
    positions: Float64Array.from(part.positions, (x, i) => x + rise * (N[i % 3] as number)),
  };
}

/** A surface's area, or of its triangles whose corners are all `within`. */
function surfaceArea(surface: SculptPart, within?: Uint8Array): number {
  const P = surface.positions;
  const T = surface.triangles;
  const at = (v: number): Vec3 => [
    P[v * 3] as number,
    P[v * 3 + 1] as number,
    P[v * 3 + 2] as number,
  ];
  let sum = 0;
  for (let t = 0; t < T.length; t += 3) {
    if (
      within &&
      !(within[T[t] as number] && within[T[t + 1] as number] && within[T[t + 2] as number])
    )
      continue;
    const a = at(T[t] as number);
    sum += len(cross(sub(at(T[t + 1] as number), a), sub(at(T[t + 2] as number), a))) / 2;
  }
  return sum;
}

/** Loop vertices each side of one whose mean is the skin line's place there (`skinLine`). */
const SKIN_LINE_WINDOW = 3;
/** How far inside the loop vertex that reaches furthest in the skin line is kept, metres. */
const SKIN_LINE_MARGIN = 0.0005;

/**
 * The skin line: a smooth curve on the skin just inside the loop, one point across
 * from each loop vertex, where a part is attached and the reservoir's first ring lies.
 *
 * The loop is the boundary of whole lattice polygons, so where it crosses the
 * lattice's rows it is a staircase, stepping in and out by up to two millimetres.
 * A part attached to the staircase itself fans its skirt and its first rings out to
 * every corner, and the band from the loop to the first ring stands up off the skin
 * as a comb. Attached to a smooth line on the skin instead, the part leaves the skin
 * cleanly, and the band from the loop to the line is a strip of skin, flat with the
 * skin round it, where the staircase is only an edge between skin and skin.
 *
 * The line is drawn through the mean of each loop vertex's neighbours along the loop,
 * moved in across the loop (to the left of its run about the normal, as
 * `loopParameter` turns) until it is inside every loop vertex near it, on the skin the
 * cap covers at rest; each loop vertex's point is then the line's at the vertex's
 * share of the loop's length.
 */
export function skinLine(
  root: ReservoirRoot,
  loopParam: { order: number[]; share: number[] },
): Vec3[] {
  const n = root.loop.length;
  const order = loopParam.order;
  const atOrder = (k: number) => root.loop[order[(((k % n) + n) % n) as number] as number] as Vec3;
  const mean: Vec3[] = order.map((_, k) => {
    const s = [0, 0, 0];
    for (let d = -SKIN_LINE_WINDOW; d <= SKIN_LINE_WINDOW; d++) {
      const p = atOrder(k + d);
      for (let c = 0; c < 3; c++)
        s[c] = (s[c] as number) + (p[c] as number) / (2 * SKIN_LINE_WINDOW + 1);
    }
    return s as unknown as Vec3;
  });
  const inward: Vec3[] = mean.map((_, k) => {
    const t = sub(mean[(k + 1) % n] as Vec3, mean[(k + n - 1) % n] as Vec3);
    const w = cross(root.normal, t);
    const l = len(w);
    return [w[0] / l, w[1] / l, w[2] / l];
  });
  // How far in the line must go to pass inside every loop vertex beside it.
  let reach = 0;
  mean.forEach((m, k) => {
    for (let d = -SKIN_LINE_WINDOW; d <= SKIN_LINE_WINDOW; d++)
      reach = Math.max(reach, dot(sub(atOrder(k + d), m), inward[k] as Vec3));
  });
  reach += SKIN_LINE_MARGIN;
  const cap = capSurface(root);
  const drawn: Vec3[] = mean.map((m, k) => {
    const w = inward[k] as Vec3;
    return nearestOnSurface(
      cap,
      [m[0] + w[0] * reach, m[1] + w[1] * reach, m[2] + w[2] * reach],
      root.normal,
    ).point;
  });
  // Moved in, the points crowd where the loop turns sharply (at the tips of a dented
  // loop's horns, to a fifth of the loop's spacing), and the rings that read the part
  // across a crowded step turned over. Each point is put on the line at its loop vertex's
  // share of the loop's length, from the first.
  const steps = drawn.map((p, k) => len(sub(drawn[(k + 1) % n] as Vec3, p)));
  const total = steps.reduce((s, x) => s + x, 0);
  const first = loopParam.share[order[0] as number] as number;
  const line: Vec3[] = new Array(n);
  let k = 0;
  let run = 0;
  order.forEach((v) => {
    const want = (((((loopParam.share[v] as number) - first) % 1) + 1) % 1) * total;
    while (k < n - 1 && run + (steps[k] as number) < want) run += steps[k++] as number;
    const t = (steps[k] as number) > 0 ? (want - run) / (steps[k] as number) : 0;
    const p = drawn[k] as Vec3;
    const q = drawn[(k + 1) % n] as Vec3;
    line[v] = nearestOnSurface(
      cap,
      [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t],
      root.normal,
    ).point;
  });
  return line;
}

/**
 * The part seated on the skin (`seatedOn`), with a skirt that meets the reservoir's
 * skin line (`skinLine`, `withSkirt`): each cut vertex lands on the line at its own
 * share of the cut (`landOnLoop`), so the skirted part's boundary is the line.
 * Returns the part as seated (its vertices are the skirted part's first), the skirted
 * part, each boundary vertex's share of the line's arclength from the reference, and
 * the line with its parameter.
 */
export function skirtOnto(
  root: ReservoirRoot,
  part: SculptPart,
  options: TransferOptions,
): {
  emerged: SculptPart;
  skirted: SculptPart;
  boundaryShare: Map<number, number>;
  line: Vec3[];
  lineParam: { order: number[]; share: number[] };
} {
  const line = skinLine(root, loopParameter(root.loop, root.normal, options.reference));
  const attached: ReservoirRoot = { ...root, loop: line };
  const lineParam = loopParameter(line, root.normal, options.reference);
  const emerged = seatedOn(root, part, options.skin);
  const landed = landOnLoop(attached, lineParam, cutOutline(emerged), options.reference);
  const skirted = withSkirt(emerged, (i) => (landed[i] as { point: Vec3 }).point);
  const boundaryShare = new Map<number, number>();
  skirted.boundary.forEach((v, i) => {
    boundaryShare.set(v, (landed[i] as { share: number }).share);
  });
  return { emerged, skirted, boundaryShare, line, lineParam };
}

/**
 * The shape of the reservoir whose vertices lie on the part (`RootShape` order:
 * the cap's, then each ring's), with each vertex's disc coordinate.
 */
export function projectPart(
  root: ReservoirRoot,
  part: SculptPart,
  options: TransferOptions,
): RootShape {
  const { emerged, skirted, boundaryShare, line, lineParam } = skirtOnto(root, part, options);
  const count = skirted.positions.length / 3;
  const mapped = meanValueDisc(skirted, boundaryShare);
  // Move the pole to the disc's centre, so the cap is centred on it; the boundary
  // stays on the circle, each point turned along it as `turned` gives.
  const pole = partPole(emerged);
  const poleAt = (k: number) =>
    (mapped[pole.a * 2 + k] as number) +
    ((mapped[pole.b * 2 + k] as number) - (mapped[pole.a * 2 + k] as number)) * pole.t;
  const toCentre = moebius(poleAt(0), poleAt(1));
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

  // The reservoir's own disc: the skin line by its arclength from the same reference.
  // The first ring is the line itself, on the skin; the part's area falls on the rest.
  const n = root.loop.length;
  const R = root.rings;
  const capShare = root.cap.length / (root.cap.length + (R - 1) * n);
  const lookup = new DiscLookup(skirted, uv);
  const at = (share: number, t: number) => {
    const r = partArea.radiusAt(share);
    const angle = turned(t);
    return lookup.point(r * Math.cos(angle), r * Math.sin(angle));
  };
  // The cap on a disc of its own: its boundary is the loop at the loop's shares, so a cap
  // vertex's angle is its share round, and its area from the centre its share of the cap.
  const capMesh = capSurface(root);
  const capBoundary = new Map(root.loop.map((_, i) => [i, lineParam.share[i] as number] as const));
  const capUv = meanValueDisc(capMesh, capBoundary);
  const capArea = areaByRadius(capMesh, capUv);
  const shape: Vec3[] = root.cap.map((_, j) => {
    const v = n + j;
    const x = capUv[v * 2] as number;
    const y = capUv[v * 2 + 1] as number;
    const round = (((Math.atan2(y, x) / (2 * Math.PI)) % 1) + 1) % 1;
    return at(capShare * capArea.shareAt(Math.hypot(x, y)), round);
  });
  shape.push(...line);
  for (let k = 2; k <= R; k++) {
    const inside = capShare + ((1 - capShare) * (R - k)) / (R - 1);
    for (let i = 0; i < n; i++) shape.push(at(inside, lineParam.share[i] as number));
  }
  return shape;
}
