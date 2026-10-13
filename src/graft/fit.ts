/**
 * The similarity fit of a graft (docs/GRAFT.md, "The fit"): the scale,
 * rotation and translation that carry one point set onto another in the
 * least-squares sense (Umeyama 1991), its rotation found by Horn's (1987)
 * quaternion method.
 */
import type { Vec3 } from "./types.ts";

export type Quat = [number, number, number, number];

/** Eigenvectors of a symmetric 4×4 matrix (row-major) by cyclic Jacobi: the one of the largest eigenvalue. */
function largestEigenvector(m: Float64Array): Quat {
  const a = Float64Array.from(m);
  const v = new Float64Array(16);
  for (let i = 0; i < 4; i++) v[i * 4 + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) off += (a[p * 4 + q] as number) ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        const apq = a[p * 4 + q] as number;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = ((a[q * 4 + q] as number) - (a[p * 4 + p] as number)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k * 4 + p] as number;
          const akq = a[k * 4 + q] as number;
          a[k * 4 + p] = c * akp - s * akq;
          a[k * 4 + q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p * 4 + k] as number;
          const aqk = a[q * 4 + k] as number;
          a[p * 4 + k] = c * apk - s * aqk;
          a[q * 4 + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k * 4 + p] as number;
          const vkq = v[k * 4 + q] as number;
          v[k * 4 + p] = c * vkp - s * vkq;
          v[k * 4 + q] = s * vkp + c * vkq;
        }
      }
  }
  let best = 0;
  for (let i = 1; i < 4; i++)
    if ((a[i * 4 + i] as number) > (a[best * 4 + best] as number)) best = i;
  // Horn's matrix is over (w, x, y, z); the result is xyzw.
  const w = v[best] as number;
  const x = v[4 + best] as number;
  const y = v[8 + best] as number;
  const z = v[12 + best] as number;
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/** `q` applied to `p`. */
export function rotate(q: Quat, p: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const [px, py, pz] = p;
  // t = 2 q.xyz × p; p' = p + w t + q.xyz × t
  const tx = 2 * (y * pz - z * py);
  const ty = 2 * (z * px - x * pz);
  const tz = 2 * (x * py - y * px);
  return [
    px + w * tx + (y * tz - z * ty),
    py + w * ty + (z * tx - x * tz),
    pz + w * tz + (x * ty - y * tx),
  ];
}

export interface Similarity {
  scale: number;
  rotation: Quat;
  translation: Vec3;
}

/**
 * The similarity carrying `from[i]` onto `to[i]` (xyz each, the same count)
 * with the least squared error: `to ≈ scale · rotation(from) + translation`.
 */
export function similarityFit(from: ArrayLike<number>, to: ArrayLike<number>): Similarity {
  const n = from.length / 3;
  const mean = (p: ArrayLike<number>, k: number): number => {
    let s = 0;
    for (let i = 0; i < n; i++) s += p[i * 3 + k] as number;
    return s / n;
  };
  const cf: Vec3 = [mean(from, 0), mean(from, 1), mean(from, 2)];
  const ct: Vec3 = [mean(to, 0), mean(to, 1), mean(to, 2)];
  // The cross-covariance S[a][b] = Σ from'_a to'_b, and the spread of `from`.
  const S = new Float64Array(9);
  let spread = 0;
  for (let i = 0; i < n; i++)
    for (let a = 0; a < 3; a++) {
      const fa = (from[i * 3 + a] as number) - (cf[a] as number);
      spread += fa * fa;
      for (let b = 0; b < 3; b++)
        S[a * 3 + b] =
          (S[a * 3 + b] as number) + fa * ((to[i * 3 + b] as number) - (ct[b] as number));
    }
  const s = (a: number, b: number) => S[a * 3 + b] as number;
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = [
    s(0, 0),
    s(0, 1),
    s(0, 2),
    s(1, 0),
    s(1, 1),
    s(1, 2),
    s(2, 0),
    s(2, 1),
    s(2, 2),
  ];
  const N = Float64Array.from([
    xx + yy + zz,
    yz - zy,
    zx - xz,
    xy - yx,
    yz - zy,
    xx - yy - zz,
    xy + yx,
    zx + xz,
    zx - xz,
    xy + yx,
    -xx + yy - zz,
    yz + zy,
    xy - yx,
    zx + xz,
    yz + zy,
    -xx - yy + zz,
  ]);
  const rotation = largestEigenvector(N);
  let dot = 0;
  for (let i = 0; i < n; i++) {
    const r = rotate(rotation, [
      (from[i * 3] as number) - cf[0],
      (from[i * 3 + 1] as number) - cf[1],
      (from[i * 3 + 2] as number) - cf[2],
    ]);
    for (let k = 0; k < 3; k++)
      dot += (r[k] as number) * ((to[i * 3 + k] as number) - (ct[k] as number));
  }
  const scale = spread > 0 ? dot / spread : 1;
  const rc = rotate(rotation, cf);
  return {
    scale,
    rotation,
    translation: [ct[0] - scale * rc[0], ct[1] - scale * rc[1], ct[2] - scale * rc[2]],
  };
}
