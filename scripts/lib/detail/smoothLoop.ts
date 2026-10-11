/**
 * A reservoir's patch (src/build/patches.ts): the band of polygons along its
 * footprint's boundary remeshed so that its loop is a smooth edge loop
 * (docs/ARCHITECTURE.md, "The adult surface", "Patches").
 *
 * A footprint found from a sculpt's cut is whole refinement polygons, so its
 * boundary is a staircase. The reservoir's first ring is drawn on a smooth line just
 * inside it, and the strip of skin between the two was a row of thin teeth, each
 * leaning its own way, which shaded as a fringe round a small shaft's root and a sac's
 * corners. Neither normals nor spacing could hide it: it was the staircase.
 *
 * The footprint and the ring of polygons round it are mapped to a disc
 * (`meanValueDisc`, the outer staircase on the circle by arclength). In the disc the
 * new loop is a smooth curve near where the footprint's boundary lies, one vertex per
 * old loop vertex at even angles. The polygons that touched the old loop, inside and
 * out, are replaced by two strips of triangles: one from the outer staircase to the
 * new loop, skin that never moves, and one from the new loop to the polygons inside,
 * which join the cap. Both staircases are kept, so the patch meets the polygons round
 * it edge for edge, and only the loop is new. Each of its vertices starts at the point
 * of the surface at its disc place and is then faired along the loop on the surface
 * itself (`fairOnSurface`), the map to the disc being too uneven over a staircase's
 * polygons to carry a loop smooth at a millimetre's spacing; each ends an affine
 * combination of the corners of the triangle it lies on, and so is its UV.
 */
import type { AdultSurfacePatch } from "../../../src/format/assetFormat.ts";
import type { AdultDetailLattice } from "../../../src/model/humanoidModel.ts";
import type { Disc, Vec3 } from "./disc.ts";
import type { SculptPart } from "./sculpt.ts";
import { meanValueDisc } from "./transfer.ts";

/** How far round the disc (radians, one standard deviation) the old loop's radius is averaged. */
const LOOP_SMOOTHING = 0.3;
/** The least share of the way from the inner staircase to the outer one the loop keeps from each. */
const LOOP_ROOM = 0.25;
/** Loop vertices each side of one over which its bounds are made smooth (`loopBounds`). */
const BOUND_WINDOW = 2;
/** Taubin's passes over the loop on the surface (`fairOnSurface`), and the two steps of each. */
const FAIR_PASSES = 10;
const FAIR_STEP = 0.5;
const FAIR_BACK = -0.53;

/** A point of a curve in the disc: its angle and radius. */
interface Polar {
  a: number;
  r: number;
}

/** A closed curve's radius in the disc at an angle, between the two of its points either side. */
function radiusOn(curve: readonly Polar[], angle: number): number {
  const pts = [...curve].sort((p, q) => p.a - q.a);
  let hi = pts.findIndex((p) => p.a >= angle);
  if (hi < 0) hi = 0;
  const p = pts[(hi + pts.length - 1) % pts.length] as Polar;
  const q = pts[hi] as Polar;
  let span = q.a - p.a;
  let off = angle - p.a;
  if (span <= 0) span += 2 * Math.PI;
  if (off < 0) off += 2 * Math.PI;
  return p.r + (q.r - p.r) * Math.min(1, off / span);
}

/** A point on a triangle: the triangle, and its corners' weights. */
interface OnTriangle {
  tri: number;
  w: number[];
}

/** The point of triangle `a b c` nearest `p`, as weights on its corners (Ericson, 5.1.5). */
function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number[] {
  const sub = (x: Vec3, y: Vec3): Vec3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const dot = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [0, 1 - w, w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return [1 - v - w, v, w];
}

/**
 * A closed curve of points on a surface of triangles made smooth on the surface itself:
 * Taubin's passes (a step toward the midpoint of each point's neighbours, then a slightly
 * larger one back, so the curve does not shrink), each point put back on the nearest
 * triangle after every step. Placed from the disc alone, the sac's loop zigzagged by
 * fractions of a millimetre wherever it crossed from one of the region's polygons to
 * the next, as the map squeezes a staircase's polygons into slivers; a millimetre
 * apart, its vertices turned by up to 126 degrees from one to the next.
 */
function fairOnSurface(
  start: readonly OnTriangle[],
  triangleCount: number,
  corner: (t: number, k: number) => Vec3,
): OnTriangle[] {
  const pointOf = ({ tri, w }: OnTriangle): Vec3 => {
    const [a, b, c] = [0, 1, 2].map((k) => corner(tri, k)) as [Vec3, Vec3, Vec3];
    const [wa, wb, wc] = w as [number, number, number];
    return [
      wa * a[0] + wb * b[0] + wc * c[0],
      wa * a[1] + wb * b[1] + wc * c[1],
      wa * a[2] + wb * b[2] + wc * c[2],
    ];
  };
  const nearest = (p: Vec3): OnTriangle => {
    let best: OnTriangle = { tri: 0, w: [1, 0, 0] };
    let bestD = Number.POSITIVE_INFINITY;
    for (let t = 0; t < triangleCount; t++) {
      const w = closestOnTriangle(p, corner(t, 0), corner(t, 1), corner(t, 2));
      const q = pointOf({ tri: t, w });
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { tri: t, w };
      }
    }
    return best;
  };
  const n = start.length;
  let on = [...start];
  for (let pass = 0; pass < FAIR_PASSES; pass++)
    for (const factor of [FAIR_STEP, FAIR_BACK]) {
      const pts = on.map(pointOf);
      on = pts.map((p, j) => {
        const a = pts[(j + n - 1) % n] as Vec3;
        const b = pts[(j + 1) % n] as Vec3;
        return nearest(
          [0, 1, 2].map(
            (i) =>
              (p[i] as number) +
              factor * (((a[i] as number) + (b[i] as number)) / 2 - (p[i] as number)),
          ) as unknown as Vec3,
        );
      });
    }
  return on;
}

/**
 * The least and most radius the new loop may take at each of `angles` (even round the
 * disc), keeping `LOOP_ROOM` of the way clear of the inner staircase and the outer one.
 * Each is the strictest that any staircase point near the angle asks, then the strictest
 * over the angles beside it, averaged over them again: smooth, and still at least as
 * strict as each angle's own. Read off the staircase between its points, a bound jumped
 * by a tenth of the band where a stair's corner reached in between two angles, and the
 * loop, held to it along a sac's corners, started out as jagged as the staircase.
 */
function loopBounds(
  angles: readonly number[],
  inner: readonly Polar[],
  outer: readonly Polar[],
): { lo: number; hi: number }[] {
  const n = angles.length;
  const step = (2 * Math.PI) / n;
  const gap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  /** A closed curve's radius at an angle, and its points' within a step of it. */
  const near = (curve: readonly Polar[], angle: number) => [
    radiusOn(curve, angle),
    ...curve.filter((o) => gap(o.a, angle) < step).map((o) => o.r),
  ];
  const own = angles.map((angle) => {
    const lo = Math.max(...near(inner, angle));
    const hi = Math.min(...near(outer, angle));
    const room = LOOP_ROOM * (hi - lo);
    return { lo: lo + room, hi: hi - room };
  });
  const around = (values: readonly number[], j: number, pick: (xs: number[]) => number) =>
    pick(
      Array.from(
        { length: 2 * BOUND_WINDOW + 1 },
        (_, d) => values[(((j + d - BOUND_WINDOW) % n) + n) % n] as number,
      ),
    );
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const smooth = (values: readonly number[], strictest: (xs: number[]) => number) => {
    const widest = values.map((_, j) => around(values, j, strictest));
    return widest.map((_, j) => around(widest, j, mean));
  };
  const lo = smooth(
    own.map((b) => b.lo),
    (xs) => Math.max(...xs),
  );
  const hi = smooth(
    own.map((b) => b.hi),
    (xs) => Math.min(...xs),
  );
  return lo.map((l, j) => {
    const h = hi[j] as number;
    if (l > h)
      throw new Error(
        `smooth loop: the band is too narrow for a smooth loop at angle ${angles[j]}`,
      );
    return { lo: l, hi: h };
  });
}

/** A closed boundary of some polygons, in their winding, and which polygon owns each edge. */
function boundaryOf(polygons: readonly (readonly number[])[]): number[] {
  const directed = new Set<string>();
  for (const c of polygons)
    c.forEach((a, k) => {
      directed.add(`${a}:${c[(k + 1) % c.length]}`);
    });
  const next = new Map<number, number>();
  for (const e of directed) {
    const [a, b] = e.split(":").map(Number) as [number, number];
    if (directed.has(`${b}:${a}`)) continue;
    if (next.has(a)) throw new Error(`smooth loop: a boundary pinches at vertex ${a}`);
    next.set(a, b);
  }
  const start = Math.min(...next.keys());
  const loop: number[] = [];
  for (let v = start; ; ) {
    loop.push(v);
    v = next.get(v) as number;
    if (v === start) break;
    if (loop.length > next.size) throw new Error("smooth loop: a boundary is not one loop");
  }
  if (loop.length !== next.size)
    throw new Error("smooth loop: a region has more than one boundary");
  return loop;
}

/**
 * A strip of triangles between an outer and an inner closed curve, both running
 * counter-clockwise at increasing angles round the disc: each step takes the next
 * point of whichever curve comes first, so the strip winds as its polygons do.
 */
function strip(
  outerCurve: readonly number[],
  outerAngle: (i: number) => number,
  innerCurve: readonly number[],
  innerAngle: (j: number) => number,
  length: (a: number, b: number) => number,
): number[][] {
  /** A curve from its point at the least angle, its angles carried on past a whole turn where they wrap. */
  const unwrap = (curve: readonly number[], angle: (i: number) => number) => {
    const k = curve.length;
    let first = 0;
    for (let i = 1; i < k; i++) if (angle(i) < angle(first)) first = i;
    const points = Array.from({ length: k }, (_, i) => curve[(first + i) % k] as number);
    const angles: number[] = [];
    for (let i = 0; i < k; i++) {
      let x = angle((first + i) % k);
      while (i > 0 && x < (angles[i - 1] as number) - Math.PI) x += 2 * Math.PI;
      angles.push(x);
    }
    return { points, angles };
  };
  const o = unwrap(outerCurve, outerAngle);
  const p = unwrap(innerCurve, innerAngle);
  const outer = o.points;
  const inner = p.points;
  const m = outer.length;
  const n = inner.length;
  const a = (i: number) =>
    (o.angles[((i % m) + m) % m] as number) + 2 * Math.PI * Math.floor(i / m);
  const b = (j: number) =>
    (p.angles[((j % n) + n) % n] as number) + 2 * Math.PI * Math.floor(j / n);
  // The inner point just before the outer curve's first.
  let j0 = 0;
  while (b(j0) > a(0)) j0--;
  while (b(j0 + 1) <= a(0)) j0++;
  const out: number[][] = [];
  let i = 0;
  let j = j0;
  while (i < m || j < j0 + n) {
    const o = outer[((i % m) + m) % m] as number;
    const q = inner[((j % n) + n) % n] as number;
    // Of the two triangles that could come next, the one with the shorter new edge (the
    // shortest diagonal), unless one curve has run more than a step ahead round the disc.
    const o1 = outer[(((i + 1) % m) + m) % m] as number;
    const q1 = inner[(((j + 1) % n) + n) % n] as number;
    const ahead = a(i + 1) > b(j + 1) ? b(j + 2) < a(i + 1) : a(i + 2) < b(j + 1);
    const byAngle = a(i + 1) <= b(j + 1);
    const outerNext = j >= j0 + n || (i < m && (ahead ? byAngle : length(o1, q) <= length(o, q1)));
    if (outerNext) {
      out.push([o, outer[(((i + 1) % m) + m) % m] as number, q]);
      i++;
    } else {
      out.push([inner[(((j + 1) % n) + n) % n] as number, q, o]);
      j++;
    }
  }
  return out;
}

/** A patch for the footprint `disc` on `lattice`: its new loop (new vertex ids) and the cap's vertices inside it. */
export function smoothLoopPatch(
  lattice: Pick<AdultDetailLattice, "polygons" | "latticePositions" | "uvCount">,
  disc: Disc,
): { patch: AdultSurfacePatch; loop: number[]; capVertices: number[] } {
  const L = lattice.polygons;
  const P = lattice.latticePositions;
  const at = (v: number): Vec3 => [
    P[v * 3] as number,
    P[v * 3 + 1] as number,
    P[v * 3 + 2] as number,
  ];
  const len = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const corners = (p: number) =>
    Array.from(L.vertices.subarray(L.start[p] as number, L.start[p + 1] as number));
  const cornerUvs = (p: number) =>
    Array.from(L.uvs.subarray(L.start[p] as number, L.start[p + 1] as number));
  const cap = new Set(disc.cap);
  const oldLoop = new Set(disc.loop);
  // The region mapped to the disc: the footprint and every polygon touching its loop;
  // of it, the band that touches the loop is replaced and the footprint's inside kept.
  const region: number[] = [];
  const band: number[] = [];
  const inside: number[] = [];
  for (let p = 0; p < L.id.length; p++) {
    const touches = corners(p).some((v) => oldLoop.has(v));
    if (touches) band.push(p);
    else if (cap.has(L.id[p] as number)) inside.push(p);
    else continue;
    region.push(p);
  }
  if (!inside.length) throw new Error("smooth loop: the footprint has no polygons inside its band");
  // The region's UV charts: polygons joined across an edge whose two ends have the same
  // UV entries on both sides. A region on the midline of the crotch crosses the seam
  // between the body's halves, so a vertex on it has an entry in each chart.
  const chartOf = new Map<number, number>();
  {
    const edgeUv = new Map<string, { p: number; a: number; b: number }[]>();
    for (const p of region) {
      const c = corners(p);
      const u = cornerUvs(p);
      c.forEach((v, k) => {
        const w = c[(k + 1) % c.length] as number;
        const key = v < w ? `${v}:${w}` : `${w}:${v}`;
        const uvA = (v < w ? u[k] : u[(k + 1) % c.length]) as number;
        const uvB = (v < w ? u[(k + 1) % c.length] : u[k]) as number;
        const list = edgeUv.get(key);
        if (list) list.push({ p, a: uvA, b: uvB });
        else edgeUv.set(key, [{ p, a: uvA, b: uvB }]);
      });
    }
    const joined = new Map<number, number[]>();
    for (const list of edgeUv.values())
      for (const x of list)
        for (const y of list)
          if (x.p !== y.p && x.a === y.a && x.b === y.b)
            joined.set(x.p, [...(joined.get(x.p) ?? []), y.p]);
    let charts = 0;
    for (const p of region) {
      if (chartOf.has(p)) continue;
      const stack = [p];
      chartOf.set(p, charts);
      while (stack.length) {
        const q = stack.pop() as number;
        for (const r of joined.get(q) ?? [])
          if (!chartOf.has(r)) {
            chartOf.set(r, charts);
            stack.push(r);
          }
      }
      charts++;
    }
  }
  /** Each vertex's UV entry in each chart it is in. */
  const uvIn = new Map<string, number>();
  const chartsOfVertex = new Map<number, Set<number>>();
  for (const p of region)
    corners(p).forEach((v, k) => {
      const chart = chartOf.get(p) as number;
      uvIn.set(`${v}:${chart}`, cornerUvs(p)[k] as number);
      const s = chartsOfVertex.get(v) ?? new Set<number>();
      s.add(chart);
      chartsOfVertex.set(v, s);
    });
  // The region's surface, fanned into triangles, and its map to the disc.
  const local = new Map<number, number>();
  const ids: number[] = [];
  const localOf = (v: number) => {
    let i = local.get(v);
    if (i === undefined) {
      i = ids.length;
      local.set(v, i);
      ids.push(v);
    }
    return i;
  };
  const triangles: number[] = [];
  const triPolygon: number[] = [];
  for (const p of region) {
    const c = corners(p).map(localOf);
    for (let k = 1; k + 1 < c.length; k++) {
      triangles.push(c[0] as number, c[k] as number, c[k + 1] as number);
      triPolygon.push(p);
    }
  }
  const outer = boundaryOf(region.map(corners));
  const steps = outer.map((v, i) => len(at(v), at(outer[(i + 1) % outer.length] as number)));
  const total = steps.reduce((s, x) => s + x, 0);
  const share = new Map<number, number>();
  let run = 0;
  outer.forEach((v, i) => {
    share.set(localOf(v), run / total);
    run += steps[i] as number;
  });
  const part: SculptPart = {
    positions: Float64Array.from(ids.flatMap((v) => at(v))),
    triangles: Uint32Array.from(triangles),
    boundary: outer.map(localOf),
  };
  const uv = meanValueDisc(part, share);
  const discOf = (v: number): [number, number] => {
    const i = local.get(v) as number;
    return [uv[i * 2] as number, uv[i * 2 + 1] as number];
  };
  const angleOf = (v: number) => {
    const [x, y] = discOf(v);
    const a = Math.atan2(y, x);
    return a < 0 ? a + 2 * Math.PI : a;
  };
  const radiusOf = (v: number) => Math.hypot(...discOf(v));
  // The staircase inside the band, the boundary of the polygons kept in the cap.
  const innerStair = boundaryOf(inside.map(corners));
  // The new loop: one vertex per old one, at even angles, at the old loop's radius
  // averaged over the angles near it, kept clear of both staircases.
  const n = disc.loop.length;
  const old = disc.loop.map((v) => ({ a: angleOf(v), r: radiusOf(v) }));
  const angles = Array.from({ length: n }, (_, j) => (2 * Math.PI * (j + 0.5)) / n);
  const bounds = loopBounds(
    angles,
    innerStair.map((v) => ({ a: angleOf(v), r: radiusOf(v) })),
    outer.map((v) => ({ a: angleOf(v), r: radiusOf(v) })),
  );
  const radii = angles.map((angle, j) => {
    const near = old.map((o) => {
      const d = Math.atan2(Math.sin(o.a - angle), Math.cos(o.a - angle));
      return { r: o.r, w: Math.exp(-0.5 * (d / LOOP_SMOOTHING) ** 2) };
    });
    const weight = near.reduce((s, o) => s + o.w, 0);
    const mean = near.reduce((s, o) => s + o.w * o.r, 0) / weight;
    // The staircase's inner side: the steps that reach in past the mean count, those out
    // past it count at the mean. The skin line was drawn inside the staircase's inner
    // corners, and a loop at the staircase's middle widened the attachment by 0.7 mm.
    const inner = near.reduce((s, o) => s + o.w * Math.min(o.r, mean), 0) / weight;
    const { lo, hi } = bounds[j] as { lo: number; hi: number };
    return Math.min(hi, Math.max(lo, inner));
  });
  // Each loop vertex: the point of the region's triangle that holds its disc place.
  const locate = (x: number, y: number) => {
    let best = 0;
    let bestW: number[] = [1, 0, 0];
    let bestOut = Number.POSITIVE_INFINITY;
    for (let t = 0; t < triangles.length / 3; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => triangles[t * 3 + k] as number) as [
        number,
        number,
        number,
      ];
      const ax = uv[a * 2] as number;
      const ay = uv[a * 2 + 1] as number;
      const v0x = (uv[b * 2] as number) - ax;
      const v0y = (uv[b * 2 + 1] as number) - ay;
      const v1x = (uv[c * 2] as number) - ax;
      const v1y = (uv[c * 2 + 1] as number) - ay;
      const den = v0x * v1y - v1x * v0y;
      const s = ((x - ax) * v1y - v1x * (y - ay)) / den;
      const r = (v0x * (y - ay) - (x - ax) * v0y) / den;
      const w = [1 - s - r, s, r];
      const out = -Math.min(...w);
      if (out < bestOut) {
        bestOut = out;
        best = t;
        bestW = w;
        if (out <= 0) break;
      }
    }
    const clamped = bestW.map((v) => Math.max(0, v));
    const sum = clamped.reduce((s, v) => s + v, 0);
    return { tri: best, w: clamped.map((v) => v / sum) };
  };
  // Each loop vertex where its disc place falls on the region, then faired on the
  // surface (`fairOnSurface`), and its place in the disc read back from where it lands.
  const onRegion = fairOnSurface(
    angles.map((angle, j) => {
      const r = radii[j] as number;
      return locate(r * Math.cos(angle), r * Math.sin(angle));
    }),
    triangles.length / 3,
    (t, k) => at(ids[triangles[t * 3 + k] as number] as number),
  );
  const discPlaces = onRegion.map(({ tri, w }): [number, number] => {
    let x = 0;
    let y = 0;
    for (let k = 0; k < 3; k++) {
      const c = triangles[tri * 3 + k] as number;
      x += (w[k] as number) * (uv[c * 2] as number);
      y += (w[k] as number) * (uv[c * 2 + 1] as number);
    }
    return [x, y];
  });
  const loopAngle = (j: number) => {
    const [x, y] = discPlaces[j] as [number, number];
    const a = Math.atan2(y, x);
    return a < 0 ? a + 2 * Math.PI : a;
  };
  // The faired loop must still run round the disc in order, strictly between the staircases.
  const innerPolar = innerStair.map((v) => ({ a: angleOf(v), r: radiusOf(v) }));
  const outerPolar = outer.map((v) => ({ a: angleOf(v), r: radiusOf(v) }));
  discPlaces.forEach(([x, y], j) => {
    const a = loopAngle(j);
    const r = Math.hypot(x, y);
    if (!(r > radiusOn(innerPolar, a) && r < radiusOn(outerPolar, a)))
      throw new Error(`smooth loop: faired loop vertex ${j} left the band between the staircases`);
    const ahead = loopAngle((j + 1) % n) - a;
    const turn = ahead < 0 ? ahead + 2 * Math.PI : ahead;
    if (!(turn > 0 && turn < Math.PI))
      throw new Error(`smooth loop: faired loop vertices ${j} and ${(j + 1) % n} are out of order`);
  });
  const vertices: AdultSurfacePatch["vertices"] = [];
  const uvs: AdultSurfacePatch["uvs"] = [];
  const base = P.length / 3;
  // Six decimals: a micrometre on a ten-centimetre triangle.
  const round6 = (w: readonly number[]) => w.map((x) => Math.round(x * 1e6) / 1e6);
  for (const { tri, w } of onRegion) {
    const c = [0, 1, 2].map((k) => ids[triangles[tri * 3 + k] as number] as number);
    vertices.push({ from: c, weights: round6(w) });
  }
  const loop = angles.map((_, j) => base + j);
  /**
   * A loop vertex's UV entry in a chart, made when first asked for: the combination of
   * the UVs of the triangle it lies on, in its own chart; in the chart across a seam,
   * of the triangle of that chart nearest its place in the disc, extended past its edge
   * (the weights stay affine), so a polygon across the seam reads one chart's UVs.
   */
  const loopUvs = new Map<string, number>();
  const loopUv = (v: number, chart: number): number => {
    const j = v - base;
    const key = `${j}:${chart}`;
    const had = loopUvs.get(key);
    if (had !== undefined) return had;
    const { tri, w } = onRegion[j] as { tri: number; w: number[] };
    let from: number[];
    let weights: number[];
    if (chartOf.get(triPolygon[tri] as number) === chart) {
      from = [0, 1, 2].map((k) => ids[triangles[tri * 3 + k] as number] as number);
      weights = w;
    } else {
      const [x, y] = discPlaces[j] as [number, number];
      let best = -1;
      let bestW: number[] = [];
      let bestOut = Number.POSITIVE_INFINITY;
      for (let t = 0; t < triangles.length / 3; t++) {
        if (chartOf.get(triPolygon[t] as number) !== chart) continue;
        const [a, b, c] = [0, 1, 2].map((k) => triangles[t * 3 + k] as number) as [
          number,
          number,
          number,
        ];
        const ax = uv[a * 2] as number;
        const ay = uv[a * 2 + 1] as number;
        const v0x = (uv[b * 2] as number) - ax;
        const v0y = (uv[b * 2 + 1] as number) - ay;
        const v1x = (uv[c * 2] as number) - ax;
        const v1y = (uv[c * 2 + 1] as number) - ay;
        const den = v0x * v1y - v1x * v0y;
        const s = ((x - ax) * v1y - v1x * (y - ay)) / den;
        const r = (v0x * (y - ay) - (x - ax) * v0y) / den;
        const ww = [1 - s - r, s, r];
        const out = -Math.min(...ww);
        if (out < bestOut) {
          bestOut = out;
          best = t;
          bestW = ww;
        }
      }
      if (best < 0) throw new Error(`smooth loop: no triangle in chart ${chart}`);
      from = [0, 1, 2].map((k) => ids[triangles[best * 3 + k] as number] as number);
      weights = bestW;
    }
    uvs.push({
      from: from.map((u) => uvIn.get(`${u}:${chart}`) as number),
      weights: round6(weights),
    });
    const index = lattice.uvCount + uvs.length - 1;
    loopUvs.set(key, index);
    return index;
  };
  // Each loop vertex's entry in its own chart first, in loop order: a patch on one chart
  // gets the same UV entries, in the same order, as before charts were told apart.
  for (const v of loop)
    loopUv(
      v,
      chartOf.get(triPolygon[(onRegion[v - base] as { tri: number }).tri] as number) as number,
    );
  /** An old vertex's UV entry in a chart, or in its own when it has none in that one. */
  const oldUv = (v: number, chart: number) =>
    uvIn.get(`${v}:${chart}`) ??
    (uvIn.get(`${v}:${[...(chartsOfVertex.get(v) ?? [])][0]}`) as number);
  /** A new polygon, owned by the band polygon under its centre in the disc. */
  const polygons: AdultSurfacePatch["polygons"] = [];
  const place = (v: number): [number, number] => {
    if (v < base) return discOf(v);
    return discPlaces[v - base] as [number, number];
  };
  const bandSet = new Set(band);
  const addPolygon = (vs: number[]) => {
    const pts = vs.map(place);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const under = triPolygon[locate(cx, cy).tri] as number;
    // A centre in a kept polygon (a strip's corner reaching round it) is owned by a band polygon beside it.
    const owner = bandSet.has(under) ? under : (band[0] as number);
    // Its UVs are one chart's: the one every old corner is in, else the chart under its centre.
    const olds = vs.filter((v) => v < base);
    const chart =
      [...new Set(olds.flatMap((v) => [...(chartsOfVertex.get(v) ?? [])]))].find((c) =>
        olds.every((v) => chartsOfVertex.get(v)?.has(c)),
      ) ?? (chartOf.get(under) as number);
    polygons.push({
      vertices: vs,
      uvs: vs.map((v) => (v >= base ? loopUv(v, chart) : oldUv(v, chart))),
      of: L.id[owner] as number,
    });
  };
  /** A vertex's place on the surface: an old one's own, a new one's combination. */
  const where = (v: number): Vec3 => {
    if (v < base) return at(v);
    const c = vertices[v - base] as { from: number[]; weights: number[] };
    return [0, 1, 2].map((k) =>
      c.from.reduce((s, u, i) => s + (c.weights[i] as number) * (at(u)[k] as number), 0),
    ) as unknown as Vec3;
  };
  const distance = (a: number, b: number) => len(where(a), where(b));
  for (const tri of strip(outer, (i) => angleOf(outer[i] as number), loop, loopAngle, distance))
    addPolygon(tri);
  for (const tri of strip(
    loop,
    loopAngle,
    innerStair,
    (i) => angleOf(innerStair[i] as number),
    distance,
  ))
    addPolygon(tri);
  const kept = new Set(inside.flatMap(corners));
  return {
    patch: { remove: band.map((p) => L.id[p] as number), vertices, uvs, polygons },
    loop,
    capVertices: [...kept],
  };
}
