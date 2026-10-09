/**
 * The colours of the hand's own skin. The colour code of the hand layers
 * (src/surface/regions/hands.ts).
 *
 * The palm is measured in CIELAB against the skin around it and placed by the
 * skin's own measured lightness, so it holds at every tone without a rule per
 * tone; the knuckles stay on the skin model's measured melanin axis. Which
 * numbers are measured and which are choices is in
 * docs/research/SKIN-STATES.md, Part C5.
 */
import { type Lab, labFromLinear, linearFromLab } from "./cielab.ts";
import { melaninDensityAlbedo, type Rgb, SKIN_F0, type SkinTone, skinAlbedo } from "./skinTone.ts";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const scale = (rgb: Rgb, k: Rgb): Rgb => [rgb[0] * k[0], rgb[1] * k[1], rgb[2] * k[2]];

/** The skin's CIELAB as a spectrophotometer reads it (surface reflection included, as ISSA measured). */
const measuredSkinLab = (tone: SkinTone): Lab =>
  labFromLinear(skinAlbedo(tone).map((c) => c + SKIN_F0) as Rgb);

/** A CIELAB colour measured with the surface reflection included, as a diffuse albedo without it. */
const albedoFromMeasured = (lab: Lab, f0: number): Rgb =>
  linearFromLab(lab).map((c) => clamp01(c - f0)) as Rgb;

/**
 * Palm against the back of the hand, paired within each person: the
 * International Skin Spectra Archive (Lu et al., Sci Data 2025; CC BY 4.0;
 * the archive the skin model's tones come from), the 777 people measured at
 * both sites, binned by the back of the hand's L\* (below 35, 35 to 45, 45 to
 * 55, 55 to 65, above 65). Each row: the bin's mean back-of-hand L\*, a\*, b\*,
 * then its mean palm L\*, a\*, b\*, and how many people. Specular included
 * (SCI), as the model's skin lightness is.
 */
export const PALM_BINS: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  [31.79, 8.84, 9.74, 48.24, 11.04, 17.7, 45],
  [38.84, 10.74, 15.01, 53.4, 11.23, 16.81, 28],
  [51.83, 10.53, 17.36, 58.7, 10.38, 14.77, 122],
  [59.92, 8.78, 16.9, 62.73, 9.03, 14.14, 518],
  [67.05, 7.22, 16.0, 66.63, 8.08, 14.57, 64],
];

/** `PALM_BINS` interpolated at back-of-hand L\* `L` (held at the end bins): the palm's L\* and its a\*, b\* above the back's. */
function palmBin(L: number): { L: number; da: number; db: number } {
  const rows = PALM_BINS;
  const first = rows[0] as (typeof rows)[number];
  const last = rows[rows.length - 1] as (typeof rows)[number];
  const at = (r: (typeof rows)[number]) => ({ L: r[3], da: r[4] - r[1], db: r[5] - r[2] });
  if (L <= first[0]) return at(first);
  if (L >= last[0]) return at(last);
  let i = 0;
  while ((rows[i + 1] as (typeof rows)[number])[0] < L) i++;
  const a = at(rows[i] as (typeof rows)[number]);
  const b = at(rows[i + 1] as (typeof rows)[number]);
  const r0 = (rows[i] as (typeof rows)[number])[0];
  const t = (L - r0) / ((rows[i + 1] as (typeof rows)[number])[0] - r0);
  return { L: a.L + (b.L - a.L) * t, da: a.da + (b.da - a.da) * t, db: a.db + (b.db - a.db) * t };
}

/**
 * The palm's CIELAB (surface reflection included) for a tone: the measured
 * palm lightness at the skin's lightness (`PALM_BINS`), and the skin's own a\*
 * and b\* moved by the measured palm-minus-back difference, so a ruddy or
 * golden figure keeps its cast on the palm. The figure's skin stands for the
 * back of its hand (a CHOICE: the tone's anchors are facial readings).
 */
export function palmLab(tone: SkinTone): Lab {
  const [L, a, b] = measuredSkinLab(tone);
  const bin = palmBin(L);
  return [bin.L, a + bin.da, b + bin.db];
}

/** A non-natural colour has no melanin to lose: its palm is the override lightened by fixed factors. */
const PALM_OVERRIDE: Rgb = [1.18, 1.14, 1.1];

/**
 * Palm albedo (`palmLab`, its surface reflection removed, since the shader
 * adds it back). On deep skin the palm is about 16 L\* lighter than the back of
 * the hand and yellower (b\* +6 to +8); on the lightest it is about the same,
 * as measured.
 */
export function palmAlbedo(tone: SkinTone): Rgb {
  if (tone.override) return scale(skinAlbedo(tone), PALM_OVERRIDE);
  return albedoFromMeasured(palmLab(tone), SKIN_F0);
}

/**
 * Melanin optical density over the knuckles, relative to the back of the hand.
 * A CHOICE: no knuckle colour was measured at any tone (SKIN-STATES.md A2, C5).
 * It is bounded by the only measured site ratio, photoexposed against
 * protected skin, 1.6 in Fitzpatrick V to VI and up to 2 across groups
 * (Alaluf 2001, 2002), and set below it because the back of the hand is itself
 * exposed.
 */
export const KNUCKLE_MELANIN_FACTOR = 1.35;

/**
 * Haemoglobin added over the knuckles: extended joints are redder (highest
 * a\* at the extended elbow of 53 women, J Clin Med 2024, SKIN-STATES.md A2,
 * which ranks sites but gives no value); the size is a CHOICE.
 */
export const KNUCKLE_HAEMOGLOBIN = 0.15;

/**
 * Knuckle albedo: more melanin (`KNUCKLE_MELANIN_FACTOR`) and a little more
 * blood (`KNUCKLE_HAEMOGLOBIN`). The factor multiplies optical density, so
 * fair skin's knuckles mostly redden and deep skin's darken, as observed.
 */
export function knuckleAlbedo(tone: SkinTone): Rgb {
  if (tone.override) return scale(skinAlbedo(tone), [0.9, 0.86, 0.86]);
  return melaninDensityAlbedo(
    tone,
    KNUCKLE_MELANIN_FACTOR,
    Math.min(1, clamp01(tone.haemoglobin) + KNUCKLE_HAEMOGLOBIN),
  );
}
