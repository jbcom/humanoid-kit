/**
 * The chest lab's scatter sampler. A sheet has two DISPLAY axes, crossed: age (rows,
 * `REVIEW_AGES`) and frame direction (columns, `FRAME_DIRECTIONS`). Every other axis
 * is NOT crossed: each tile draws its values from a seeded space-filling sample over
 * the axis's full range, so every axis is covered evenly across the sheet.
 *
 * - Scalar axes (breast size, firmness, melanin, undertone, muscle, weight, height
 *   and six facial modifiers) are Latin-hypercube stratified: each axis's N values
 *   sit one per stratum of [lo, hi], in a seeded order.
 * - The ethnic mix is MakeHuman's simplex (african, asian, caucasian summing to 1),
 *   sampled INDEPENDENTLY of melanin (any combination is legal, ruling 1): the three
 *   pure vertices, the three edge midpoints and the centre are fixed tiles; the rest
 *   are a seeded low-discrepancy 2D sample mapped onto the simplex by the area-preserving map
 *   (1 - sqrt u, sqrt u (1 - v), sqrt u v), so the corners are sampled as densely as
 *   the middle (independent exponentials under-sample them).
 * - Neighbour separation: the order of the size and melanin values is then improved
 *   by seeded swaps so no two neighbouring tiles share a size or a skin tone; a swap
 *   keeps every stratum covered.
 *
 * The two EXTREMES sheets use the same grid, with the ethnic mix only at the three
 * pure vertices and the cornered axes only at their two ends (balanced: half the
 * tiles each), so the corners of the hypercube are where failures show:
 * - `chest-extremes` corners only the chest's own axes (`CHEST_CORNER_AXES`: size,
 *   firmness, melanin, undertone) and holds every body and face axis at the middle of
 *   its range, so a body-wide failure at weight 1 cannot bury the chest signal;
 * - `body-extremes` corners every axis, for the body-wide failures.
 */
import { FRAME_DIRECTIONS, type FrameDirection, REVIEW_AGES } from "./conditions.ts";

/** Facial modifiers sampled per tile: one MakeHuman modifier (or bilateral pair) per feature. */
export const FACE_AXES = {
  nose: ["nose/nose-scale-horiz-decr|incr"],
  lips: ["mouth/mouth-upperlip-volume-decr|incr", "mouth/mouth-lowerlip-volume-decr|incr"],
  jaw: ["chin/chin-width-decr|incr"],
  eyes: ["eyes/l-eye-epicanthus-in|out", "eyes/r-eye-epicanthus-in|out"],
  ears: ["ears/l-ear-scale-decr|incr", "ears/r-ear-scale-decr|incr"],
  cheek: ["cheek/l-cheek-bones-decr|incr", "cheek/r-cheek-bones-decr|incr"],
} as const;
export type FaceAxis = keyof typeof FACE_AXES;
const FACE_KEYS = Object.keys(FACE_AXES) as FaceAxis[];

/** Every scalar axis with its full range. */
export const SCALAR_AXES = {
  size: [0, 1],
  firmness: [0, 1],
  melanin: [0, 1],
  undertone: [-1, 1],
  muscle: [0, 1],
  weight: [0, 1],
  height: [0, 1],
  nose: [-1, 1],
  lips: [-1, 1],
  jaw: [-1, 1],
  eyes: [-1, 1],
  ears: [-1, 1],
  cheek: [-1, 1],
} as const;
export type ScalarAxis = keyof typeof SCALAR_AXES;
const SCALAR_KEYS = Object.keys(SCALAR_AXES) as ScalarAxis[];

/** The axes the chest-extremes sheet corners; every other axis sits mid-range there. */
export const CHEST_CORNER_AXES: readonly ScalarAxis[] = [
  "size",
  "firmness",
  "melanin",
  "undertone",
];

export type SheetKind = "scatter" | "chest-extremes" | "body-extremes";
export const SHEET_KINDS: readonly SheetKind[] = ["scatter", "chest-extremes", "body-extremes"];

export interface Condition {
  /** Tile index, row-major. */
  index: number;
  row: number;
  col: number;
  age: number;
  frame: FrameDirection;
  values: Record<ScalarAxis, number>;
  /** african, asian, caucasian; sums to 1. */
  ethnic: [number, number, number];
  /** Which fixed simplex point the tile is, if it is one. */
  ethnicFixed: string | null;
}

export interface SheetSample {
  kind: SheetKind;
  seed: number;
  rows: number;
  cols: number;
  conditions: Condition[];
}

/** mulberry32: a small seeded PRNG, deterministic across platforms. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffle = <T>(xs: T[], r: () => number): T[] => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
};

/** N Latin-hypercube values in [0, 1): one per stratum, jittered, in a seeded order. */
const lhs = (n: number, r: () => number) =>
  shuffle(
    Array.from({ length: n }, (_, i) => (i + r()) / n),
    r,
  );

/** Balanced two-level values: half 0, half 1 (the odd one seeded), in a seeded order. */
const ends = (n: number, r: () => number) =>
  shuffle(
    Array.from({ length: n }, (_, i) =>
      i < Math.floor(n / 2) ? 0 : i < 2 * Math.floor(n / 2) || r() < 0.5 ? 1 : 0,
    ),
    r,
  );

/** The base-2 radical inverse (van der Corput) of i. */
const radicalInverse2 = (i: number) => {
  let x = 0,
    f = 0.5;
  for (let n = i; n > 0; n >>= 1, f /= 2) if (n & 1) x += f;
  return x;
};

export const SIMPLEX_FIXED: Record<string, [number, number, number]> = {
  african: [1, 0, 0],
  asian: [0, 1, 0],
  caucasian: [0, 0, 1],
  "african-asian": [0.5, 0.5, 0],
  "asian-caucasian": [0, 0.5, 0.5],
  "african-caucasian": [0.5, 0, 0.5],
  centre: [1 / 3, 1 / 3, 1 / 3],
};

/** The area-preserving map of the unit square onto the simplex. */
export const toSimplex = (u: number, v: number): [number, number, number] => {
  const s = Math.sqrt(u);
  return [1 - s, s * (1 - v), s * v];
};

/** The fixed simplex point nearest a mix: its Voronoi region (`SIMPLEX_FIXED` names). */
export function simplexRegion(e: readonly [number, number, number]): string {
  let best = "",
    d = Number.POSITIVE_INFINITY;
  for (const [name, p] of Object.entries(SIMPLEX_FIXED)) {
    const dd = (e[0] - p[0]) ** 2 + (e[1] - p[1]) ** 2 + (e[2] - p[2]) ** 2;
    if (dd < d) {
      d = dd;
      best = name;
    }
  }
  return best;
}

const neighboursOf = (i: number, rows: number, cols: number) => {
  const r = Math.floor(i / cols),
    c = i % cols;
  const out: number[] = [];
  if (c > 0) out.push(i - 1);
  if (c < cols - 1) out.push(i + 1);
  if (r > 0) out.push(i - cols);
  if (r < rows - 1) out.push(i + cols);
  return out;
};

/** Total shortfall of neighbouring gaps below `tau` (0 when every neighbour pair differs by tau). */
function crowding(vals: number[], rows: number, cols: number, tau: number): number {
  let p = 0;
  for (let i = 0; i < vals.length; i++)
    for (const j of neighboursOf(i, rows, cols))
      if (j > i) p += Math.max(0, tau - Math.abs((vals[i] as number) - (vals[j] as number)));
  return p;
}

/** Seeded swaps that never raise `crowding`: the multiset of values (its strata) is unchanged. */
function separate(vals: number[], rows: number, cols: number, tau: number, r: () => number) {
  let p = crowding(vals, rows, cols, tau);
  for (let it = 0; it < 40_000 && p > 0; it++) {
    const i = Math.floor(r() * vals.length),
      j = Math.floor(r() * vals.length);
    if (i === j) continue;
    [vals[i], vals[j]] = [vals[j] as number, vals[i] as number];
    const q = crowding(vals, rows, cols, tau);
    if (q <= p) p = q;
    else [vals[i], vals[j]] = [vals[j] as number, vals[i] as number];
  }
  return vals;
}

/** The smallest gap between neighbouring tiles' values of one axis. */
export function minNeighbourGap(vals: readonly number[], rows: number, cols: number): number {
  let m = Number.POSITIVE_INFINITY;
  for (let i = 0; i < vals.length; i++)
    for (const j of neighboursOf(i, rows, cols))
      m = Math.min(m, Math.abs((vals[i] as number) - (vals[j] as number)));
  return m;
}

export function sampleSheet(
  kind: SheetKind,
  seed: number,
  ages: readonly number[] = REVIEW_AGES,
  frames: readonly FrameDirection[] = FRAME_DIRECTIONS,
): SheetSample {
  const r = rng(seed);
  const rows = ages.length,
    cols = frames.length,
    n = rows * cols;
  const unit: Record<ScalarAxis, number[]> = {} as Record<ScalarAxis, number[]>;
  for (const k of SCALAR_KEYS)
    unit[k] =
      kind === "scatter"
        ? lhs(n, r)
        : kind === "body-extremes" || CHEST_CORNER_AXES.includes(k)
          ? ends(n, r)
          : Array.from({ length: n }, () => 0.5);
  if (kind === "scatter") {
    // Neighbours never share a size or a skin tone: at least a fifth of the range apart.
    for (const k of ["size", "melanin"] as const) unit[k] = separate(unit[k], rows, cols, 0.2, r);
  } else {
    // With two levels only a checkerboard keeps every neighbour apart, and two
    // checkerboards would tie size to skin tone. Skin tone alternates both ways; size
    // alternates along the row, so all four tone-size corners appear equally often.
    const phase = r() < 0.5 ? 0 : 1,
      sizePhase = r() < 0.5 ? 0 : 1;
    unit.melanin = Array.from(
      { length: n },
      (_, i) => (Math.floor(i / cols) + (i % cols) + phase) % 2,
    );
    // Size alternates along the row and every second row, so each column (a frame
    // direction) still sees both sizes.
    unit.size = Array.from(
      { length: n },
      (_, i) => ((i % cols) + Math.floor(Math.floor(i / cols) / 2) + sizePhase) % 2,
    );
  }

  const ethnic: [number, number, number][] = [];
  const fixedAt = new Map<number, string>();
  if (kind === "scatter") {
    const names = Object.keys(SIMPLEX_FIXED);
    // Fixed tiles spread over the sheet: distinct cells, no two in one row or column.
    const cells = shuffle(
      Array.from({ length: n }, (_, i) => i),
      r,
    );
    const usedRow = new Map<number, number>(),
      usedCol = new Map<number, number>();
    for (const cell of cells) {
      if (fixedAt.size === names.length) break;
      const ro = Math.floor(cell / cols),
        co = cell % cols;
      if ((usedRow.get(ro) ?? 0) >= 1 || (usedCol.get(co) ?? 0) >= 1) continue;
      fixedAt.set(cell, names[fixedAt.size] as string);
      usedRow.set(ro, (usedRow.get(ro) ?? 0) + 1);
      usedCol.set(co, (usedCol.get(co) ?? 0) + 1);
    }
    const free = n - fixedAt.size;
    // A seeded-shift Hammersley set: stratified in 2D jointly (independent LHS per
    // coordinate is not, and left the simplex corners thin), in a seeded order.
    const shiftU = r(),
      shiftV = r();
    const pairs = shuffle(
      Array.from({ length: free }, (_, i) => [
        (i + shiftU) / free,
        (radicalInverse2(i) + shiftV) % 1,
      ]),
      r,
    );
    const us = pairs.map((p) => p[0] as number),
      vs = pairs.map((p) => p[1] as number);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const f = fixedAt.get(i);
      ethnic.push(
        f
          ? (SIMPLEX_FIXED[f] as [number, number, number])
          : toSimplex(us[k] as number, vs[k++] as number),
      );
    }
  } else {
    const verts = shuffle(
      Array.from({ length: n }, (_, i) => i % 3),
      r,
    );
    for (const v of verts) ethnic.push([v === 0 ? 1 : 0, v === 1 ? 1 : 0, v === 2 ? 1 : 0]);
  }

  const conditions: Condition[] = [];
  for (let i = 0; i < n; i++) {
    const values = {} as Record<ScalarAxis, number>;
    for (const k of SCALAR_KEYS) {
      const [lo, hi] = SCALAR_AXES[k];
      values[k] = lo + (hi - lo) * (unit[k][i] as number);
    }
    const row = Math.floor(i / cols),
      col = i % cols;
    conditions.push({
      index: i,
      row,
      col,
      age: ages[row] as number,
      frame: frames[col] as FrameDirection,
      values,
      ethnic: ethnic[i] as [number, number, number],
      ethnicFixed:
        fixedAt.get(i) ??
        (kind !== "scatter" ? simplexRegion(ethnic[i] as [number, number, number]) : null),
    });
  }
  return { kind, seed, rows, cols, conditions };
}

/** Coverage the JSON reports and the tests assert. */
export function coverage(s: SheetSample) {
  const regions: Record<string, number> = Object.fromEntries(
    Object.keys(SIMPLEX_FIXED).map((k) => [k, 0]),
  );
  const melaninQuintiles = [0, 0, 0, 0, 0];
  let dark = 0;
  for (const c of s.conditions) {
    const reg = simplexRegion(c.ethnic);
    regions[reg] = (regions[reg] ?? 0) + 1;
    const m = c.values.melanin;
    const q = Math.min(4, Math.floor(m * 5));
    melaninQuintiles[q] = (melaninQuintiles[q] as number) + 1;
    if (m >= 0.5) dark++;
  }
  const col = (k: ScalarAxis) => s.conditions.map((c) => c.values[k]);
  return {
    simplexRegions: regions,
    melaninQuintiles,
    darkHalfFraction: dark / s.conditions.length,
    minNeighbourGap: {
      size: minNeighbourGap(col("size"), s.rows, s.cols),
      melanin: minNeighbourGap(col("melanin"), s.rows, s.cols),
    },
  };
}

/** The face modifiers a condition sets, as recipe modifier ids. */
export function faceModifiers(values: Record<ScalarAxis, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of FACE_KEYS) for (const id of FACE_AXES[k]) out[id] = values[k];
  return out;
}
