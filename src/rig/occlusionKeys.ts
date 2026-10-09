/**
 * Pose-keyed attachment occlusion (docs/ARCHITECTURE.md, "Attachment
 * occlusion"). A few key poses change what encloses the attachments: the jaw
 * open, the lips apart, a smile. Their effects interact (parted lips uncover
 * the teeth far more with the jaw open), so occlusion is baked at every corner
 * of the key cube, each key either absent or full, and interpolated
 * multilinearly. At run time each key's weight is how much of that key the
 * current pose holds, found by least squares over the bones' rotation vectors,
 * so it works for any pose (face units or animation) and is exact when the
 * pose is a corner.
 */
import { type BoneRotations, faceUnitRotations, type RigData, rotationVectors } from "./pose.ts";

export interface OcclusionKey {
  id: string;
  faceUnits: Readonly<Record<string, number>>;
}

export const OCCLUSION_KEYS: readonly OcclusionKey[] = [
  { id: "jawOpen", faceUnits: { JawDrop: 1 } },
  { id: "lipsApart", faceUnits: { UpperLipUp: 1, lowerLipDown: 1 } },
  { id: "smile", faceUnits: { MouthLeftPullUp: 1, MouthRightPullUp: 1 } },
];

/** Bakes per attachment vertex: one per corner of the key cube; corner 0 is rest. */
export const occlusionCorners = (keys: number) => 2 ** keys;

/** The pose at corner `m`: every key whose bit is set in `m`, at full weight. */
export function occlusionCornerUnits(
  m: number,
  keys: readonly OcclusionKey[] = OCCLUSION_KEYS,
): Record<string, number> {
  const units: Record<string, number> = {};
  keys.forEach((k, i) => {
    if (!(m & (1 << i))) return;
    for (const [u, w] of Object.entries(k.faceUnits)) units[u] = (units[u] ?? 0) + w;
  });
  return units;
}

/** Each corner's multilinear weight for key weights `w` (they sum to 1). */
export function occlusionCornerWeights(w: ArrayLike<number>): Float32Array {
  const out = new Float32Array(occlusionCorners(w.length));
  for (let m = 0; m < out.length; m++) {
    let p = 1;
    for (let i = 0; i < w.length; i++) p *= m & (1 << i) ? (w[i] as number) : 1 - (w[i] as number);
    out[m] = p;
  }
  return out;
}

/** The keys' poses and what solving for their weights needs. */
export interface OcclusionKeyBasis {
  rotations: BoneRotations[];
  /** Per key, the bones' rotation vectors (`bones * 3`). */
  vectors: Float32Array[];
  /** Inverse of the keys' Gram matrix, row-major `K * K`. */
  gramInverse: Float64Array;
}

/** Inverts a small symmetric positive-definite matrix (Gauss–Jordan with pivoting). */
function invert(m: Float64Array, n: number): Float64Array {
  const a = Float64Array.from(m);
  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i++) inv[i * n + i] = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(a[r * n + c] as number) > Math.abs(a[p * n + c] as number)) p = r;
    if (Math.abs(a[p * n + c] as number) < 1e-12)
      throw new Error("occlusion keys are linearly dependent");
    for (let k = 0; k < n; k++) {
      [a[c * n + k], a[p * n + k]] = [a[p * n + k] as number, a[c * n + k] as number];
      [inv[c * n + k], inv[p * n + k]] = [inv[p * n + k] as number, inv[c * n + k] as number];
    }
    const d = a[c * n + c] as number;
    for (let k = 0; k < n; k++) {
      a[c * n + k] = (a[c * n + k] as number) / d;
      inv[c * n + k] = (inv[c * n + k] as number) / d;
    }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r * n + c] as number;
      for (let k = 0; k < n; k++) {
        a[r * n + k] = (a[r * n + k] as number) - f * (a[c * n + k] as number);
        inv[r * n + k] = (inv[r * n + k] as number) - f * (inv[c * n + k] as number);
      }
    }
  }
  return inv;
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
};

export function occlusionKeyBasis(
  rig: RigData,
  keys: readonly OcclusionKey[] = OCCLUSION_KEYS,
): OcclusionKeyBasis {
  const rotations = keys.map((k) => faceUnitRotations(rig, k.faceUnits));
  const vectors = rotations.map(rotationVectors);
  const n = keys.length;
  const gram = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      gram[i * n + j] = dot(vectors[i] as Float32Array, vectors[j] as Float32Array);
  return { rotations, vectors, gramInverse: invert(gram, n) };
}

/** How much of each key `rotations` holds, each clamped to [0, 1]. */
export function occlusionKeyWeights(
  basis: OcclusionKeyBasis,
  rotations: BoneRotations,
  out = new Float32Array(basis.vectors.length),
): Float32Array {
  const r = rotationVectors(rotations);
  const n = basis.vectors.length;
  const b = basis.vectors.map((v) => dot(v, r));
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let j = 0; j < n; j++) c += (basis.gramInverse[i * n + j] as number) * (b[j] as number);
    out[i] = Math.min(1, Math.max(0, c));
  }
  return out;
}
