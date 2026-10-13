/**
 * A skinned vertex's influences: `SKIN_INFLUENCES` places of a bone and its
 * weight, heaviest first (src/format/assetFormat.ts). What builds weights for a
 * vertex from others' (a blend, a mean, a binding) sums them per bone and keeps
 * the heaviest here.
 */
import { SKIN_INFLUENCES } from "../format/assetFormat.ts";

/**
 * Writes the `SKIN_INFLUENCES` heaviest of `weights` (bone to weight; ties to
 * the lower bone) renormalised into `index` and `weight` at place `at` (a vertex's
 * first place, `v * SKIN_INFLUENCES`); places left over take bone `empty` and
 * weight 0. Returns how many places were written from `weights`.
 */
export function writeStrongest(
  weights: ReadonlyMap<number, number>,
  index: Uint8Array | Uint16Array,
  weight: Float32Array,
  at: number,
  empty = 0,
): number {
  const top = [...weights]
    .filter(([, w]) => w > 0)
    .sort((x, y) => y[1] - x[1] || x[0] - y[0])
    .slice(0, SKIN_INFLUENCES);
  const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
  for (let k = 0; k < SKIN_INFLUENCES; k++) {
    const e = top[k];
    index[at + k] = e ? e[0] : empty;
    weight[at + k] = e ? e[1] / sum : 0;
  }
  return top.length;
}

/** Vertex `v`'s heaviest bone: the bone of its heaviest place (the first, on a tie). */
export function heaviestBone(
  index: ArrayLike<number>,
  weight: ArrayLike<number>,
  v: number,
): number {
  let best = 0;
  for (let k = 1; k < SKIN_INFLUENCES; k++)
    if (
      (weight[v * SKIN_INFLUENCES + k] as number) > (weight[v * SKIN_INFLUENCES + best] as number)
    )
      best = k;
  return index[v * SKIN_INFLUENCES + best] as number;
}

/** Adds vertex `v`'s influences, each times `scale`, to `into` (bone to weight). */
export function addInfluences(
  into: Map<number, number>,
  index: ArrayLike<number>,
  weight: ArrayLike<number>,
  v: number,
  scale = 1,
): void {
  for (let k = 0; k < SKIN_INFLUENCES; k++) {
    const w = (weight[v * SKIN_INFLUENCES + k] as number) * scale;
    if (w <= 0) continue;
    const b = index[v * SKIN_INFLUENCES + k] as number;
    into.set(b, (into.get(b) ?? 0) + w);
  }
}
