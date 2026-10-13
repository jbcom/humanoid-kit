/**
 * Space-filling samples of appearance, and the coverage that measures them.
 *
 * MakeHuman's ethnic axes are a continuous simplex (`african`, `asian` and
 * `caucasian`, summing to 1) and skin colour is a separate axis: any mix goes
 * with any melanin. A set of figures covers appearance when it reaches the
 * simplex's three vertices (the pure frames), its three edges (the mixed
 * ones) and its middle, and spreads melanin over the whole range
 * independently of the mix. This module holds the points of that simplex, the
 * maps that sample it evenly, and `appearanceCoverage`, which reports how
 * well a set of figures does. It adds no restriction of its own to the axes.
 */

/** A point of the ethnic simplex: african, asian and caucasian, summing to 1. */
export type EthnicMix = readonly [african: number, asian: number, caucasian: number];

/**
 * The simplex's seven reference points: the three pure vertices, the three
 * edge midpoints (two anchors in equal parts) and the centre (all three).
 * Sampling and coverage both name regions of the simplex by them.
 */
export const SIMPLEX_ANCHORS = {
  african: [1, 0, 0],
  asian: [0, 1, 0],
  caucasian: [0, 0, 1],
  "african-asian": [0.5, 0.5, 0],
  "asian-caucasian": [0, 0.5, 0.5],
  "african-caucasian": [0.5, 0, 0.5],
  centre: [1 / 3, 1 / 3, 1 / 3],
} as const satisfies Record<string, EthnicMix>;

export type SimplexAnchor = keyof typeof SIMPLEX_ANCHORS;

/** The anchors in a fixed order: vertices, then edge midpoints, then the centre. */
export const SIMPLEX_ANCHOR_NAMES = Object.keys(SIMPLEX_ANCHORS) as readonly SimplexAnchor[];

/** The three pure vertices: one anchor of the ethnic simplex each. */
export const PURE_ANCHORS = ["african", "asian", "caucasian"] as const;
export type PureAnchor = (typeof PURE_ANCHORS)[number];

/**
 * A mix counts as a pure frame of one anchor when that anchor's share is at
 * least this much. Pure frames sit at the vertices, which draws of any
 * area-uniform sampler rarely land near (1% of draws per vertex), so the
 * coverage names them separately from the wider vertex regions.
 */
export const PURE_SHARE = 0.9;

/**
 * The area-preserving map of the unit square onto the simplex: a uniform
 * point of the square is a uniform point of the simplex. Corners are sampled
 * as densely as the middle, in proportion to their area.
 */
export function toSimplex(u: number, v: number): EthnicMix {
  const s = Math.sqrt(u);
  return [1 - s, s * (1 - v), s * v];
}

/** Of every draw by `randomEthnicMix`, the share that lands on an anchor (the rest fill the simplex). */
export const ANCHOR_DRAW_SHARE = 0.5;

/**
 * How far an anchor draw strays from its anchor: the simplex shrunk to this
 * fraction of its size about the anchor. At 0.1 a draw at a vertex still holds
 * at least 93% of that anchor, so it is a pure frame.
 */
export const ANCHOR_SPREAD = 0.1;

/**
 * A point of the ethnic simplex from three uniform draws in [0, 1).
 *
 * Half the draws (`ANCHOR_DRAW_SHARE`) land near one of the seven anchors,
 * taken in equal parts: each vertex, edge midpoint and the centre, with a small
 * area-uniform spread (`ANCHOR_SPREAD`) about it. The other half cover the whole
 * simplex area-uniformly. A uniform draw alone reaches a pure frame in about 1%
 * of draws per vertex, however evenly it is spread; the anchors give the pure,
 * mixed and middle looks equal weight and the fill reaches every mix between.
 * Every point of the simplex has some chance, and no axis is clamped.
 */
export function randomEthnicMix(pick: number, u: number, v: number): EthnicMix {
  const spot = toSimplex(u, v);
  if (pick < ANCHOR_DRAW_SHARE) return spot;
  const k = Math.min(
    SIMPLEX_ANCHOR_NAMES.length - 1,
    Math.floor(
      ((pick - ANCHOR_DRAW_SHARE) / (1 - ANCHOR_DRAW_SHARE)) * SIMPLEX_ANCHOR_NAMES.length,
    ),
  );
  const a: EthnicMix = SIMPLEX_ANCHORS[SIMPLEX_ANCHOR_NAMES[k] as SimplexAnchor];
  const s = ANCHOR_SPREAD;
  return [a[0] + s * (spot[0] - a[0]), a[1] + s * (spot[1] - a[1]), a[2] + s * (spot[2] - a[2])];
}

/** The base-2 radical inverse (van der Corput sequence) of a non-negative integer. */
export function radicalInverse2(i: number): number {
  let x = 0;
  let f = 0.5;
  for (let n = i; n > 0; n = Math.floor(n / 2), f /= 2) if (n % 2 === 1) x += f;
  return x;
}

/**
 * The nearest anchor to a mix (its Voronoi region of the simplex), ties to the
 * earlier one in `SIMPLEX_ANCHOR_NAMES`.
 */
export function simplexRegion(mix: EthnicMix): SimplexAnchor {
  let best: SimplexAnchor = "centre";
  let nearest = Number.POSITIVE_INFINITY;
  for (const name of SIMPLEX_ANCHOR_NAMES) {
    const p: EthnicMix = SIMPLEX_ANCHORS[name];
    const d = (mix[0] - p[0]) ** 2 + (mix[1] - p[1]) ** 2 + (mix[2] - p[2]) ** 2;
    if (d < nearest - 1e-12) {
      nearest = d;
      best = name;
    }
  }
  return best;
}

/** The pure anchor a mix is a frame of (its share at least `PURE_SHARE`), or null. */
export function pureAnchor(mix: EthnicMix): PureAnchor | null {
  for (let i = 0; i < PURE_ANCHORS.length; i++)
    if ((mix[i] as number) >= PURE_SHARE) return PURE_ANCHORS[i] as PureAnchor;
  return null;
}

/** A figure as the coverage sees it: its ethnic mix and its skin's melanin. */
export interface AppearanceSample {
  mix: EthnicMix;
  /** 0 very fair .. 1 very deep. */
  melanin: number;
}

/** Melanin is counted in this many equal bands. */
export const MELANIN_BANDS = 5;

export interface AppearanceCoverage {
  count: number;
  /** Figures per simplex region (`simplexRegion`): the vertices, edges and centre. */
  regions: Record<SimplexAnchor, number>;
  /** Figures that are a pure frame of each anchor (`pureAnchor`). */
  pure: Record<PureAnchor, number>;
  /** Figures per melanin band, light to deep (`MELANIN_BANDS` equal bands of 0..1). */
  melaninBands: number[];
  /** The share with melanin of 0.5 or more. */
  darkHalf: number;
  /**
   * Figures per ethnic vertex region and melanin half (`light`, `dark`): a mix
   * is not tied to a skin tone, so every vertex has both.
   */
  vertexByHalf: Record<PureAnchor, { light: number; dark: number }>;
}

/** How well a set of figures covers the ethnic simplex and the melanin range. */
export function appearanceCoverage(samples: readonly AppearanceSample[]): AppearanceCoverage {
  const regions = Object.fromEntries(SIMPLEX_ANCHOR_NAMES.map((n) => [n, 0])) as Record<
    SimplexAnchor,
    number
  >;
  const pure = { african: 0, asian: 0, caucasian: 0 };
  const vertexByHalf = {
    african: { light: 0, dark: 0 },
    asian: { light: 0, dark: 0 },
    caucasian: { light: 0, dark: 0 },
  };
  const melaninBands = new Array<number>(MELANIN_BANDS).fill(0);
  let dark = 0;
  for (const s of samples) {
    const region = simplexRegion(s.mix);
    regions[region]++;
    const p = pureAnchor(s.mix);
    if (p) pure[p]++;
    const band = Math.min(MELANIN_BANDS - 1, Math.max(0, Math.floor(s.melanin * MELANIN_BANDS)));
    melaninBands[band] = (melaninBands[band] as number) + 1;
    const half = s.melanin >= 0.5 ? "dark" : "light";
    if (half === "dark") dark++;
    if (region === "african" || region === "asian" || region === "caucasian")
      vertexByHalf[region][half]++;
  }
  return {
    count: samples.length,
    regions,
    pure,
    melaninBands,
    darkHalf: samples.length ? dark / samples.length : 0,
    vertexByHalf,
  };
}
