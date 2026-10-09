/**
 * Stretch marks (striae distensae): how much of a figure's skin has them, how old
 * they are and so what colour, and the pattern itself. A skin layer
 * (`STRIAE_LAYER`, `regions/torso.ts`) draws them at the sites that stretch
 * (the lower trunk, hips, buttocks and thighs); this is what does not depend on the
 * mesh. Every number names its source in docs/research/SKIN-STATES.md (C7) or is
 * marked a CHOICE there.
 *
 * The pattern is the sole ridges' (`ridgeHeight`, `./ridges.ts`): sparse Gabor
 * noise gives parallel streaks of a given spacing that run on for centimetres
 * and then end, in groups, which is what stretch marks are. A mark is where the
 * noise passes a threshold, lower the more marks the figure has.
 */

import { ridgeHeight } from "./ridges.ts";
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

/** The spacing of the streaks, metres (CHOICE: marks 3 to 5 mm across with gaps of the same order, wide enough to read at the distance of a whole figure). */
export const STRIA_SPACING = 0.009;

/** The noise's threshold for a mark at an amount: the more marks, the lower, from `STRIA_THRESHOLD_BASE` (above 1: none) by `STRIA_THRESHOLD_SLOPE` an amount. */
export const STRIA_THRESHOLD_BASE = 1.04;
export const STRIA_THRESHOLD_SLOPE = 0.4;
export const striaThreshold = (amount: number): number =>
  STRIA_THRESHOLD_BASE - STRIA_THRESHOLD_SLOPE * clamp(amount);

/**
 * Where the stored orientation of the marks wraps (the sole ridges' own is
 * `RIDGE_ORIENTATION_SEAM`): at the UV direction the fewest of the sites' marks run
 * in (the noise's waves lie within 20° of the UV plane's vertical on 99% of the
 * sites, and the seam is 60° from it), so that filtering between two stored angles never takes the long way
 * round (`tests/torso.test.ts` holds the share that straddle it to a few per cent).
 */
export const STRIAE_ORIENTATION_SEAM = Math.PI / 6;
/** How soft a mark's edge is, in the noise's units. */
export const STRIA_SOFT = 0.1;

/**
 * Whether there is a mark at (`x`, `y`) metres, 0 to 1, for streaks running
 * across direction `theta` and an `amount` of marks. The shader's `hkStriae` is
 * this function.
 */
export function striaMark(x: number, y: number, theta: number, spacing: number, amount: number) {
  if (!(amount > 0)) return 0;
  const t = striaThreshold(amount);
  return smoothstep(t, t + STRIA_SOFT, ridgeHeight(x, y, theta, spacing));
}

/** The luminance of a colour ratio on a skin, as a multiple of the skin's: how much lighter the mark is. */
export function markLuminance(tone: SkinTone, ratio: Rgb): number {
  const skin = skinAlbedo(tone);
  return luminance(ratio.map((r, k) => r * (skin[k] as number)) as Rgb) / luminance(skin);
}
