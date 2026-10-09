/**
 * The colours of the hand's own skin: the palm, the knuckles and the nail.
 * The colour code of the hand layers (src/surface/regions/hands/).
 *
 * The palm and the nail are measured in CIELAB against the skin around them
 * and placed by the skin's own measured lightness, so they hold at every tone
 * without a rule per tone; the knuckles stay on the skin model's measured
 * melanin axis. Which numbers are measured and which are choices is in
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

/**
 * The nail (bed seen through the plate) as a colorimeter reads it: Horibata et
 * al. 2025 (J Gen Fam Med, CC BY-NC; 67 non-anaemic Japanese adults), L\* 54.3,
 * a\* 4.9, b\* 10.1, darker and far less saturated than their palms (61.2, 8.0,
 * 15.3). Its a\* and b\* are kept at every tone: no nail colour was measured by
 * tone (CHOICE).
 */
export const NAIL_LAB: Lab = [54.3, 4.9, 10.1];

/**
 * How the nail's lightness follows the skin's, L\* per L\*. The nail bed has
 * about 5% of skin's melanocytes (the melanometry review in Communications
 * Medicine 2024), and across Fitzpatrick I to VI the fingernail's ITA spans
 * −9.8° to 68.1° where the forehead's spans −65.7° to 44.7° (Leeb et al. 2024,
 * eBioMedicine, CC BY; 34 adults, 9 of them V to VI). Mapping the darkest
 * person's forehead to the darkest nail at the nail's b\* puts a nail of L\* 48
 * on skin of L\* about 23, and Horibata's nail of 54.3 on skin of about 62 (the
 * archive's Japanese back of hand): 0.15 L\* per L\* between them. A derivation
 * from two ranges' ends, so marked as such in SKIN-STATES.md C5.
 */
export const NAIL_LIGHTNESS = { skinL: 62, nailL: 54.3, slope: 0.154 } as const;

/**
 * The nail plate's surface reflection at normal incidence, removed from the
 * measured colour because the shader adds the plate's gloss back: keratin's
 * refractive index of about 1.47 (an assumed value in nail OCT, Saleah et al.
 * 2021), F0 = ((n − 1) / (n + 1))².
 */
export const NAIL_F0 = ((1.47 - 1) / (1.47 + 1)) ** 2;

/**
 * Keratin of the nail plate, linear RGB, where it scatters rather than
 * transmits: the free edge (plate over air). A CHOICE: an ivory white, as no
 * free-edge colour was found measured.
 */
export const NAIL_KERATIN: Rgb = [0.62, 0.58, 0.5];

/**
 * How much keratin white the lunula (the matrix seen through the plate) shows
 * over the bed (CHOICE: no lunula colour was found measured).
 */
const LUNULA_OVER_BED = 0.4;

/** The proximal nail fold's melanin density relative to the skin (CHOICE: periungual skin is a little darker). */
export const NAIL_FOLD_MELANIN_FACTOR = 1.15;

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export interface NailColours {
  /** The proximal nail fold and cuticle. */
  fold: Rgb;
  /** The lunula: the matrix's white crescent. */
  lunula: Rgb;
  /** The bed, seen through the plate. */
  bed: Rgb;
  /** The free edge, beyond the bed. */
  freeEdge: Rgb;
}

/** The nail's CIELAB (surface reflection included) for a tone: `NAIL_LAB` at the lightness `NAIL_LIGHTNESS` gives. */
export function nailLab(tone: SkinTone): Lab {
  const L =
    NAIL_LIGHTNESS.nailL + NAIL_LIGHTNESS.slope * (measuredSkinLab(tone)[0] - NAIL_LIGHTNESS.skinL);
  return [L, NAIL_LAB[1], NAIL_LAB[2]];
}

/**
 * The nail's colours for a skin tone: the bed from `nailLab`, the lunula a
 * little whiter, the free edge keratin white, the fold slightly darker skin.
 * The bed varies far less across tones than the skin around it, so on deep
 * skin the nails are much lighter than the fingers. A non-natural colour keeps
 * its own colour under the keratin.
 */
export function nailColours(tone: SkinTone): NailColours {
  const h = clamp01(tone.haemoglobin);
  const bed = tone.override
    ? scale(skinAlbedo(tone), [1.05, 0.9, 0.92])
    : albedoFromMeasured(nailLab(tone), NAIL_F0);
  const fold = tone.override
    ? scale(skinAlbedo(tone), [0.94, 0.9, 0.9])
    : melaninDensityAlbedo(tone, NAIL_FOLD_MELANIN_FACTOR, Math.min(1, h + 0.1));
  return {
    fold,
    lunula: mixRgb(bed, NAIL_KERATIN, LUNULA_OVER_BED),
    bed,
    freeEdge: NAIL_KERATIN,
  };
}
