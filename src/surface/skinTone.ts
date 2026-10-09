/**
 * Skin albedo from a small set of physiological parameters.
 *
 * Skin colour is mostly the product of two pigments: melanin (brown–black,
 * the main axis from very fair to very deep) and haemoglobin in the dermis
 * (red, which reads as flush and warmth). Undertone shifts the balance between
 * a cooler pink and a warmer golden cast at any depth.
 *
 * The anchors are representative linear-RGB albedos spanning the natural range
 * of skin from very fair to very deep; between anchors the model interpolates
 * in linear space so mid-tones do not muddy. Any colour outside that range
 * (blue, green, grey…) is expressed with an explicit override instead.
 */

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

const hex = (h: number): Rgb => [
  srgbToLinear((h >> 16) & 255),
  srgbToLinear((h >> 8) & 255),
  srgbToLinear(h & 255),
];

/** Representative albedos from very fair (0) to very deep (1). */
const MELANIN_ANCHORS: readonly Rgb[] = [
  hex(0xf3d9c8),
  hex(0xe8c1a6),
  hex(0xd4a07e),
  hex(0xb47e5a),
  hex(0x8d5a3b),
  hex(0x5f3a24),
  hex(0x3a2216),
];

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export function skinAlbedo(tone: SkinTone): Rgb {
  if (tone.override) return [...tone.override] as Rgb;
  const t = clamp(tone.melanin, 0, 1) * (MELANIN_ANCHORS.length - 1);
  const i = Math.min(Math.floor(t), MELANIN_ANCHORS.length - 2);
  const f = t - i;
  const a = MELANIN_ANCHORS[i] as Rgb;
  const b = MELANIN_ANCHORS[i + 1] as Rgb;
  const base: Rgb = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  // Haemoglobin: more red, slightly less green/blue; its visibility fades as melanin rises.
  const h = (clamp(tone.haemoglobin, 0, 1) - 0.5) * (1 - 0.6 * clamp(tone.melanin, 0, 1));
  // Undertone: warm adds yellow (red+green over blue), cool adds pink (red+blue over green).
  const u = clamp(tone.undertone, -1, 1) * 0.06;
  const r = base[0] * (1 + 0.18 * h + Math.abs(u) * 0.4);
  const g = base[1] * (1 - 0.1 * h + (u > 0 ? u : -u * 0.5));
  const bl = base[2] * (1 - 0.12 * h + (u < 0 ? -u : -u * 0.8));
  return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(bl, 0, 1)];
}

/** Relative luminance of a linear-RGB colour. */
export const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
