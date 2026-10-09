/**
 * The mound (mons pubis) as detail targets on the adult surface's lattice
 * (docs/research/ADULT-SCULPT-PLAN.md, section 6a): a bell of displacement along
 * the skin's outward normal, centred on the midline just above where the front
 * of the pelvis turns under, with the dimensions of the measured mons.
 *
 * Sources and gaps (docs/research/ADULT-ANATOMY-DATA.md, section E):
 * - width and length are the means of the lowest BMI band in Seleem et al., BMC
 *   Pregnancy Childbirth 2024 (194 women, 18 to 40), 11.2 and 6.5 cm;
 * - the peak heights are that paper's contrast in soft-tissue depth between BMI
 *   bands (about 1.5 cm) for the fuller direction, and one standard deviation of
 *   the monal height (about 1 cm) for the flatter;
 * - the shape of the bell, its centre and the male range have no verified
 *   source and are modelled (uncalibrated).
 *
 * Generated, not sculpted: the output depends only on the lattice, so the pack
 * is the same on every rebuild.
 */
import type { AdultDetailLattice } from "../../../src/model/humanoidModel.ts";
import { createRecipe } from "../../../src/recipe/recipe.ts";

/** The figure the detail is authored against: the default adult, so every other figure is a deformation of it. */
export const AUTHORING_FIGURE = createRecipe({ macros: { age: 30 } });

export const MOUND = {
  /** Metres across: the widest transverse extent of the mons (mean, BMI 18 to 25). */
  width: 0.112,
  /** Metres from the form's upper border to its lower: the mons length (mean, BMI 18 to 25). */
  length: 0.065,
  /** The fuller control's peak outward displacement, metres: the BMI-band contrast in soft-tissue depth. */
  fuller: 0.015,
  /** The flatter control's peak inward displacement, metres: one standard deviation of the monal height. */
  flatter: 0.01,
  /** The form starts this far above the front surface's lowest point, metres (modelled). */
  lift: 0.01,
} as const;

/** A sparse displacement of lattice vertices, in the units of a detail target. */
export interface DetailDelta {
  /** Ascending indices into the lattice's region. */
  indices: number[];
  /** xyz per index, metres. */
  xyz: Float32Array;
}

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * The weight of the mound at each lattice vertex, 0 to 1: zero outside an ellipse
 * of the measured width and length, a cosine bell inside it, and zero where the
 * skin faces away from the front (the buttocks, the inner thighs).
 */
function moundWeights(lattice: AdultDetailLattice): Float32Array {
  const { positions: P, normals: N, vertexCount: n } = lattice;
  // The lowest point of the front of the pelvis on the midline: where the skin turns under.
  let low = Number.POSITIVE_INFINITY;
  for (let v = 0; v < n; v++)
    if (Math.abs(P[v * 3] as number) < 0.004 && (N[v * 3 + 2] as number) > 0.5)
      low = Math.min(low, P[v * 3 + 1] as number);
  if (!Number.isFinite(low)) throw new Error("mound: no front surface on the midline");
  const a = MOUND.width / 2;
  const b = MOUND.length / 2;
  const centre = low + MOUND.lift + b;
  const w = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const r = Math.hypot((P[v * 3] as number) / a, ((P[v * 3 + 1] as number) - centre) / b);
    if (r >= 1) continue;
    const front = smoothstep(0.2, 0.6, N[v * 3 + 2] as number);
    if (front === 0 || (P[v * 3 + 2] as number) < 0.05) continue;
    w[v] = 0.5 * (1 + Math.cos(Math.PI * r)) * front;
  }
  return w;
}

/**
 * The mound's two detail targets: fuller (outward) and flatter (inward), each a
 * displacement along the vertex's outward normal weighted by `moundWeights`.
 */
export function moundTargets(lattice: AdultDetailLattice): {
  fuller: DetailDelta;
  flatter: DetailDelta;
} {
  const w = moundWeights(lattice);
  const indices: number[] = [];
  for (let v = 0; v < w.length; v++) if ((w[v] as number) > 1e-4) indices.push(v);
  const along = (height: number) => {
    const xyz = new Float32Array(indices.length * 3);
    indices.forEach((v, i) => {
      for (let k = 0; k < 3; k++)
        xyz[i * 3 + k] = (lattice.normals[v * 3 + k] as number) * height * (w[v] as number);
    });
    return { indices: [...indices], xyz };
  };
  return { fuller: along(MOUND.fuller), flatter: along(-MOUND.flatter) };
}
