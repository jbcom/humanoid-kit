/**
 * Evaluates MHCLO bindings: places an attachment's vertices on the current
 * (morphed) base mesh. Each vertex is a weighted sum of three base vertices
 * plus an offset whose x, y and z are scaled by how much a reference distance
 * on the body has grown or shrunk since the asset was fitted, so attachments
 * keep their proportions on every body shape.
 */
import { type AttachmentEntry, type BoundAsset, SKIN_INFLUENCES } from "../format/assetFormat.ts";
import { addInfluences, writeStrongest } from "../rig/influences.ts";

const AXES = ["x", "y", "z"] as const;

/** What binding reads of a bound mesh: an attachment or a garment. */
export type Bound = Pick<BoundAsset, "refVerts" | "weights" | "offsets"> & {
  entry: Pick<AttachmentEntry, "scale" | "vertexCount">;
};

/** Per-axis offset scale for the given control positions (1 when the asset has no scale references). */
export function bindingScale(asset: Bound, control: Float32Array): [number, number, number] {
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
  asset: Bound,
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

/**
 * Writes an MHCLO attachment with its source-authored free offsets multiplied.
 *
 * Every vertex keeps its three weighted base-mesh anchors, its source topology
 * and its per-axis body-shape scale. The multiplier changes only the original
 * offset from that anchored surface. A factor of one delegates to
 * `evaluateBinding`, preserving its exact default result.
 */
export function evaluateBindingWithOffsetScale(
  asset: Bound,
  control: Float32Array,
  offsetScale: number,
  out: Float32Array,
): Float32Array {
  if (!Number.isFinite(offsetScale) || offsetScale < 1)
    throw new RangeError("MHCLO offset scale must be a finite number at least 1");
  if (offsetScale === 1) return evaluateBinding(asset, control, out);
  const [sx, sy, sz] = bindingScale(asset, control);
  const { refVerts: r, weights: w, offsets: o } = asset;
  const n = asset.entry.vertexCount;
  // This output often is the cached geometry a renderer currently publishes.
  // Preflight every coordinate before writing so a rejected multiplier cannot
  // leave a partly overwritten attachment full of Float32 infinities.
  for (let v = 0; v < n; v++) {
    const k = v * 3;
    const a = (r[k] as number) * 3;
    const b = (r[k + 1] as number) * 3;
    const c = (r[k + 2] as number) * 3;
    const wa = w[k] as number;
    const wb = w[k + 1] as number;
    const wc = w[k + 2] as number;
    const x =
      wa * (control[a] as number) +
      wb * (control[b] as number) +
      wc * (control[c] as number) +
      (o[k] as number) * sx * offsetScale;
    const y =
      wa * (control[a + 1] as number) +
      wb * (control[b + 1] as number) +
      wc * (control[c + 1] as number) +
      (o[k + 1] as number) * sy * offsetScale;
    const z =
      wa * (control[a + 2] as number) +
      wb * (control[b + 2] as number) +
      wc * (control[c + 2] as number) +
      (o[k + 2] as number) * sz * offsetScale;
    if (![x, y, z].every((value) => Number.isFinite(Math.fround(value))))
      throw new RangeError(`MHCLO offset scale exceeds finite Float32 output at vertex ${v}`);
  }
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
      (o[k] as number) * sx * offsetScale;
    out[k + 1] =
      wa * (control[a + 1] as number) +
      wb * (control[b + 1] as number) +
      wc * (control[c + 1] as number) +
      (o[k + 1] as number) * sy * offsetScale;
    out[k + 2] =
      wa * (control[a + 2] as number) +
      wb * (control[b + 2] as number) +
      wc * (control[c + 2] as number) +
      (o[k + 2] as number) * sz * offsetScale;
  }
  return out;
}

/** Skin weights for an attachment: each vertex blends the weights of its three base vertices, the heaviest `SKIN_INFLUENCES` kept. */
export function bindingSkin(
  asset: Bound,
  baseIndex: Uint8Array,
  baseWeight: Float32Array,
): { index: Uint8Array; weight: Float32Array } {
  const n = asset.entry.vertexCount;
  const index = new Uint8Array(n * SKIN_INFLUENCES);
  const weight = new Float32Array(n * SKIN_INFLUENCES);
  const acc = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    acc.clear();
    for (let j = 0; j < 3; j++) {
      const bw = asset.weights[v * 3 + j] as number;
      if (bw === 0) continue;
      addInfluences(acc, baseIndex, baseWeight, asset.refVerts[v * 3 + j] as number, bw);
    }
    writeStrongest(acc, index, weight, v * SKIN_INFLUENCES);
  }
  return { index, weight };
}
