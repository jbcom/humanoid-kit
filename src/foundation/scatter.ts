/**
 * The battery's scatter set (docs/evidence/BATTERY.md): figures that cover the
 * appearance axes the fixed bodies and tones do not. The bodies and tones are
 * one ethnic mix (MakeHuman's equal thirds) against six skin tones, plus the
 * three pure frames at one mid tone. The scatter set spreads a seeded,
 * space-filling sample over the rest: the whole ethnic simplex, melanin,
 * undertone and the facial features that most set one look from another, each
 * drawn independently of the others, because MakeHuman and the kit allow any
 * combination.
 *
 * - The ethnic mix: each of the simplex's seven anchors (`SIMPLEX_ANCHORS`:
 *   three pure vertices, three edge midpoints, the centre) is a figure twice,
 *   one of each gender and one on lighter skin and one on deeper, and the rest
 *   are a seeded Hammersley set mapped onto the simplex by its area-preserving
 *   map.
 * - Melanin, undertone and each facial feature: one value per stratum of the
 *   axis's whole range (a Latin hypercube), in a seeded order of its own.
 * - Gender alternates by tile, so a figure's face is judged on both.
 *
 * Every figure is an adult, 25 years old, at the body's defaults otherwise.
 * `batteryJson` carries the set into `scripts/sheets/battery.json`.
 */
import { seededRandom } from "../random.ts";
import {
  type EthnicMix,
  radicalInverse2,
  SIMPLEX_ANCHOR_NAMES,
  SIMPLEX_ANCHORS,
  type SimplexAnchor,
  toSimplex,
} from "../sampling.ts";

/** Facial features sampled per figure: the MakeHuman modifiers (a left and right pair set alike) of each. */
export const SCATTER_FACE_FEATURES = {
  nose: ["nose/nose-scale-horiz-decr|incr"],
  lips: ["mouth/mouth-upperlip-volume-decr|incr", "mouth/mouth-lowerlip-volume-decr|incr"],
  chin: ["chin/chin-width-decr|incr"],
  eyes: ["eyes/l-eye-epicanthus-in|out", "eyes/r-eye-epicanthus-in|out"],
  ears: ["ears/l-ear-scale-decr|incr", "ears/r-ear-scale-decr|incr"],
  cheeks: ["cheek/l-cheek-bones-decr|incr", "cheek/r-cheek-bones-decr|incr"],
} as const;
export type ScatterFaceFeature = keyof typeof SCATTER_FACE_FEATURES;
const FACE_FEATURES = Object.keys(SCATTER_FACE_FEATURES) as ScatterFaceFeature[];

/** The scatter set's size: each anchor twice, and the rest filling the simplex. */
export const SCATTER_COUNT = 30;
/** The scatter set's seed: the number of the issue that asked for it. */
export const SCATTER_SEED = 61;
/** The scatter figures' age: an adult. */
export const SCATTER_AGE = 25;

/** One scatter figure, as `createRecipe` input. */
export interface ScatterFigure {
  name: string;
  /** The simplex anchor this figure is, or null for a fill figure. */
  anchor: SimplexAnchor | null;
  macros: { age: number; gender: number; african: number; asian: number; caucasian: number };
  skin: { melanin: number; undertone: number };
  modifiers: Record<string, number>;
}

function shuffled<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

/** `n` values, one per stratum of [0, 1), jittered, in a seeded order. */
const latinHypercube = (n: number, rand: () => number): number[] =>
  shuffled(
    Array.from({ length: n }, (_, i) => (i + rand()) / n),
    rand,
  );

const round = (x: number) => Math.round(x * 1000) / 1000;

/** The scatter set: `count` figures from `seed`, the same on every machine. */
export function scatterFigures(count = SCATTER_COUNT, seed = SCATTER_SEED): ScatterFigure[] {
  const rand = seededRandom(seed);
  const anchorTiles = SIMPLEX_ANCHOR_NAMES.length * 2;
  if (count < anchorTiles)
    throw new RangeError(`a scatter set needs at least ${anchorTiles} figures`);

  // Anchors take seeded tiles, two each (one of each gender, which alternates by tile), the rest
  // fill; the fill is a shifted Hammersley set.
  const tiles = Array.from({ length: count }, (_, i) => i);
  const evens = shuffled(
    tiles.filter((i) => i % 2 === 0),
    rand,
  );
  const odds = shuffled(
    tiles.filter((i) => i % 2 === 1),
    rand,
  );
  const anchorAt = new Map<number, SimplexAnchor>();
  const anchorPairs: [number, number][] = [];
  SIMPLEX_ANCHOR_NAMES.forEach((name, k) => {
    const pair: [number, number] = [evens[k] as number, odds[k] as number];
    anchorAt.set(pair[0], name);
    anchorAt.set(pair[1], name);
    anchorPairs.push(pair);
  });
  const free = count - anchorTiles;
  const shiftU = rand();
  const shiftV = rand();
  const fill = shuffled(
    Array.from({ length: free }, (_, i) =>
      toSimplex((i + shiftU) / free, (radicalInverse2(i) + shiftV) % 1),
    ),
    rand,
  );

  const melanin = latinHypercube(count, rand);
  // An anchor's two figures split the halves of the melanin range: a swap of two tiles' melanin
  // keeps every stratum covered. Tiles that are no anchor's are free to swap with.
  const swappable = tiles.filter((i) => !anchorAt.has(i));
  for (const [a, b] of anchorPairs) {
    if ((melanin[a] as number) >= 0.5 !== (melanin[b] as number) >= 0.5) continue;
    const wantDark = (melanin[b] as number) < 0.5;
    const from = swappable.filter((i) => (melanin[i] as number) >= 0.5 === wantDark);
    const k = from[Math.floor(rand() * from.length)] as number;
    [melanin[b], melanin[k]] = [melanin[k] as number, melanin[b] as number];
  }
  const undertone = latinHypercube(count, rand);
  const features = Object.fromEntries(
    FACE_FEATURES.map((f) => [f, latinHypercube(count, rand)]),
  ) as Record<ScatterFaceFeature, number[]>;

  const figures: ScatterFigure[] = [];
  let next = 0;
  for (let i = 0; i < count; i++) {
    const anchor = anchorAt.get(i) ?? null;
    const mix: EthnicMix = anchor ? SIMPLEX_ANCHORS[anchor] : (fill[next++] as EthnicMix);
    const modifiers: Record<string, number> = {};
    for (const f of FACE_FEATURES)
      for (const id of SCATTER_FACE_FEATURES[f])
        modifiers[id] = round(-1 + 2 * (features[f][i] as number));
    figures.push({
      name: `scatter-${String(i + 1).padStart(2, "0")}`,
      anchor,
      macros: {
        age: SCATTER_AGE,
        gender: i % 2,
        african: round(mix[0]),
        asian: round(mix[1]),
        caucasian: round(1 - round(mix[0]) - round(mix[1])),
      },
      skin: {
        melanin: round(melanin[i] as number),
        undertone: round(-1 + 2 * (undertone[i] as number)),
      },
      modifiers,
    });
  }
  return figures;
}
