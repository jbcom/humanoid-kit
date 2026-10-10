/**
 * The similarity (a turn, one scale and a move) that best carries one set of points
 * onto another, by least squares: Horn's closed form ("Closed-form solution of
 * absolute orientation using unit quaternions", 1987). The turn is the unit
 * quaternion that is the leading eigenvector of a symmetric 4 x 4 matrix built
 * from the two sets' cross-covariance; the scale and the move follow from it.
 */
import type { Vec3 } from "./disc.ts";

/** x' = scale * rotation x + translation, `rotation` row-major. */
export interface Similarity {
  rotation: readonly number[];
  scale: number;
  translation: Vec3;
}

/** Applies a similarity to a point. */
export function applySimilarity(s: Similarity, p: Vec3): Vec3 {
  const r = s.rotation;
  return [0, 1, 2].map(
    (i) =>
      s.scale *
        ((r[i * 3] as number) * p[0] +
          (r[i * 3 + 1] as number) * p[1] +
          (r[i * 3 + 2] as number) * p[2]) +
      (s.translation[i] as number),
  ) as unknown as Vec3;
}

/** The similarity that best takes `from[i]` to `to[i]`. */
export function fitSimilarity(from: readonly Vec3[], to: readonly Vec3[]): Similarity {
  const n = from.length;
  const mean = (ps: readonly Vec3[]): Vec3 =>
    [0, 1, 2].map((k) => ps.reduce((s, p) => s + (p[k] as number), 0) / n) as unknown as Vec3;
  const ca = mean(from);
  const cb = mean(to);
  // S[i][j] = sum of a_i b_j over the centred points.
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let spread = 0;
  for (let p = 0; p < n; p++) {
    const a = [0, 1, 2].map((k) => ((from[p] as Vec3)[k] as number) - (ca[k] as number));
    const b = [0, 1, 2].map((k) => ((to[p] as Vec3)[k] as number) - (cb[k] as number));
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        S[i * 3 + j] = (S[i * 3 + j] as number) + (a[i] as number) * (b[j] as number);
    spread += (a[0] as number) ** 2 + (a[1] as number) ** 2 + (a[2] as number) ** 2;
  }
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const [w, x, y, z] = leadingEigenvector(N) as [number, number, number, number];
  const rotation = [
    w * w + x * x - y * y - z * z,
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    w * w - x * x + y * y - z * z,
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    w * w - x * x - y * y + z * z,
  ];
  // The scale: the turned source's centred points projected on the target's, over their spread.
  let along = 0;
  for (let p = 0; p < n; p++) {
    const a = [0, 1, 2].map((k) => ((from[p] as Vec3)[k] as number) - (ca[k] as number));
    for (let i = 0; i < 3; i++) {
      const ra =
        (rotation[i * 3] as number) * (a[0] as number) +
        (rotation[i * 3 + 1] as number) * (a[1] as number) +
        (rotation[i * 3 + 2] as number) * (a[2] as number);
      along += ra * (((to[p] as Vec3)[i] as number) - (cb[i] as number));
    }
  }
  const scale = along / spread;
  const turned = applySimilarity({ rotation, scale, translation: [0, 0, 0] }, ca);
  return {
    rotation,
    scale,
    translation: [cb[0] - turned[0], cb[1] - turned[1], cb[2] - turned[2]],
  };
}

/**
 * The rigid motion (a turn and a move, scale 1) that best carries `from[i]` to
 * `to[i]`: the similarity's turn (Horn's turn does not depend on the scale), and the
 * move that then takes the one set's centroid to the other's.
 */
export function fitRigid(from: readonly Vec3[], to: readonly Vec3[]): Similarity {
  const { rotation } = fitSimilarity(from, to);
  const n = from.length;
  const mean = (ps: readonly Vec3[]): Vec3 =>
    [0, 1, 2].map((k) => ps.reduce((s, p) => s + (p[k] as number), 0) / n) as unknown as Vec3;
  const cb = mean(to);
  const turned = applySimilarity({ rotation, scale: 1, translation: [0, 0, 0] }, mean(from));
  return {
    rotation,
    scale: 1,
    translation: [cb[0] - turned[0], cb[1] - turned[1], cb[2] - turned[2]],
  };
}

/** The eigenvector of the largest eigenvalue of a symmetric matrix, by cyclic Jacobi rotations. */
function leadingEigenvector(matrix: readonly (readonly number[])[]): number[] {
  const n = matrix.length;
  // Row-major copies: `a` is turned toward diagonal, `v` gathers the turns (its columns the eigenvectors).
  const a = Float64Array.from(matrix.flat());
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  const at = (m: Float64Array, i: number, j: number) => m[i * n + j] as number;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += at(a, p, q) ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = at(a, p, q);
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (at(a, q, q) - at(a, p, p)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = at(a, k, p);
          const akq = at(a, k, q);
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = at(a, p, k);
          const aqk = at(a, q, k);
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = at(v, k, p);
          const vkq = at(v, k, q);
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (at(a, i, i) > at(a, best, best)) best = i;
  return Array.from({ length: n }, (_, k) => at(v, k, best));
}
