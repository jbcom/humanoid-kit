/**
 * The mound (mons pubis) as targets on the base mesh's own vertices
 * (docs/research/ADULT-SCULPT-PLAN.md, section 6a): a broad, low pad over the
 * pubic bone, fullest in its upper central part, with soft margins that blend
 * into the lower abdomen and the groin, with the dimensions of the measured mons.
 *
 * It is a control target, not detail: a swell this broad is low-frequency, so the
 * base's 19 mm cells and the subdivision that smooths them carry it exactly, and
 * its soft margins run past the refined pelvic region (which a lattice detail
 * could not cross without a crease at its edge). The lattice's finer cells are for
 * features that need them.
 *
 * Sources and gaps (docs/research/ADULT-ANATOMY-DATA.md, section E):
 * - width and length are the means of the lowest BMI band in Seleem et al., BMC
 *   Pregnancy Childbirth 2024 (194 women, 18 to 40), 11.2 and 6.5 cm, read as the
 *   extent of the visible pad at half its height, with the profile falling to
 *   nothing over twice that;
 * - the peak heights are that paper's contrast in soft-tissue depth between BMI
 *   bands (about 1.5 cm) for the fuller direction, and one standard deviation of
 *   the monal height (about 1 cm) for the flatter;
 * - the shape of the profile, its bias toward the upper centre, the direction of
 *   the displacement and the male range have no verified source and are
 *   modelled (uncalibrated). They are chosen so the pad has no crease: no edge of
 *   the surface turns by more than a few degrees more than it does without it
 *   (tests/moundControl.test.ts).
 *
 * Generated, not sculpted: the output depends only on the points it is given, so
 * the pack is the same on every rebuild.
 */
import { createRecipe } from "../../../src/recipe/recipe.ts";

/** The vertices the mound is placed on: positions and unit normals, with an optional mask of those that may move. */
export interface MoundPoints {
  count: number;
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  /** Nonzero for a vertex the mound may move; absent, all of them. */
  eligible?: ArrayLike<number>;
}

/** The figure the mound is authored against: the default adult, so every other figure is a deformation of it. */
export const AUTHORING_FIGURE = createRecipe({ macros: { age: 30 } });

export interface MoundParameters {
  /** Metres across the visible pad at half its height: the mons width (mean, BMI 18 to 25). */
  width: number;
  /** Metres from the pad's upper border to its lower at half its height: the mons length (mean, BMI 18 to 25). */
  length: number;
  /** The fuller control's peak displacement, metres: the BMI-band contrast in soft-tissue depth. */
  fuller: number;
  /** The flatter control's peak displacement, metres: one standard deviation of the monal height. */
  flatter: number;
  /** The pad's lower half-height edge is this far above the front surface's lowest point, metres (modelled). */
  lift: number;
  /** How far past the visible pad the profile reaches before it is nothing, as a multiple of the measured size. */
  reach: number;
  /** Metres over which the pad rises from nothing at the fold below it to its full height (modelled). */
  fade: number;
  /** How much fuller the upper centre is than the lower margin, 0 to 1 (modelled). */
  upperBias: number;
  /** How far the displacement leans to the body's forward axis rather than the skin's normal, 0 to 1. */
  forward: number;
}

export const MOUND: Readonly<MoundParameters> = {
  width: 0.112,
  length: 0.065,
  fuller: 0.015,
  flatter: 0.01,
  lift: 0.01,
  reach: 2,
  fade: 0.05,
  upperBias: 0.3,
  forward: 0.75,
};

/** A sparse displacement of vertices, in the units of a target. */
export interface Displacement {
  /** Ascending vertex indices. */
  indices: number[];
  /** xyz per index, metres. */
  xyz: Float32Array;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
/** Zero slope and zero curvature at both ends, so a profile built on it has no crease. */
const smootherstep = (t: number) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * The weight of the mound at each vertex, 0 to 1 with a peak of exactly 1: a
 * smootherstep from the middle out to an ellipse `reach` times the measured size,
 * fuller toward the top, and fading where the skin turns toward the groin (the
 * buttocks, the inner thighs and the fold below the pad).
 */
function moundWeights(points: MoundPoints, p: MoundParameters): Float32Array {
  const { positions: P, normals: N, count: n } = points;
  const usable = (v: number) => points.eligible === undefined || points.eligible[v] !== 0;
  // The lowest point of the front of the pelvis on the midline: where the skin turns under.
  let low = Number.POSITIVE_INFINITY;
  for (let v = 0; v < n; v++)
    if (usable(v) && Math.abs(P[v * 3] as number) < 0.004 && (N[v * 3 + 2] as number) > 0.5)
      low = Math.min(low, P[v * 3 + 1] as number);
  if (!Number.isFinite(low)) throw new Error("mound: no front surface on the midline");
  const a = (p.reach * p.width) / 2;
  const b = (p.reach * p.length) / 2;
  // Half-height lies at half the reach: the visible pad is `length` long from the lift up.
  const centre = low + p.lift + p.length / 2;
  const w = new Float32Array(n);
  let peak = 0;
  for (let v = 0; v < n; v++) {
    if (!usable(v)) continue;
    const up = ((P[v * 3 + 1] as number) - centre) / b;
    const r = Math.hypot((P[v * 3] as number) / a, up);
    if (r >= 1) continue;
    // Not where the skin faces away (the buttocks, the sides of the thighs), softly.
    const front = smoothstep(0.1, 0.6, N[v * 3 + 2] as number);
    if (front === 0 || (P[v * 3 + 2] as number) < 0.05) continue;
    // Rising from nothing at the fold below the pad over `fade` metres, so it does
    // not end in a crease where the surface turns under.
    const rise = smootherstep(((P[v * 3 + 1] as number) - low) / p.fade);
    const pad = 1 - smootherstep(r);
    const bias = 1 - p.upperBias + p.upperBias * smoothstep(-1, 1, up);
    w[v] = pad * bias * front * rise;
    peak = Math.max(peak, w[v] as number);
  }
  if (peak === 0) throw new Error("mound: no vertex under the pad");
  for (let v = 0; v < n; v++) w[v] = (w[v] as number) / peak;
  return w;
}

/**
 * The mound's two targets: fuller (outward) and flatter (inward), each a
 * displacement leaning to the body's forward axis, weighted by `moundWeights`.
 */
export function moundTargets(
  points: MoundPoints,
  parameters: MoundParameters = MOUND,
): { fuller: Displacement; flatter: Displacement } {
  const w = moundWeights(points, parameters);
  const indices: number[] = [];
  for (let v = 0; v < w.length; v++) if ((w[v] as number) > 1e-4) indices.push(v);
  const direction = (v: number) => {
    // Between the skin's normal and the forward axis (0, 0, 1), as a unit vector.
    const d = [0, 1, 2].map(
      (k) =>
        (1 - parameters.forward) * (points.normals[v * 3 + k] as number) +
        (k === 2 ? parameters.forward : 0),
    );
    const l = Math.hypot(...d) || 1;
    return d.map((x) => x / l);
  };
  const along = (height: number) => {
    const xyz = new Float32Array(indices.length * 3);
    indices.forEach((v, i) => {
      const d = direction(v);
      for (let k = 0; k < 3; k++) xyz[i * 3 + k] = (d[k] as number) * height * (w[v] as number);
    });
    return { indices: [...indices], xyz };
  };
  return { fuller: along(parameters.fuller), flatter: along(-parameters.flatter) };
}
