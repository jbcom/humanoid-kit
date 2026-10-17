/**
 * The choices the smooth-loop generator (`smoothLoop.ts`) makes between candidates
 * that can score the same: which triangle of the disc map holds a point, which
 * triangle of the surface a point is nearest, where on the circle an angle begins.
 *
 * The map is mirror-symmetric on the body's midline, so a point it is asked about
 * often lands exactly on an edge between two triangles, or on the axis the angles are
 * counted from. There the candidates tie in exact arithmetic, and which of them a
 * comparison picked was decided by the last bits of the score: `Math.sin`, `cos`,
 * `atan2` and the rest are not correctly rounded and differ between the arm64 Mac that
 * makes the adult pack and the x86-64 machines that verify it (issue #138), and the
 * disc map is a linear solve to a residual of 1e-12. A last bit must never decide.
 *
 * Every choice here is therefore made the same way: candidates whose scores are within
 * a stated tolerance of the best are tied, and the tie goes to the lowest index, a
 * key that is an integer and the same everywhere. The tolerances are far above the
 * noise (1e-12 at the worst, the solver's residual) and far below any real geometry
 * (a tenth of a micrometre on a lattice whose edges are 1.6 to 2 mm), so no choice
 * between candidates that really differ is changed, and none of the choices that are
 * ties can be broken by a rounding.
 */
import type { Vec3 } from "./disc.ts";

/** How far outside a triangle (in barycentric weight, the disc being of radius 1) a point still counts as on it. */
export const BARYCENTRIC_TIE = 1e-9;
/** How much farther from a point (metres) a triangle may be than the nearest and still tie with it. */
export const DISTANCE_TIE = 1e-9;
/** How far apart (radians) two angles round the disc may be and still be the same. */
export const ANGLE_TIE = 1e-9;

/** A point on a triangle: the triangle, and its corners' weights. */
export interface OnTriangle {
  tri: number;
  w: number[];
}

/**
 * The triangle of a map (the corner points of triangle `t` in the plane, from `corners`)
 * that holds the point `(x, y)`, with the point's weights on its corners: the lowest
 * triangle (of those `allowed` admits) that the point lies on within `BARYCENTRIC_TIE`
 * of, so a point on an edge between two belongs to the one first in the list whichever
 * way a rounding leans. A point outside every triangle, as on the chords of the circle,
 * is on the nearest, ties again to the lowest, and its weights are clamped to the triangle
 * (unless `clamp` is off, which keeps them affine: a point read across a seam is taken as
 * the extension of the triangle past its edge).
 */
export function triangleHolding(
  count: number,
  corners: (t: number) => readonly [number, number, number, number, number, number],
  x: number,
  y: number,
  allowed: (t: number) => boolean = () => true,
  clamp = true,
): OnTriangle | undefined {
  let best = -1;
  let bestW: number[] = [1, 0, 0];
  let bestOut = Number.POSITIVE_INFINITY;
  for (let t = 0; t < count; t++) {
    if (!allowed(t)) continue;
    const [ax, ay, bx, by, cx, cy] = corners(t);
    const v0x = bx - ax;
    const v0y = by - ay;
    const v1x = cx - ax;
    const v1y = cy - ay;
    const den = v0x * v1y - v1x * v0y;
    const s = ((x - ax) * v1y - v1x * (y - ay)) / den;
    const r = (v0x * (y - ay) - (x - ax) * v0y) / den;
    const w = [1 - s - r, s, r];
    const out = -Math.min(...w);
    if (best < 0 || out < bestOut - BARYCENTRIC_TIE) {
      bestOut = out;
      best = t;
      bestW = w;
      if (out <= BARYCENTRIC_TIE) break;
    }
  }
  if (best < 0) return undefined;
  if (!clamp) return { tri: best, w: bestW };
  const clamped = bestW.map((v) => Math.max(0, v));
  const sum = clamped.reduce((s, v) => s + v, 0);
  return { tri: best, w: clamped.map((v) => v / sum) };
}

/** The point of triangle `a b c` nearest `p`, as weights on its corners (Ericson, 5.1.5). */
export function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number[] {
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
 * The triangle of a surface nearest `p`, and the point of it that is: the lowest
 * triangle whose nearest point is within `DISTANCE_TIE` of the least distance. A point
 * nearest an edge or a corner shared by triangles is as near on each of them, and
 * belongs to the first.
 */
export function nearestTriangle(
  p: Vec3,
  count: number,
  corner: (t: number, k: number) => Vec3,
): OnTriangle {
  const distance = new Float64Array(count);
  const weights: number[][] = [];
  let least = Number.POSITIVE_INFINITY;
  for (let t = 0; t < count; t++) {
    const a = corner(t, 0);
    const b = corner(t, 1);
    const c = corner(t, 2);
    const w = closestOnTriangle(p, a, b, c);
    weights.push(w);
    const [wa, wb, wc] = w as [number, number, number];
    const d = Math.hypot(
      wa * a[0] + wb * b[0] + wc * c[0] - p[0],
      wa * a[1] + wb * b[1] + wc * c[1] - p[1],
      wa * a[2] + wb * b[2] + wc * c[2] - p[2],
    );
    distance[t] = d;
    if (d < least) least = d;
  }
  for (let t = 0; t < count; t++)
    if ((distance[t] as number) <= least + DISTANCE_TIE)
      return { tri: t, w: weights[t] as number[] };
  return { tri: 0, w: [1, 0, 0] };
}

/**
 * The angle of `(x, y)` round the disc, in [0, 2π). A point on the axis angles are
 * counted from has an angle of 0, not a hair under a whole turn: a vertex the mirror
 * symmetry puts exactly there lands on either side of it by a rounding.
 */
export function discAngle(x: number, y: number): number {
  const a = Math.atan2(y, x);
  if (a >= 0) return a;
  return a > -ANGLE_TIE ? 0 : a + 2 * Math.PI;
}
