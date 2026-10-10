/**
 * The skin near a point, for seating jewellery on it (`jewellery.ts`): the
 * closest point of a body surface to a point, the skin's normal there (its
 * vertex normals blended), and the signed distance, positive outside. Only
 * the triangles near a site are searched. The surface is the figure's morphed
 * control mesh for the body's own sites, its evaluated adult surface for the
 * adult anatomy's.
 */
import type { Vec3 } from "../presence/presence.ts";

/** A body surface's triangles within reach of a site. */
export interface SkinPatch {
  positions: Float32Array;
  /** Vertex normals, of any length: blended across a triangle, then normalised. */
  normals: Float32Array;
  /** The triangles near the site, three vertex indices each. */
  triangles: number[];
}

const quadTriangleCache = new WeakMap<Uint32Array, Uint32Array>();

/** A quad mesh's corners as triangles, two per quad (cached per array). */
export function quadTriangles(faceVerts: Uint32Array): Uint32Array {
  const known = quadTriangleCache.get(faceVerts);
  if (known) return known;
  const out = new Uint32Array((faceVerts.length / 4) * 6);
  for (let f = 0; f < faceVerts.length / 4; f++) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => faceVerts[f * 4 + k] as number) as [
      number,
      number,
      number,
      number,
    ];
    out.set([a, b, c, a, c, d], f * 6);
  }
  quadTriangleCache.set(faceVerts, out);
  return out;
}

/** The triangles of `index` (three vertex indices each) with a corner within `radius` of `centre`. */
export function skinNear(
  positions: Float32Array,
  normals: Float32Array,
  index: ArrayLike<number>,
  centre: Vec3,
  radius: number,
): SkinPatch {
  const triangles: number[] = [];
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const v = index[t + k] as number;
      const d = Math.hypot(
        (positions[v * 3] as number) - centre[0],
        (positions[v * 3 + 1] as number) - centre[1],
        (positions[v * 3 + 2] as number) - centre[2],
      );
      if (d <= radius) {
        triangles.push(index[t] as number, index[t + 1] as number, index[t + 2] as number);
        break;
      }
    }
  return { positions, normals, triangles };
}

const sub = (x: Vec3, y: Vec3): Vec3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
const dot = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];

/** The closest point on triangle abc to p, as barycentric weights (Ericson, Real-Time Collision Detection 5.1.5). */
function closestWeights(p: Vec3, a: Vec3, b: Vec3, c: Vec3): [number, number, number] {
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

/** The skin closest to `p`: that point, the skin's unit normal there, and `p`'s signed distance (positive outside). */
export function closestSkin(
  patch: SkinPatch,
  p: Vec3,
): { point: Vec3; normal: Vec3; distance: number } {
  const { positions: P, normals: N, triangles } = patch;
  const at = (a: Float32Array, v: number): Vec3 => [
    a[v * 3] as number,
    a[v * 3 + 1] as number,
    a[v * 3 + 2] as number,
  ];
  let best = Number.POSITIVE_INFINITY;
  let point: Vec3 = [0, 0, 0];
  let normal: Vec3 = [0, 0, 1];
  for (let t = 0; t < triangles.length; t += 3) {
    const vs = [triangles[t], triangles[t + 1], triangles[t + 2]] as [number, number, number];
    const w = closestWeights(p, at(P, vs[0]), at(P, vs[1]), at(P, vs[2]));
    const blend = (a: Float32Array) =>
      [0, 1, 2].map((d) =>
        vs.reduce((s, v, n) => s + (a[v * 3 + d] as number) * (w[n] as number), 0),
      ) as Vec3;
    const c = blend(P);
    const dist = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    if (dist < best) {
      best = dist;
      point = c;
      const n = blend(N);
      const l = Math.hypot(...n) || 1;
      normal = [n[0] / l, n[1] / l, n[2] / l];
    }
  }
  const side = dot(sub(p, point), normal) >= 0 ? 1 : -1;
  return { point, normal, distance: side * best };
}
