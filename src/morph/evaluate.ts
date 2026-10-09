/**
 * Sparse morph evaluation with per-region weights.
 *
 * A contribution applies one target either uniformly (`weight` is a number)
 * or with a different weight in each body region (`weight` has one entry per
 * region of the `RegionField`). Region masks form a smooth partition of unity
 * over the vertices, so a trait set differently on the face and the hips
 * blends across the neck and waist instead of tearing.
 *
 * This is what keeps every trait independent: a macro target authored for a
 * whole body (e.g. MakeHuman's gender anchors) can be applied to the face
 * alone, the chest alone, or the pelvis alone.
 */
import type { SparseTarget } from "../format/assetFormat.ts";

export interface RegionField {
  names: readonly string[];
  /** One mask per region, `vertexCount` long; masks sum to 1 at every vertex. */
  masks: readonly Float32Array[];
}

export interface Contribution {
  target: string;
  /** Uniform weight, or one weight per region of the field. */
  weight: number | Float32Array;
}

export class MorphError extends Error {
  override name = "MorphError";
}

/**
 * Writes `base + Σ weight · delta` into `out` (both `vertexCount * 3`).
 * Unknown target names throw: a recipe must never silently lose a trait.
 */
export function evaluateMorph(
  base: Float32Array,
  targets: ReadonlyMap<string, SparseTarget>,
  contributions: readonly Contribution[],
  out: Float32Array,
  regions?: RegionField,
): Float32Array {
  if (out.length !== base.length) throw new MorphError("output length mismatch");
  out.set(base);
  for (const c of contributions) {
    const t = targets.get(c.target);
    if (!t) throw new MorphError(`unknown target ${c.target}`);
    const { indices, deltas, scale } = t;
    if (typeof c.weight === "number") {
      const k = c.weight * scale;
      if (k === 0) continue;
      for (let i = 0; i < indices.length; i++) {
        const v = (indices[i] as number) * 3;
        out[v] = (out[v] as number) + (deltas[i * 3] as number) * k;
        out[v + 1] = (out[v + 1] as number) + (deltas[i * 3 + 1] as number) * k;
        out[v + 2] = (out[v + 2] as number) + (deltas[i * 3 + 2] as number) * k;
      }
      continue;
    }
    if (!regions) throw new MorphError(`regional weight for ${c.target} without a region field`);
    const w = c.weight;
    if (w.length !== regions.masks.length)
      throw new MorphError(
        `weight for ${c.target} has ${w.length} regions, field has ${regions.masks.length}`,
      );
    const active: number[] = [];
    for (let r = 0; r < w.length; r++) if ((w[r] as number) !== 0) active.push(r);
    if (active.length === 0) continue;
    for (let i = 0; i < indices.length; i++) {
      const vi = indices[i] as number;
      let k = 0;
      for (const r of active)
        k += (w[r] as number) * ((regions.masks[r] as Float32Array)[vi] as number);
      if (k === 0) continue;
      k *= scale;
      const v = vi * 3;
      out[v] = (out[v] as number) + (deltas[i * 3] as number) * k;
      out[v + 1] = (out[v + 1] as number) + (deltas[i * 3 + 1] as number) * k;
      out[v + 2] = (out[v + 2] as number) + (deltas[i * 3 + 2] as number) * k;
    }
  }
  return out;
}

/**
 * Merges per-region `name -> weight` maps into contributions: a target whose
 * weight is equal in every region becomes a uniform contribution.
 */
export function mergeRegionalWeights(
  perRegion: readonly ReadonlyMap<string, number>[],
): Contribution[] {
  const names = new Set<string>();
  for (const m of perRegion) for (const n of m.keys()) names.add(n);
  const out: Contribution[] = [];
  for (const name of [...names].sort()) {
    const w = new Float32Array(perRegion.length);
    let uniform = true;
    perRegion.forEach((m, r) => {
      w[r] = m.get(name) ?? 0;
      if (r > 0 && w[r] !== w[0]) uniform = false;
    });
    out.push({ target: name, weight: uniform ? (w[0] as number) : w });
  }
  return out;
}
