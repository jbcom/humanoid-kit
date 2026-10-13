/**
 * Rigid garments (docs/ARCHITECTURE.md, "Garments a consumer brings"): a
 * canteen or cartridge box is bound like any garment, then moved as one piece
 * to where its binding put it, so the body's shape places it and never bends
 * it. Pure.
 */

/** A rotation (unit quaternion w, x, y, z) and translation that carry one point set onto another. */
export interface RigidFit {
  rotation: [number, number, number, number];
  translation: [number, number, number];
}

function centroid(p: Float32Array): [number, number, number] {
  const n = p.length / 3;
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (p[i * 3 + k] as number) / n;
  return c;
}

/**
 * The eigenvector of the largest eigenvalue of a symmetric 4×4 matrix (row
 * major), by cyclic Jacobi rotations, which converge for any symmetric matrix.
 */
function topEigenvector(m: number[]): [number, number, number, number] {
  const a = [...m];
  const v = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const A = (i: number, j: number) => a[i * 4 + j] as number;
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += A(i, j) ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        const apq = A(p, q);
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (A(q, q) - A(p, p)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = A(k, p);
          const akq = A(k, q);
          a[k * 4 + p] = c * akp - s * akq;
          a[k * 4 + q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = A(p, k);
          const aqk = A(q, k);
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
  for (let i = 1; i < 4; i++) if (A(i, i) > A(best, best)) best = i;
  return [v[best] as number, v[4 + best] as number, v[8 + best] as number, v[12 + best] as number];
}

/**
 * The rigid motion that best carries `from` onto `to` (equal-length xyz
 * lists) in least squares: Horn's closed form (J Opt Soc Am A 4:629, 1987),
 * the rotation as the top eigenvector of his 4×4 matrix. No scale, so the
 * piece keeps its size.
 */
export function rigidFit(from: Float32Array, to: Float32Array): RigidFit {
  const cf = centroid(from);
  const ct = centroid(to);
  const S = new Array<number>(9).fill(0);
  for (let i = 0; i < from.length / 3; i++)
    for (let r = 0; r < 3; r++) {
      const a = (from[i * 3 + r] as number) - (cf[r] as number);
      for (let c = 0; c < 3; c++)
        S[r * 3 + c] =
          (S[r * 3 + c] as number) + a * ((to[i * 3 + c] as number) - (ct[c] as number));
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
  const [w, x, y, z] = topEigenvector([
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
  const len = Math.hypot(w, x, y, z) || 1;
  const rotation: RigidFit["rotation"] = [w / len, x / len, y / len, z / len];
  const rc = rotate(rotation, cf[0], cf[1], cf[2]);
  return {
    rotation,
    translation: [ct[0] - rc[0], ct[1] - rc[1], ct[2] - rc[2]],
  };
}

function rotate(
  q: RigidFit["rotation"],
  px: number,
  py: number,
  pz: number,
): [number, number, number] {
  const [w, x, y, z] = q;
  const tx = 2 * (y * pz - z * py);
  const ty = 2 * (z * px - x * pz);
  const tz = 2 * (x * py - y * px);
  return [
    px + w * tx + (y * tz - z * ty),
    py + w * ty + (z * tx - x * tz),
    pz + w * tz + (x * ty - y * tx),
  ];
}

/**
 * `from` moved rigidly to where `to` is (`rigidFit`), written into `out`,
 * which may be `to` itself.
 */
export function placeRigid(from: Float32Array, to: Float32Array, out: Float32Array): Float32Array {
  const { rotation, translation } = rigidFit(from, to);
  for (let i = 0; i < from.length / 3; i++) {
    const r = rotate(
      rotation,
      from[i * 3] as number,
      from[i * 3 + 1] as number,
      from[i * 3 + 2] as number,
    );
    for (let k = 0; k < 3; k++) out[i * 3 + k] = (r[k] as number) + (translation[k] as number);
  }
  return out;
}

/**
 * A rigid piece's skin: every vertex takes the one bone that carries the most
 * of the piece's total weight, so a pose moves it as one piece too.
 */
export function rigidSkin(skin: { index: Uint8Array; weight: Float32Array }): {
  index: Uint8Array;
  weight: Float32Array;
} {
  const total = new Map<number, number>();
  for (let i = 0; i < skin.weight.length; i++) {
    const w = skin.weight[i] as number;
    if (w > 0) {
      const bone = skin.index[i] as number;
      total.set(bone, (total.get(bone) ?? 0) + w);
    }
  }
  let bone = 0;
  let most = -1;
  for (const [b, w] of total) if (w > most || (w === most && b < bone)) [bone, most] = [b, w];
  const n = skin.weight.length / 4;
  const index = new Uint8Array(n * 4);
  const weight = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    index[v * 4] = bone;
    weight[v * 4] = 1;
  }
  return { index, weight };
}
