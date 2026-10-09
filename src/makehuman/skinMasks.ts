/**
 * Anatomical skin-colour masks derived from MakeHuman's own targets.
 *
 * A target moves exactly the vertices of the feature it shapes, so the size of
 * its displacement is a smooth mask of that feature: the lip volume targets
 * outline the lips, the cheek, nose and ear targets cover where skin flushes,
 * and the nipple-size target covers nipple and areola. No hand-painted masks
 * are needed, and the masks follow the same topology every pack shares.
 *
 * Channels: 0 = lips, 1 = flush (cheeks, nose, ears), 2 = areola/nipple.
 * Channel 2 is anatomical detail and is only ever applied to adults (the
 * renderer zeroes it below 18).
 */
import type { HumanoidAssets, SparseTarget } from "../format/assetFormat.ts";

export const SKIN_MASK_CHANNELS = ["lips", "flush", "areola"] as const;

const MASK_TARGETS: Record<
  (typeof SKIN_MASK_CHANNELS)[number],
  { targets: string[]; lo: number; hi: number }
> = {
  lips: {
    targets: ["mouth/mouth-upperlip-volume-incr", "mouth/mouth-lowerlip-volume-incr"],
    lo: 0.18,
    hi: 0.55,
  },
  flush: {
    targets: [
      "cheek/l-cheek-volume-incr",
      "cheek/r-cheek-volume-incr",
      "nose/nose-volume-incr",
      "ears/l-ear-scale-incr",
      "ears/r-ear-scale-incr",
    ],
    lo: 0.05,
    hi: 0.7,
  },
  areola: { targets: ["breast/nipple-size-incr"], lo: 0.08, hi: 0.45 },
};

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Per base vertex, three mask channels in [0, 1] (`vertexCount * 3`). Missing targets leave a channel at 0. */
export function buildSkinMasks(assets: HumanoidAssets): Float32Array {
  const n = assets.manifest.vertexCount;
  const out = new Float32Array(n * 3);
  SKIN_MASK_CHANNELS.forEach((channel, c) => {
    const spec = MASK_TARGETS[channel];
    for (const name of spec.targets) {
      const t: SparseTarget | undefined = assets.targets.get(name);
      if (!t) continue;
      let max = 0;
      const mags = new Float32Array(t.indices.length);
      for (let i = 0; i < t.indices.length; i++) {
        const m = Math.hypot(
          t.deltas[i * 3] as number,
          t.deltas[i * 3 + 1] as number,
          t.deltas[i * 3 + 2] as number,
        );
        mags[i] = m;
        if (m > max) max = m;
      }
      if (max === 0) continue;
      for (let i = 0; i < t.indices.length; i++) {
        const v = t.indices[i] as number;
        const w = smoothstep(spec.lo, spec.hi, (mags[i] as number) / max);
        if (w > (out[v * 3 + c] as number)) out[v * 3 + c] = w;
      }
    }
  });
  return out;
}
