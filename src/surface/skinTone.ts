/**
 * Skin albedo from a small set of physiological parameters.
 *
 * Skin colour is mostly the product of two pigments: melanin (brown–black,
 * the main axis from very fair to very deep) and haemoglobin in the dermis
 * (red, which reads as flush and warmth). Undertone shifts the balance between
 * a cooler pink and a warmer golden cast at any depth.
 *
 * The anchors are measured, not chosen: diffuse albedos derived from the
 * International Skin Spectra Archive (Yan et al., Scientific Data 2025, CC BY
 * 4.0; 2,113 people), facial sites binned by ITA° from 62° (very light) to
 * −75° (very deep, about the 1st percentile of all facial readings, so the
 * slider reaches the real end of the measured range rather than the middle of
 * its deepest group), medians per bin, with skin's surface reflection (F0 ≈
 * 0.028) removed because the shader adds it back as specular. Derivation and
 * sources: docs/research/SKIN-RENDERING.md. Between anchors the model
 * interpolates in linear space. Any colour outside human skin (blue, green,
 * grey…) is an explicit override instead.
 *
 * Haemoglobin and undertone are calibrated to the measured spread within a
 * lightness band: haemoglobin moves CIELAB a* by about ±3 (fading as melanin
 * absorption dominates), undertone moves b* by about ±3 at constant luminance.
 */

import { labFromLch, labFromLinear, linearFromLab } from "./cielab.ts";

export type Rgb = [number, number, number];

export interface SkinTone {
  /** 0 = very fair, 1 = very deep. */
  melanin: number;
  /** 0 = pale, 0.5 = typical, 1 = ruddy. */
  haemoglobin: number;
  /** -1 = cool/pink, 0 = neutral, 1 = warm/golden. */
  undertone: number;
  /** A linear-RGB albedo that replaces the natural model entirely (non-natural skin). */
  override: Rgb | null;
}

export const DEFAULT_SKIN_TONE: Readonly<SkinTone> = {
  melanin: 0.35,
  haemoglobin: 0.5,
  undertone: 0,
  override: null,
};

/** sRGB (0–255) → linear. */
export function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(l: number): number {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
}

/**
 * Measured diffuse albedos (linear sRGB), evenly spaced in melanin from 0
 * (ITA 62°, L* 68) to 1 (ITA −75°, L* 30; 36 readings). See the header for
 * the source.
 */
export const MELANIN_ANCHORS: readonly Readonly<Rgb>[] = [
  [0.498, 0.322, 0.271],
  [0.468, 0.286, 0.215],
  [0.429, 0.246, 0.17],
  [0.376, 0.204, 0.128],
  [0.322, 0.163, 0.093],
  [0.274, 0.132, 0.068],
  [0.213, 0.098, 0.048],
  [0.166, 0.073, 0.035],
  [0.128, 0.054, 0.028],
  [0.092, 0.04, 0.024],
  [0.061, 0.028, 0.019],
];

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Per-channel gains for haemoglobin (a*, redness) and undertone (b*, yellowness) at full strength. */
const HAEMOGLOBIN_GAIN: Rgb = [0.11, -0.07, -0.02];
const UNDERTONE_GAIN: Rgb = [0.035, 0.03, -0.17];

export function skinAlbedo(tone: SkinTone): Rgb {
  if (tone.override) return [...tone.override] as Rgb;
  const m = clamp(tone.melanin, 0, 1);
  const t = m * (MELANIN_ANCHORS.length - 1);
  const i = Math.min(Math.floor(t), MELANIN_ANCHORS.length - 2);
  const f = t - i;
  const a = MELANIN_ANCHORS[i] as Rgb;
  const b = MELANIN_ANCHORS[i + 1] as Rgb;
  const base: Rgb = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  // The gains are multiplicative, so a lighter albedo moves further in CIELAB per
  // unit; these factors flatten that to the measured spread: haemoglobin spans
  // about a* 5 (light), 5.8 (mid) and 3.6 (deep) across its range, undertone
  // about ±3 b* at every depth.
  const h = (clamp(tone.haemoglobin, 0, 1) - 0.5) * 2 * (0.42 + 0.3 * m - 0.2 * m * m);
  const u = clamp(tone.undertone, -1, 1) * (0.43 + 0.57 * m);
  const tinted = base.map(
    (c, k) => c * (1 + h * (HAEMOGLOBIN_GAIN[k] as number) + u * (UNDERTONE_GAIN[k] as number)),
  ) as Rgb;
  // Undertone and haemoglobin shift hue, not depth: keep the anchor's luminance.
  const scale = luminance(base) / Math.max(1e-6, luminance(tinted));
  return tinted.map((c) => clamp(c * scale, 0, 1)) as Rgb;
}

/** Relative luminance of a linear-RGB colour. */
export const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Skin's surface reflectance at normal incidence (ior 1.4), removed from the anchors. */
export const SKIN_F0 = 0.028;

/**
 * The skin's CIELAB lightness as a spectrophotometer reports it (specular
 * included, d/8°, as in ISSA): the diffuse albedo plus the surface reflection.
 * Models fitted against measured skin lightness take this, not the albedo's.
 */
export function measuredSkinLightness(tone: SkinTone): number {
  return labFromLinear(skinAlbedo(tone).map((c) => c + SKIN_F0) as Rgb)[0];
}

const scale = (rgb: Rgb, k: Rgb): Rgb => [rgb[0] * k[0], rgb[1] * k[1], rgb[2] * k[2]];

/**
 * Lip albedo for a skin tone; `depth` 0..1 moves it within the measured
 * within-group spread (0.5 is the population mean; higher is darker and more
 * saturated).
 *
 * Natural skin follows measured lip colour (Vergnaud 2024, Charton 2026: lips
 * of 514 women by cross-polarised hyperspectral imaging) paired with the same
 * populations' facial skin in ISSA, fitted in CIELAB: lips are well below the
 * skin's measured lightness on fair skin and reach it on the deepest, and lose
 * chroma and turn slightly yellower as they darken
 * (docs/research/SKIN-RENDERING.md §5.6). The fit's input is the skin as ISSA
 * measured it (specular included); its output is diffuse, as the lips were
 * measured, so it is an albedo directly. A non-natural colour has no human
 * data, so its lips are the override darkened and reddened by fixed factors.
 */
export function lipAlbedo(tone: SkinTone, depth: number): Rgb {
  const d = clamp(depth, 0, 1);
  if (tone.override)
    return scale(skinAlbedo(tone), [0.74 - 0.2 * d, 0.42 - 0.12 * d, 0.44 - 0.1 * d]);
  const skinL = measuredSkinLightness(tone);
  const meanL = skinL - Math.max(0, (skinL - 30) / 2);
  const L = meanL - (d - 0.5) * 8;
  const C = Math.max(0, 0.81 * meanL - 10.8 + (d - 0.5) * 8);
  const h = 31.9 - 0.375 * (meanL - 46);
  return linearFromLab(labFromLch(L, C, h)).map((c) => clamp(c, 0, 1)) as Rgb;
}

/**
 * Red-channel diffuse reflectance of skin with no melanin, the baseline
 * melanin's optical density adds to. About what depigmented (vitiligo) skin
 * reflects in the red; an approximation, not a fitted value.
 */
export const MELANIN_FREE_RED_REFLECTANCE = 0.62;

const log10 = (x: number) => Math.log10(Math.max(1e-6, x));

/**
 * Areola and nipple albedo for a skin tone; `depth` 0..1 sets how much darker.
 *
 * No colour measurement against the surrounding skin exists at any tone. The
 * areola carries about twice the melanin of breast skin (Dean et al. 2005), so
 * its melanin optical density (red channel, above `MELANIN_FREE_RED_REFLECTANCE`)
 * is the skin's times 1 + 2 × depth: twice at the default depth of 0.5, none
 * extra at 0. The tone that has that density is found on the measured melanin
 * axis. Past the deepest anchor the extra density is extrapolated per channel
 * with the slope between the two deepest anchors, so deep skin keeps a visible
 * areola instead of converging on the skin. A little more haemoglobin is added
 * throughout. A non-natural colour is darkened and reddened by fixed factors.
 */
export function areolaAlbedo(tone: SkinTone, depth: number): Rgb {
  const d = clamp(depth, 0, 1);
  if (tone.override)
    return scale(skinAlbedo(tone), [0.62 - 0.22 * d, 0.44 - 0.18 * d, 0.42 - 0.16 * d]);
  const haemoglobin = Math.min(1, clamp(tone.haemoglobin, 0, 1) + 0.25);
  const at = (melanin: number) => skinAlbedo({ ...tone, melanin, haemoglobin });
  const density = (rgb: Rgb) => -log10(rgb[0]) + log10(MELANIN_FREE_RED_REFLECTANCE);
  const target = density(at(clamp(tone.melanin, 0, 1))) * (1 + 2 * d);
  const deepest = at(1);
  const excess = target - density(deepest);
  if (excess > 0) {
    // Beyond the measured range: each channel's density grows with the red's
    // at the rate it does between the two deepest anchors.
    const [a, b] = [
      MELANIN_ANCHORS[MELANIN_ANCHORS.length - 2] as Rgb,
      MELANIN_ANCHORS[MELANIN_ANCHORS.length - 1] as Rgb,
    ];
    const red = log10(a[0]) - log10(b[0]);
    return deepest.map((c, k) => {
      const slope = (log10(a[k] as number) - log10(b[k] as number)) / red;
      return c * 10 ** (-excess * slope);
    }) as Rgb;
  }
  // Density rises monotonically with melanin: bisect for the tone that has it.
  let lo = clamp(tone.melanin, 0, 1);
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (density(at(mid)) < target) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2);
}
