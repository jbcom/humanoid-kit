/**
 * Evaluates MHCLO bindings: places an attachment's vertices on the current
 * (morphed) base mesh. Each vertex is a weighted sum of three base vertices
 * plus an offset whose x, y and z are scaled by how much a reference distance
 * on the body has grown or shrunk since the asset was fitted, so attachments
 * keep their proportions on every body shape.
 */
import type { BoundAsset } from "../format/assetFormat.ts";

const AXES = ["x", "y", "z"] as const;

/** Per-axis offset scale for the given control positions (1 when the asset has no scale references). */
export function bindingScale(asset: BoundAsset, control: Float32Array): [number, number, number] {
  const s = asset.entry.scale;
  if (!s) return [1, 1, 1];
  return AXES.map((axis, i) => {
    const [v1, v2, reference] = s[axis];
    const d = Math.abs((control[v1 * 3 + i] as number) - (control[v2 * 3 + i] as number));
    return reference > 0 ? d / reference : 1;
  }) as [number, number, number];
}

/** Writes the attachment's control positions (`vertexCount * 3`) for the given body control positions. */
export function evaluateBinding(
  asset: BoundAsset,
  control: Float32Array,
  out: Float32Array,
): Float32Array {
  const [sx, sy, sz] = bindingScale(asset, control);
  const { refVerts: r, weights: w, offsets: o } = asset;
  const n = asset.entry.vertexCount;
  for (let v = 0; v < n; v++) {
    const k = v * 3;
    const a = (r[k] as number) * 3;
    const b = (r[k + 1] as number) * 3;
    const c = (r[k + 2] as number) * 3;
    const wa = w[k] as number;
    const wb = w[k + 1] as number;
    const wc = w[k + 2] as number;
    out[k] =
      wa * (control[a] as number) +
      wb * (control[b] as number) +
      wc * (control[c] as number) +
      (o[k] as number) * sx;
    out[k + 1] =
      wa * (control[a + 1] as number) +
      wb * (control[b + 1] as number) +
      wc * (control[c + 1] as number) +
      (o[k + 1] as number) * sy;
    out[k + 2] =
      wa * (control[a + 2] as number) +
      wb * (control[b + 2] as number) +
      wc * (control[c + 2] as number) +
      (o[k + 2] as number) * sz;
  }
  return out;
}

/** Skin weights for an attachment: each vertex blends the weights of its three base vertices; top four kept. */
export function bindingSkin(
  asset: BoundAsset,
  baseIndex: Uint8Array,
  baseWeight: Float32Array,
): { index: Uint8Array; weight: Float32Array } {
  const n = asset.entry.vertexCount;
  const index = new Uint8Array(n * 4);
  const weight = new Float32Array(n * 4);
  const acc = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    acc.clear();
    for (let j = 0; j < 3; j++) {
      const bw = asset.weights[v * 3 + j] as number;
      if (bw === 0) continue;
      const base = asset.refVerts[v * 3 + j] as number;
      for (let k = 0; k < 4; k++) {
        const sw = baseWeight[base * 4 + k] as number;
        if (sw > 0) {
          const bone = baseIndex[base * 4 + k] as number;
          acc.set(bone, (acc.get(bone) ?? 0) + sw * bw);
        }
      }
    }
    const top = [...acc]
      .filter((e) => e[1] > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const sum = top.reduce((t, e) => t + e[1], 0);
    top.forEach(([bone, wt], k) => {
      index[v * 4 + k] = bone;
      weight[v * 4 + k] = sum > 0 ? wt / sum : 0;
    });
  }
  return { index, weight };
}
