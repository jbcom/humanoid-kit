/**
 * The independent chest foundation generator (research). It is a function of an
 * EVALUATED FIGURE, not a table of world-space targets:
 *
 * 1. `flat`: the figure's own chest with the legacy tissue relaxed away by a
 *    biharmonic membrane fill over the support, blended by `legacyShare` (the
 *    fraction of the legacy female tissue the frame carries; 1 - gender). A male
 *    frame keeps its own pectoral shape: muscle is a separate trait.
 * 2. `delta`: size and firmness shape the tissue on top of that flat chest, per
 *    side, in units of the figure's own lateral chest scale (`halfSpan`), so the
 *    same parameters describe a tall, short, broad or narrow body.
 *
 * Size and firmness are separate deformations: size sets the footprint and the
 * projection; firmness redistributes (upper pole, lower-pole mass, descent of the
 * tissue under its weight) and never rescales the volume. Nothing reads `gender`
 * except through `legacyShare`, which only decides how much legacy tissue to relax.
 */

import type { BodyManifest } from "../../../src/format/assetFormat.ts";
import { type Anchors, anchors } from "./figure.ts";
import { type BodyMesh, biharmonicFill, diffuse, vertexNormals } from "./mesh.ts";
import type { Support } from "./support.ts";

export interface ChestParams {
  /** 0 = flat/base, 0.5 = average, 1 = high. */
  size: number;
  /** 0 = low (descended), 0.5 = average, 1 = firm. */
  firmness: number;
  /** Fraction of the legacy female tissue this frame carries (1 - gender). */
  legacyShare: number;
}

export interface ChestCtx {
  mesh: BodyMesh;
  support: Support;
  manifest: BodyManifest;
}

export interface ChestResult {
  /** The figure's chest with legacy tissue relaxed (control positions). */
  flat: Float32Array;
  /** Final control positions. */
  positions: Float32Array;
  /** positions - control. */
  delta: Float32Array;
  anchors: Anchors;
  /** Per side: apex vertex, tangent frame and the shape numbers used, for the receipts. */
  sides: Record<"L" | "R", SideReceipt>;
}

export interface SideReceipt {
  apexVertex: number;
  projection: number;
  radiusU: number;
  radiusV: number;
  descent: number;
  volume: number;
}

/** Diffusion steps applied to the sampled tissue field. */
export const SMOOTH_STEPS = 6;

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
type V3 = [number, number, number];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  (a[0] as number) * (b[0] as number) +
  (a[1] as number) * (b[1] as number) +
  (a[2] as number) * (b[2] as number);
const norm3 = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Shape numbers in units of L (the figure's half-span) for a size and a firmness. */
export function tissueShape(size: number, firmness: number) {
  const tau = 1 - firmness; // 0 firm .. 1 low
  return {
    /** Projection at the apex above the flat chest. 0.18 L at average, 0.55 L at high. */
    projection: size <= 0 ? 0 : 0.55 * size ** 1.6,
    /** Footprint semi-axes. */
    a: 0.3 + 0.4 * size,
    b: 0.38 + 0.42 * size,
    tau,
  };
}

export function chestFoundation(ctx: ChestCtx, control: Float32Array, p: ChestParams): ChestResult {
  const a = anchors(ctx.manifest, control);
  const free = Array.from(ctx.support.free);
  // 1. Relax the legacy tissue (only the share this frame carries).
  const filled = biharmonicFill(ctx.mesh, control, free);
  const flat = new Float32Array(control);
  for (const v of free)
    for (let k = 0; k < 3; k++)
      flat[v * 3 + k] =
        (control[v * 3 + k] as number) +
        p.legacyShare * ((filled[v * 3 + k] as number) - (control[v * 3 + k] as number));
  const nf = vertexNormals(ctx.mesh, flat);
  const L = a.halfSpan;
  const shape = tissueShape(p.size, p.firmness);
  const positions = new Float32Array(flat);
  const raw = new Float32Array(flat.length);
  const sides = {} as Record<"L" | "R", SideReceipt>;
  for (const sideName of ["L", "R"] as const) {
    const sideId = sideName === "L" ? 0 : 1;
    const A = a.apex[sideName];
    // Apex vertex: the free vertex of this side nearest the apex joint.
    let apex = -1;
    let best = Number.POSITIVE_INFINITY;
    for (const v of free) {
      if (ctx.support.side[v] !== sideId) continue;
      const d = Math.hypot(
        (control[v * 3] as number) - A[0],
        (control[v * 3 + 1] as number) - A[1],
        (control[v * 3 + 2] as number) - A[2],
      );
      if (d < best) {
        best = d;
        apex = v;
      }
    }
    const A0: V3 = [
      flat[apex * 3] as number,
      flat[apex * 3 + 1] as number,
      flat[apex * 3 + 2] as number,
    ];
    const n0 = norm3([
      nf[apex * 3] as number,
      nf[apex * 3 + 1] as number,
      nf[apex * 3 + 2] as number,
    ]);
    const downRaw: V3 = [0, -1, 0];
    const dn = dot(downRaw, n0);
    const tDown = norm3([
      downRaw[0] - dn * n0[0],
      downRaw[1] - dn * n0[1],
      downRaw[2] - dn * n0[2],
    ]);
    let tOut = norm3(cross3(tDown, n0));
    if (tOut[0] * (A0[0] >= 0 ? 1 : -1) < 0) tOut = [-tOut[0], -tOut[1], -tOut[2]];
    const P = shape.projection * L;
    const a_ = shape.a * L;
    const b_ = shape.b * L;
    const tau = shape.tau;
    const cv = 0.18 * tau * b_; // footprint centre sits below the apex as the tissue descends
    const bUp = b_ * (1 - 0.3 * tau);
    const bDown = b_ * (1.15 + 0.25 * tau);
    // Round-cap profiles: the upper pole blends smoothly (k near 1, a parabolic dome),
    // the lower pole meets the wall at a steeper angle (k below 1), which is the fold.
    const kUp = lerp(0.95, 1.5, tau);
    const kLow = lerp(1.0, 0.8, tau);
    // Descent is a smooth, wide, low-gradient tangential field: no ripples.
    const descent = 0.3 * tau * b_;
    let volume = 0;
    const apexDelta: V3 = [0, 0, 0];
    const fieldAt = (q: ArrayLike<number>): V3 => {
      const d: V3 = [(q[0] as number) - A0[0], (q[1] as number) - A0[1], (q[2] as number) - A0[2]];
      const u = dot(d, tOut);
      const v = dot(d, tDown);
      const vr = v - cv;
      const bs = vr < 0 ? bUp : bDown;
      const rho2 = (u / a_) ** 2 + (vr / bs) ** 2;
      if (rho2 >= 1 || P <= 0) return [0, 0, 0];
      const lowW = smooth((vr / bs + 0.2) / 0.8);
      const k = lerp(kUp, kLow, lowW);
      const h = P * (1 - rho2) ** k;
      const slide = descent * (1 - rho2) ** 2;
      return [
        n0[0] * h + tDown[0] * slide,
        n0[1] * h + tDown[1] * slide,
        n0[2] * h + tDown[2] * slide,
      ];
    };
    const af = fieldAt(A0);
    apexDelta[0] = af[0];
    apexDelta[1] = af[1];
    apexDelta[2] = af[2];
    const nacR = 0.16 * L;
    for (const v of free) {
      if (ctx.support.side[v] !== sideId) continue;
      const q: V3 = [flat[v * 3] as number, flat[v * 3 + 1] as number, flat[v * 3 + 2] as number];
      let d = fieldAt(q);
      // The nipple-areola cluster moves as one piece so its own relief survives.
      const r = Math.hypot(q[0] - A0[0], q[1] - A0[1], q[2] - A0[2]);
      const t = 1 - smooth((r - nacR) / (0.6 * nacR));
      if (t > 0)
        d = [lerp(d[0], apexDelta[0], t), lerp(d[1], apexDelta[1], t), lerp(d[2], apexDelta[2], t)];
      for (let k = 0; k < 3; k++) raw[v * 3 + k] = d[k] as number;
      volume += Math.max(0, dot(d, n0)) * 1e-4; // crude relative measure; real volume is computed in the gates
    }
    sides[sideName] = {
      apexVertex: apex,
      projection: P,
      radiusU: a_,
      radiusV: b_,
      descent,
      volume,
    };
  }
  // Even the sampled field out on the surface: the mesh is uneven (a 1 to 5 mm nipple cluster
  // inside 14 mm chest quads), and raw samples there read as blotches.
  const smoothed = diffuse(ctx.mesh, flat, raw, free, SMOOTH_STEPS, 0.5);
  for (const v of free)
    for (let k = 0; k < 3; k++)
      positions[v * 3 + k] = (flat[v * 3 + k] as number) + (smoothed[v * 3 + k] as number);
  const delta = new Float32Array(control.length);
  for (let i = 0; i < delta.length; i++)
    delta[i] = (positions[i] as number) - (control[i] as number);
  return { flat, positions, delta, anchors: a, sides };
}
