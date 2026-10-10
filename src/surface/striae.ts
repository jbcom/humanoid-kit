/**
 * Stretch marks (striae distensae): how much of a figure's skin has them, how old
 * they are and so what colour, and the pattern itself. A skin layer
 * (`STRIAE_LAYER`, `regions/torso.ts`) draws them at the sites that stretch
 * (the lower trunk, hips, buttocks and thighs); this is what does not depend on the
 * mesh. Every number names its source in docs/research/SKIN-STATES.md (C7) or is
 * marked a CHOICE there.
 *
 * The pattern (`striaMark`) is scattered spindles: clusters of parallel marks,
 * each pointed at both ends, several centimetres long and a few millimetres
 * wide, the clusters grouped in patches with bare skin between. It is a
 * function of position, orientation and amount alone, as the sole's ridges are
 * (`./ridges.ts`, whose hash it shares), so the shader evaluates it per pixel and
 * the field atlas carries only the slowly turning direction.
 */

import { pcg2d, UNIT } from "./ridges.ts";
import {
  haemoglobinRatio,
  luminance,
  melaninDensityAlbedo,
  type Rgb,
  type SkinTone,
  skinAlbedo,
} from "./skinTone.ts";
import { type FigureBuild, pubertyProgress } from "./torsoTone.ts";

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = clamp((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * How much of the skin at the sites has marks, 0..1: none on the default figure,
 * none in a child, more above the middle weight (obesity has them in 43%, a
 * reported prevalence), and from a growth spurt in a tall adolescent
 * (adolescent prevalence 72 to 77% in girls, 6 to 86% in boys, adult non-pregnant
 * women 35%: summed over the sites, not per figure). A CHOICE of curve inside those
 * prevalences: they say who has marks, not how much of the skin they cover.
 */
export function striaeAmount(b: FigureBuild): number {
  const heavy = smoothstep(0.5, 1, b.weight);
  const tall = smoothstep(0.65, 1, b.height);
  const growing = 1 - smoothstep(14, 22, b.age);
  const sex = mix(1, 0.75, clamp(b.gender));
  return clamp(
    pubertyProgress(b.age, b.gender) * (0.85 * heavy + 0.45 * tall * (0.4 + 0.6 * growing)) * sex,
  );
}

/**
 * How old the marks are, 0 (new: red) to 1 (old: silver). They form in the growing
 * years and fade over many years: new to 13, old from 35 (a CHOICE: striae rubrae
 * turn to alba over months to years, and a figure's age is the only history it has).
 */
export const striaeMaturity = (age: number): number => smoothstep(13, 35, age);

/** How far past the haemoglobin axis a new mark's redness goes (CHOICE: the axis is a resting spread, a mark is inflamed). */
export const RUBRA_GAIN = 2;
/** How much darker a new mark is on the deepest skin, where it is violet to brown, not red (CHOICE). */
export const RUBRA_DEEP_DARKENING = 0.25;
/** An old mark's melanin, as a fraction of the skin's own optical density (CHOICE: hypopigmented, not white); and its blood, as a fraction of the tone's. */
export const ALBA_MELANIN = 0.6;
export const ALBA_HAEMOGLOBIN = 0.7;

/**
 * A mark's colour as a ratio to the skin it is on (the layer multiplies), by the
 * marks' age. New (striae rubrae): red on light skin, violet-brown and a little darker on
 * deep skin (striae nigrae and caeruleae); old (striae albae): pale, atrophic and
 * hypopigmented, which on deep skin is a large step lighter than the skin and on
 * light skin a small one. In between, a mix.
 */
export function striaeColour(tone: SkinTone, maturity: number): Rgb {
  const m = clamp(maturity);
  if (tone.override) return mix3([1, 0.9, 0.9], [1.12, 1.12, 1.12], m);
  const skin = skinAlbedo(tone);
  const melanin = clamp(tone.melanin);
  const rubra = haemoglobinRatio(tone, 1).map(
    (c) => c ** RUBRA_GAIN * (1 - RUBRA_DEEP_DARKENING * melanin),
  ) as Rgb;
  const alba = melaninDensityAlbedo(tone, ALBA_MELANIN, tone.haemoglobin * ALBA_HAEMOGLOBIN).map(
    (c, k) => c / (skin[k] as number),
  ) as Rgb;
  return mix3(rubra, alba, m);
}

const mix3 = (a: Rgb, b: Rgb, t: number): Rgb =>
  [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)] as Rgb;

/**
 * A mark's typical width, metres: the unit every other size of the pattern is
 * given in (the layer's `size`). Marks are 1 to 10 mm wide and several
 * centimetres long (clinical descriptions, docs/research/SKIN-STATES.md C7);
 * the pattern's widths run 1.3 to 7.5 mm, 3 on average, and its lengths 3 to
 * 16 cm.
 */
export const STRIA_WIDTH = 0.003;

/**
 * The pattern's shape, in typical widths (CHOICES inside the measured ranges,
 * C7). Marks come in clusters, one cluster at most to a cell of a square grid:
 * a cluster is a row of up to `STRIA_MARKS` parallel spindles side by side,
 * each with long, nearly parallel sides that taper to a point at both ends
 * (its half-width goes as 1 − t⁴ along it, t from −1 to 1).
 */
export const STRIA_CELL = 40;
/** Marks a cluster can hold, side by side. */
export const STRIA_MARKS = 8;
/** A cluster's width (its marks' widest) from `STRIA_CLUSTER_WIDTH[0]` to `[1]`, most near the narrow end. */
export const STRIA_CLUSTER_WIDTH: readonly [number, number] = [0.7, 2.5];
/** A cluster's length from `[0]` to `[1]`; each mark 0.5 to 1.2 of it, and set along it by up to 0.15 of it either way. */
export const STRIA_CLUSTER_LENGTH: readonly [number, number] = [20, 45];
/** The distance between neighbouring marks' axes, from `[0]` to `[1]`, jittered by 0.35 of it either way. */
export const STRIA_CLUSTER_SPACING: readonly [number, number] = [2, 4];
/** How far a cluster turns from the skin's own direction, radians either way. */
export const STRIA_CLUSTER_TURN = 0.14;
/**
 * Clusters group in patches of `STRIA_PATCH` × `STRIA_PATCH` cells, each with a
 * share of the clusters from `STRIA_PATCH_SHARE[0]` to the sum of both, so the
 * marks lie in groups with bare skin between.
 */
export const STRIA_PATCH = 3;
export const STRIA_PATCH_SHARE: readonly [number, number] = [0.7, 0.3];
/** The share of a cluster's places that hold a mark. */
export const STRIA_MARK_SHARE = 0.85;
/** How far past its own threshold the amount must grow for a cluster to show whole. */
export const STRIA_CLUSTER_RAMP = 0.05;
/**
 * The site mask below which the marks fade out: the mask thins the clusters
 * (it scales the amount) and, at the sites' edges, fades the marks themselves,
 * so a cluster near the edge of a site (the back's midline, where the UV islands
 * meet) tapers out rather than stopping at its full strength.
 */
export const STRIA_MASK_EDGE = 0.3;
/**
 * A mark's meander: its axis wanders `STRIA_MEANDER[0]` widths either side with
 * a wavelength of `[1]` widths, and its width swells and narrows by `[2]` of
 * itself with the same wavelength.
 */
export const STRIA_MEANDER: readonly [number, number, number] = [0.6, 50, 0.25];
/**
 * The softest a mark's edge is, in typical widths (its box filter's least
 * width): its colour's, and its relief's, which is softer so that its shallow
 * dip slopes gently into the skin rather than being cut into it.
 */
export const STRIA_SOFT = 0.15;
export const STRIA_RELIEF_SOFT = 0.8;

/**
 * Where the stored orientation of the marks wraps (the sole ridges' own is
 * `RIDGE_ORIENTATION_SEAM`): at the UV direction the fewest of the sites' marks run
 * in (the noise's waves lie within 20° of the UV plane's vertical on 99% of the
 * sites, and the seam is 60° from it), so that filtering between two stored angles never takes the long way
 * round (`tests/torso.test.ts` holds the share that straddle it to a few per cent).
 */
export const STRIAE_ORIENTATION_SEAM = Math.PI / 6;

/** The salts a cell's hashes are drawn with: one stream per draw, `STRIA_SALTS` streams a cell row. */
export const STRIA_SALTS = 64;

/** Two fractions from cell (`cx`, `cy`)'s stream `salt`: the shader's `hkStriaRandom`. */
function random(cx: number, cy: number, salt: number): [number, number] {
  const [a, b] = pcg2d((cx + 0x8000) >>> 0, (cy * STRIA_SALTS + salt + 0x8000) >>> 0);
  return [a * UNIT, b * UNIT];
}

/** How much of something whose threshold is uniform on 0..1 shows at `x` (0..1), over a ramp `r` wide. */
const ramp = (x: number, threshold: number, r: number) => clamp((x - threshold) / r);
/** Its mean over the thresholds: what share of such things show, on average. */
const rampMean = (x: number, r: number) => (x >= r ? x - r / 2 : Math.max(0, x) ** 2 / (2 * r));

/**
 * How much of a line `half` wide either side of its axis covers a pixel
 * `footprint` wide (at least `soft`) whose centre is `across` from it.
 */
function cover(across: number, half: number, footprint: number, soft: number) {
  if (!(half > 0)) return 0;
  const w = Math.max(footprint, soft);
  const lo = Math.max(across - w / 2, -half);
  const hi = Math.min(across + w / 2, half);
  return Math.max(0, hi - lo) / w;
}

/** A patch's share of clusters, from its hash. */
const patchShare = (u: number) => STRIA_PATCH_SHARE[0] + STRIA_PATCH_SHARE[1] * u;

/**
 * Whether there is a mark at (`x`, `y`) metres, 0 to 1: the share of a pixel
 * `footprint` metres across that a mark covers, for marks of typical `width`
 * whose own direction is square to `theta` (`theta` is the direction across
 * them) and an `amount` of marks, its edges no sharper than `soft` widths. The
 * shader's `hkStriae` is this function.
 *
 * Each cluster has its own threshold and fades in as the amount passes it, with
 * its own marks, so a growing amount adds clusters where there were none and
 * never moves one, and the share of the skin marked grows in proportion to the
 * amount. The marks of a cluster run along the pixel's own direction, so a
 * cluster curves as the skin's direction turns under it.
 */
export function striaMark(
  x: number,
  y: number,
  theta: number,
  width: number,
  amount: number,
  footprint = 0,
  soft = STRIA_SOFT,
): number {
  if (!(amount > 0)) return 0;
  const a = clamp(amount);
  const qx = x / width;
  const qy = y / width;
  const fw = footprint / width;
  const ix = Math.floor(qx / STRIA_CELL);
  const iy = Math.floor(qy / STRIA_CELL);
  let best = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const [h0, h1] = random(cx, cy, 0);
      const [h2, h3] = random(cx, cy, 1);
      const [h4, h5] = random(cx, cy, 2);
      const [patch] = random(Math.floor(cx / STRIA_PATCH), Math.floor(cy / STRIA_PATCH), 3);
      const shown = ramp(a * patchShare(patch), h0, STRIA_CLUSTER_RAMP);
      if (shown <= 0) continue;
      const dx = qx - (cx + h1) * STRIA_CELL;
      const dy = qy - (cy + h2) * STRIA_CELL;
      // The cluster's own direction across its marks, and along them.
      const turn = theta + (2 * h3 - 1) * STRIA_CLUSTER_TURN;
      const nx = Math.cos(turn);
      const ny = Math.sin(turn);
      const across = dx * nx + dy * ny;
      const along = -dx * ny + dy * nx;
      const clusterWidth =
        STRIA_CLUSTER_WIDTH[0] + (STRIA_CLUSTER_WIDTH[1] - STRIA_CLUSTER_WIDTH[0]) * h4 * h4;
      const length =
        STRIA_CLUSTER_LENGTH[0] + (STRIA_CLUSTER_LENGTH[1] - STRIA_CLUSTER_LENGTH[0]) * h5;
      const [s0] = random(cx, cy, 4);
      const spacing =
        STRIA_CLUSTER_SPACING[0] + (STRIA_CLUSTER_SPACING[1] - STRIA_CLUSTER_SPACING[0]) * s0;
      // Only the places either side of the nearest can reach the pixel: the marks are narrower than their spacing.
      const near = Math.round(across / spacing + (STRIA_MARKS - 1) / 2);
      for (let k = Math.max(0, near - 1); k <= Math.min(STRIA_MARKS - 1, near + 1); k++) {
        const [m0, m1] = random(cx, cy, 8 + k);
        const [m2, m3] = random(cx, cy, 24 + k);
        if (m0 >= STRIA_MARK_SHARE) continue;
        const markLength = length * (0.5 + 0.7 * m2);
        const t = (2 * (along - (m3 - 0.5) * 0.3 * length)) / markLength;
        if (t <= -1 || t >= 1) continue;
        const [m4, m5] = random(cx, cy, 40 + k);
        const phase = (2 * Math.PI * along) / STRIA_MEANDER[1];
        const wave = Math.sin(phase + 2 * Math.PI * m4);
        const swell = 1 + STRIA_MEANDER[2] * Math.sin(phase + 2 * Math.PI * m5);
        const t2 = t * t;
        const bow = 1 - t2;
        const half = 0.5 * clusterWidth * (0.6 + 0.4 * m1) * (1 - t2 * t2) * swell;
        // Off its place by up to 0.35 of the spacing, its middle bowed off its chord by up to a third
        // of a width, and wandering about it.
        const axis =
          (k - (STRIA_MARKS - 1) / 2) * spacing +
          (m1 - 0.5) * 0.7 * spacing +
          (m3 - 0.5) * 0.6 * bow +
          STRIA_MEANDER[0] * wave;
        best = Math.max(best, shown * cover(across - axis, half, fw, soft));
      }
    }
  return best;
}

/**
 * The share of the skin `striaMark` marks at an `amount`, on average: what the
 * marks blend to where a pixel holds many of them. Each mark's area is four
 * fifths of its width times its length (the mean of 1 − t⁴); overlaps are left
 * out, as marks lie narrower than their spacing.
 */
export function striaeMeanCover(amount: number): number {
  const a = clamp(amount);
  if (a <= 0) return 0;
  // A cluster's chance, over its patch's share: a midpoint rule on the share's uniform hash.
  const Q = STRIAE_MEAN_SAMPLES;
  let clusters = 0;
  for (let q = 0; q < Q; q++)
    clusters += rampMean(a * patchShare((q + 0.5) / Q), STRIA_CLUSTER_RAMP);
  clusters /= Q;
  const marks = STRIA_MARKS * STRIA_MARK_SHARE;
  return clusters * marks * STRIA_MARK_AREA;
}

/**
 * A whole mark's mean area as a share of a cell's: four fifths of its mean width
 * (the cluster's, skewed by its hash squared to a third of the range, × 0.8) by
 * its mean length (the cluster's × 0.85).
 */
export const STRIA_MARK_AREA =
  ((4 / 5) *
    (STRIA_CLUSTER_WIDTH[0] + (STRIA_CLUSTER_WIDTH[1] - STRIA_CLUSTER_WIDTH[0]) / 3) *
    0.8 *
    ((STRIA_CLUSTER_LENGTH[0] + STRIA_CLUSTER_LENGTH[1]) / 2) *
    0.85) /
  STRIA_CELL ** 2;

/** The midpoint samples `striaeMeanCover` averages a patch's share over (the shader's loop). */
export const STRIAE_MEAN_SAMPLES = 16;
/**
 * The footprints, in typical widths, over which the marks' colour blends from
 * the marks themselves to their mean (a pixel that holds many marks shows what
 * they average to, not one of them aliased), and over which their relief fades
 * out (its slope is a screen derivative, which aliases sooner than a colour).
 */
export const STRIAE_DETAIL_FADE: readonly [number, number] = [0.5, 1.5];
export const STRIAE_RELIEF_FADE: readonly [number, number] = [0.3, 0.8];

/** How much of the marks' detail shows at a footprint (in typical widths) over a fade's range. */
export const striaeDetail = (footprint: number, fade: readonly [number, number]): number =>
  1 - smoothstep(fade[0], fade[1], footprint);

/**
 * The marks' colour weight at (`x`, `y`) metres for a pixel `footprint` metres
 * across, on a figure with `amount` of marks where the site mask is `mask`: the
 * marks themselves where a pixel resolves them, their mean cover where it does
 * not (`STRIAE_DETAIL_FADE`), faded at the sites' edges (`STRIA_MASK_EDGE`).
 * The shader's colour weight is this, times the layer's strength.
 */
export function striaeWeight(
  x: number,
  y: number,
  theta: number,
  width: number,
  amount: number,
  mask: number,
  footprint: number,
): number {
  const a = amount * mask;
  if (!(a > 0)) return 0;
  const edge = smoothstep(0, STRIA_MASK_EDGE, mask);
  const detail = striaeDetail(footprint / width, STRIAE_DETAIL_FADE);
  const mean = striaeMeanCover(a);
  if (detail <= 0) return edge * mean;
  return edge * mix(mean, striaMark(x, y, theta, width, a, footprint), detail);
}

/** The luminance of a colour ratio on a skin, as a multiple of the skin's: how much lighter the mark is. */
export function markLuminance(tone: SkinTone, ratio: Rgb): number {
  const skin = skinAlbedo(tone);
  return luminance(ratio.map((r, k) => r * (skin[k] as number)) as Rgb) / luminance(skin);
}
