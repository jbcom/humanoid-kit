/**
 * The DATA-FIRST chest foundation generator (research). It shapes no tissue of its
 * own: every breast it draws is MakeHuman's own CC0 legacy breast contribution,
 * composed by the kit's evaluator once, carried by vertex index onto any figure.
 *
 * There is no male or female model: the generator takes the EVALUATED control mesh
 * plus size and firmness, and reads no recipe, no gender and no value derived from
 * one. Everything it knows about the figure it measures from the mesh.
 *
 * - The LIBRARY (`tissueLibrary`, built once, constant data like a target): the
 *   canonical legacy cell L is the evaluator's figure that carries MakeHuman's average
 *   breast. Its tissue grid is T(s, f) = E(L, s, f) - fill(E(L, .5, .5)), where fill
 *   is the biharmonic membrane fill over the support (the two fixed rings are not
 *   moved by any breast target, so one fill serves the whole grid), sampled on
 *   MakeHuman's own 3 x 3 grid s, f in {0, .5, 1} plus the size-.75 midline the
 *   evaluator itself interpolates.
 * - CARRIED TISSUE (measured, per side): the frame's relief r = C - fill(C) over the
 *   support, least-squares fitted on two measured shapes scaled to this frame: the
 *   average mound k T(.5,.5) and the BARE relief k B (MakeHuman's figure that carries
 *   no breast tissue). share = the mound coefficient, clamped to [0, 1]. A frame with
 *   the full legacy mound measures 1, the bare frame 0, and frames between follow
 *   MakeHuman's own breast weight without reading any frame value.
 * - FLAT BASELINE: flat = C - share * k T(.5,.5) on the free vertices. Only the
 *   tissue leaves; the rest of r (pectoral relief, rib shape, the frame's own nipple)
 *   stays. (Decision: NOTES.md.)
 * - AGE: the library is built per age and interpolated (`ageLibrary`, `libraryAt`);
 *   the caller picks the library at the figure's age, a development stage like size.
 * - TISSUE: final = flat + k * T_abs(s, f), k = halfSpan(C) / halfSpan(L) from the
 *   figure's own skeleton joints. T_abs is the ABSOLUTE tissue: s = 0 none,
 *   s in (0, .5] the average mound ramped linearly, s >= .5 MakeHuman's T(s, f)
 *   (bilinear between grid samples).
 *
 * Gates: on L itself, (s, f) = (.5, .5) is the legacy figure exactly and s = 1 the
 * legacy max. MakeHuman's own targets reach past the support (up to 58 mm at size
 * 1), so the grid carries them on every vertex they move (`reach`); outside
 * `reach`, nothing ever moves, and at (.5, .5) nothing outside the support moves.
 */
import type { BodyManifest } from "../../../src/format/assetFormat.ts";
import type { Recipe } from "../../../src/recipe/recipe.ts";
import { type Anchors, anchors, type Lab } from "./figure.ts";
import { type BodyMesh, biharmonicFill } from "./mesh.ts";
import type { Support } from "./support.ts";

export interface SideParams {
  /** 0 = flat/base (no tissue), 0.5 = MakeHuman average, 1 = MakeHuman high. */
  size: number;
  /** 0 = low (descended), 0.5 = average, 1 = firm: MakeHuman's own firmness targets. */
  firmness: number;
}

export type TissueParams = SideParams | Record<"L" | "R", SideParams>;

/** Fixed topology data: the body mesh, the support chosen once, the manifest. */
export interface TissueCtx {
  mesh: BodyMesh;
  support: Support;
  manifest: BodyManifest;
}

/** Size samples of the library grid (firmness samples are 0, .5, 1). */
export const LIBRARY_SIZES = [0.5, 0.75, 1] as const;
const FIRMS = [0, 0.5, 1] as const;

export interface TissueLibrary {
  /** The canonical cell's halfSpan (m). */
  halfSpan: number;
  /** T(s, f) per free vertex (xyz), keyed `${s}/${f}`; zero outside the support. */
  grid: Map<string, Float32Array>;
  /** The canonical cell's control mesh at the average cup (the identity reference). */
  cell: Float32Array;
  /**
   * The BARE relief over the support (zero elsewhere): the relief from its own fill of
   * MakeHuman's figure that carries no breast tissue (its breast weight is 0), the
   * second shape a frame's relief is fitted on so pectoral relief is not read as tissue.
   */
  bare: Float32Array;
  /** Every vertex the tissue may move: the support's free set plus the targets' reach. */
  reach: Uint32Array;
  /** Per vertex: the chest side (0 L, 1 R) it belongs to, -1 outside `reach`. */
  side: Int8Array;
}

export interface SideMeasure {
  /** Measured fraction of the library's average mound the frame carries (fitted beside the bare relief). */
  share: number;
  /** RMS (mm) over the side's free vertices of the frame's relief from its fill. */
  reliefRms: number;
  /** RMS (mm) of the relief left after the mound component is removed. */
  remainderRms: number;
}

export interface TissueResult {
  flat: Float32Array;
  positions: Float32Array;
  /** The absolute tissue added on top of `flat` (already scaled by k). */
  tissue: Float32Array;
  anchors: Anchors;
  /** halfSpan(frame) / halfSpan(library cell). */
  k: number;
  sides: Record<"L" | "R", SideMeasure>;
}

const sideParams = (p: TissueParams): Record<"L" | "R", SideParams> =>
  "L" in p ? p : { L: p, R: p };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The legacy-evaluator sampler: a recipe's control mesh with its breast macros replaced. */
export function legacyControl(lab: Lab, recipe: Recipe, size: number, firmness: number) {
  return lab.model.evaluate({
    ...recipe,
    macros: { ...recipe.macros, breastSize: size, breastFirmness: firmness },
  }).control;
}

/**
 * Build the library from the canonical cell recipe (the evaluator figure that carries
 * the average legacy breast). Run once; the result is constant data.
 */
export function tissueLibrary(
  ctx: TissueCtx,
  lab: Lab,
  cellRecipe: Recipe,
  bareRecipe: Recipe,
): TissueLibrary {
  const free = Array.from(ctx.support.free);
  const cell = legacyControl(lab, cellRecipe, 0.5, 0.5);
  const fill = biharmonicFill(ctx.mesh, cell, free);
  const bareControl = lab.model.evaluate(bareRecipe).control;
  const bareFill = biharmonicFill(ctx.mesh, bareControl, free);
  const bare = new Float32Array(cell.length);
  for (const v of free)
    for (let a = 0; a < 3; a++)
      bare[v * 3 + a] = (bareControl[v * 3 + a] as number) - (bareFill[v * 3 + a] as number);
  const grid = new Map<string, Float32Array>();
  const moved = new Uint8Array(ctx.mesh.vertexCount);
  for (const v of ctx.support.free) moved[v] = 1;
  for (const s of LIBRARY_SIZES)
    for (const f of FIRMS) {
      const e = s === 0.5 && f === 0.5 ? cell : legacyControl(lab, cellRecipe, s, f);
      // Every vertex: inside the support against the fill, outside against the cell
      // itself (the fill leaves fixed vertices unchanged), because MakeHuman's breast
      // targets reach past any chest support (the probe measures it). That includes
      // the non-body helper vertices (the proxy garments that ride the skin): the
      // legacy targets move them too, and the identity gate covers them.
      const t = new Float32Array(cell.length);
      for (let v = 0; v < ctx.mesh.vertexCount; v++)
        for (let a = 0; a < 3; a++) {
          const d = (e[v * 3 + a] as number) - (fill[v * 3 + a] as number);
          t[v * 3 + a] = d;
          if (d !== 0) moved[v] = 1;
        }
      grid.set(`${s}/${f}`, t);
    }
  const anc = anchors(ctx.manifest, cell);
  const reach: number[] = [];
  const side = new Int8Array(ctx.mesh.vertexCount).fill(-1);
  for (let v = 0; v < ctx.mesh.vertexCount; v++) {
    if (!moved[v]) continue;
    reach.push(v);
    const own = ctx.support.side[v] as number;
    if (own >= 0) side[v] = own;
    else {
      const dl = Math.abs((cell[v * 3] as number) - anc.apex.L[0]);
      const dr = Math.abs((cell[v * 3] as number) - anc.apex.R[0]);
      side[v] = dl <= dr ? 0 : 1;
    }
  }
  return { halfSpan: anc.halfSpan, grid, cell, bare, reach: Uint32Array.from(reach), side };
}

/**
 * The tissue library over age. MakeHuman's breast targets exist for its child,
 * young and old bodies (none for the baby), and the evaluator weights the age
 * bodies linearly in years between the kit's anchors (`AGE_ANCHORS`: 1, 10, 25,
 * 90, MakeHuman's own). Every library quantity (the evaluated cells, their fill, the grid, the
 * joint-derived halfSpan) is linear in the evaluated vertices, so it is linear
 * in years between anchors: cells at the anchors, linear between, reproduce
 * MakeHuman at EVERY age, not only at the sampled ones. The cells also sit at the
 * review ages (5, 13, 40, 70), which changes nothing but lets each be checked.
 */
export const AGE_KNOTS = [1, 5, 10, 13, 18, 25, 40, 70, 90] as const;

export interface AgeLibrary {
  ages: readonly number[];
  /** One library per age, every one with the same (union) `reach` and `side`. */
  cells: TissueLibrary[];
}

/**
 * Builds the library at every knot age from the average-tissue frame at that age
 * (`cellRecipeAt(age)`), over one shared reach: the union of every age's.
 */
export function ageLibrary(
  ctx: TissueCtx,
  lab: Lab,
  cellRecipeAt: (age: number) => Recipe,
  bareRecipeAt: (age: number) => Recipe,
  ages: readonly number[] = AGE_KNOTS,
): AgeLibrary {
  const cells = ages.map((age) => tissueLibrary(ctx, lab, cellRecipeAt(age), bareRecipeAt(age)));
  const side = new Int8Array(ctx.mesh.vertexCount).fill(-1);
  for (const lib of cells)
    for (const v of lib.reach) if ((side[v] as number) < 0) side[v] = lib.side[v] as number;
  const reach: number[] = [];
  for (let v = 0; v < side.length; v++) if ((side[v] as number) >= 0) reach.push(v);
  const shared = Uint32Array.from(reach);
  return { ages, cells: cells.map((c) => ({ ...c, reach: shared, side })) };
}

const lerpArray = (a: Float32Array, b: Float32Array, t: number) => {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++)
    out[i] = (a[i] as number) + ((b[i] as number) - (a[i] as number)) * t;
  return out;
};

/** The library at `years`: linear between the two knots around it, clamped at the ends. */
export function libraryAt(lib: AgeLibrary, years: number): TissueLibrary {
  const { ages, cells } = lib;
  let i = 0;
  while (i < ages.length - 1 && years > (ages[i + 1] as number)) i++;
  const a = cells[i] as TissueLibrary;
  if (i === ages.length - 1 || years <= (ages[i] as number)) return a;
  const b = cells[i + 1] as TissueLibrary;
  const t = (years - (ages[i] as number)) / ((ages[i + 1] as number) - (ages[i] as number));
  if (t === 1) return b;
  const grid = new Map<string, Float32Array>();
  for (const [key, ga] of a.grid) grid.set(key, lerpArray(ga, b.grid.get(key) as Float32Array, t));
  return {
    halfSpan: a.halfSpan + (b.halfSpan - a.halfSpan) * t,
    grid,
    cell: lerpArray(a.cell, b.cell, t),
    bare: lerpArray(a.bare, b.bare, t),
    reach: a.reach,
    side: a.side,
  };
}

/** Bilinear weights of (s, f) on the library grid, s clamped to [.5, 1]. */
function gridWeights(s: number, f: number): [string, number][] {
  const sc = Math.max(0.5, Math.min(1, s));
  const si = sc >= 0.75 ? 1 : 0;
  const s0 = LIBRARY_SIZES[si] as number,
    s1 = LIBRARY_SIZES[si + 1] as number;
  const ts = (sc - s0) / (s1 - s0);
  const fi = f >= 0.5 ? 1 : 0;
  const f0 = FIRMS[fi] as number,
    f1 = FIRMS[fi + 1] as number;
  const tf = (f - f0) / (f1 - f0);
  return [
    [`${s0}/${f0}`, (1 - ts) * (1 - tf)],
    [`${s1}/${f0}`, ts * (1 - tf)],
    [`${s0}/${f1}`, (1 - ts) * tf],
    [`${s1}/${f1}`, ts * tf],
  ].filter(([, w]) => (w as number) !== 0) as [string, number][];
}

export type FrameMeasure = Omit<TissueResult, "positions" | "tissue">;

/**
 * Measure what the frame already carries and relax exactly that: the flat baseline
 * every chest generator builds on. Reads only the evaluated control mesh.
 */
export function flatBaseline(
  ctx: TissueCtx,
  lib: TissueLibrary,
  control: Float32Array,
): FrameMeasure {
  const free = Array.from(ctx.support.free);
  const fill = biharmonicFill(ctx.mesh, control, free);
  const anc = anchors(ctx.manifest, control);
  const k = anc.halfSpan / lib.halfSpan;
  const avg = lib.grid.get("0.5/0.5") as Float32Array;
  // The frame's relief is fitted, per side, on TWO measured shapes: the library's
  // average mound (MakeHuman's figure that carries the average tissue) and its BARE
  // relief (MakeHuman's figure that carries none: its breast weight is 0). Only the
  // mound's coefficient is tissue. Projecting on the mound alone read a masculine
  // frame's broad pectoral relief as 78 % tissue and dug a 14 mm crater at its
  // nipple (the known pinch); with the bare shape in the basis that frame measures
  // about 0 and keeps its own chest. On the average-tissue frame the fit is (1, 0).
  const bare = lib.bare;
  const flat = new Float32Array(control);
  const sides = {} as Record<"L" | "R", SideMeasure>;
  for (const name of ["L", "R"] as const) {
    const sideId = name === "L" ? 0 : 1;
    const vs = free.filter((v) => ctx.support.side[v] === sideId);
    let tt = 0,
      tb = 0,
      bb = 0,
      rt = 0,
      rb = 0,
      rr = 0;
    for (const v of vs)
      for (let a = 0; a < 3; a++) {
        const i = v * 3 + a;
        const r = (control[i] as number) - (fill[i] as number);
        const t = k * (avg[i] as number);
        const b = k * (bare[i] as number);
        tt += t * t;
        tb += t * b;
        bb += b * b;
        rt += r * t;
        rb += r * b;
        rr += r * r;
      }
    // MakeHuman's frames are linear in the frame value, so a frame between the two
    // references fits close to (1 - g, g): the measured share follows MakeHuman's own
    // breast weight without reading g. The two shapes stay distinct at every age
    // (children too); only a degenerate pair falls back to the one-shape fit.
    const det = tt * bb - tb * tb;
    const fitted = det > 1e-9 * tt * bb ? (rt * bb - rb * tb) / det : tt > 0 ? rt / tt : 0;
    const share = clamp01(fitted);
    let rem = 0;
    for (const v of vs)
      for (let a = 0; a < 3; a++) {
        const i = v * 3 + a;
        flat[i] = (control[i] as number) - share * k * (avg[i] as number);
        rem += ((flat[i] as number) - (fill[i] as number)) ** 2;
      }
    const n3 = Math.max(1, vs.length * 3);
    sides[name] = {
      share,
      reliefRms: Math.sqrt(rr / n3) * 1000,
      remainderRms: Math.sqrt(rem / n3) * 1000,
    };
  }
  return { flat, anchors: anc, k, sides };
}

/**
 * The generator. Inputs: fixed topology data, the constant library, the figure's
 * EVALUATED control mesh, and per-side size/firmness. Nothing else.
 */
export function chestTissue(
  ctx: TissueCtx,
  lib: TissueLibrary,
  control: Float32Array,
  params: TissueParams,
): TissueResult {
  const base = flatBaseline(ctx, lib, control);
  const { flat, k } = base;
  const tissue = new Float32Array(control.length);
  const positions = new Float32Array(flat);
  const want = sideParams(params);
  for (const name of ["L", "R"] as const) {
    const sideId = name === "L" ? 0 : 1;
    const vs = Array.from(lib.reach).filter((v) => lib.side[v] === sideId);
    const s = clamp01(want[name].size);
    const f = clamp01(want[name].firmness);
    const weights = gridWeights(s, f);
    // Below the average the mound is the average one, scaled down: MakeHuman's own
    // small targets are a REDUCTION of a frame that already has tissue, and on a flat
    // chest they would dent it (no common baseline).
    const ramp = s < 0.5 ? s / 0.5 : 1;
    for (const v of vs)
      for (let a = 0; a < 3; a++) {
        const i = v * 3 + a;
        let t = 0;
        for (const [key, w] of weights) t += w * ((lib.grid.get(key) as Float32Array)[i] as number);
        t *= k * ramp;
        tissue[i] = t;
        positions[i] = (flat[i] as number) + t;
      }
  }
  return { ...base, positions, tissue };
}
