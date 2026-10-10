/**
 * Scars, birthmarks and vitiligo as paint (docs/research/BODY-ART.md, A2 to
 * A4 and C2): what each mark changes in the skin, as the per-figure texture's
 * marks page holds it, and the per-tone ratios the shader multiplies the skin
 * by. A mark changes what is in the skin, not its colour directly, so each
 * reads right at every tone through the skin model:
 *
 * - melanin, signed (`MarkChannels.melanin`, -1 to 1): down toward vitiligo's
 *   residual melanin (`vitiligoAlbedo`), up by `markMelaninSpan()` of added
 *   density. Both are absolute, not shares of the skin's own: a patch loses its
 *   melanocytes and a naevus is a nest of them, whatever the skin round them.
 *   Melanin's optical density is linear in each channel's log albedo
 *   (Beer–Lambert), so the shader's `ratio^t` moves the density linearly in t;
 * - haemoglobin (0 to 1): up toward `PORT_WINE_HAEMOGLOBIN` steps of the
 *   measured haemoglobin axis;
 * - a scar's surface: smoothness (no pores, no vellus) and raise;
 * - dermal pigment (a Mongolian spot) is not here: it lies under the epidermis
 *   like tattoo ink, so it is drawn as ink (`DERMAL_MELANIN_INK`).
 */

import {
  haemoglobinRatio,
  lipAlbedo,
  melaninDensity,
  melaninDensityAlbedo,
  type Rgb,
  type SkinTone,
  skinAlbedo,
} from "../surface/skinTone.ts";
import type { PlacedMark } from "./decals.ts";

/**
 * A vitiligo patch's melanin, as a share of a fair skin's: patches read about
 * a sixth of the skin's melanin index (Krotkova et al. 2025, mexameter, 0.10
 * to 0.26 by site), and read 1 to 5 units whatever the skin, so the residual is
 * absolute, not a share of each skin's own. It is taken as this share of
 * `VITILIGO_COHORT_MELANIN`'s density.
 */
export const VITILIGO_RESIDUAL = 0.15;
/** The melanin of that cohort's skin, on the tone axis: CHOICE (fair European skin). */
export const VITILIGO_COHORT_MELANIN = 0.15;

/**
 * The most melanin density a mark adds (`melanin` = 1): the measured tone
 * axis's whole span of density, lightest to deepest skin.
 */
export function markMelaninSpan(): number {
  const at = (melanin: number) =>
    melaninDensity({ melanin, haemoglobin: 0.5, undertone: 0, override: null });
  return at(1) - at(0);
}
/** Melanin added, shares of `markMelaninSpan()`: a café-au-lait macule (CHOICE: light brown) and a naevus (CHOICE: dark brown). */
export const CAFE_AU_LAIT_MELANIN = 0.12;
export const NAEVUS_MELANIN = 0.55;
/** Steps of the measured haemoglobin axis a port-wine stain adds (`haemoglobin` = 1). CHOICE. */
export const PORT_WINE_HAEMOGLOBIN = 4;

/**
 * Raised scars' melanin: keloids measure 1.32 times the melanin index of the
 * skin (Aoki et al. 2016), read as a density multiple of
 * `SCAR_REFERENCE_TONE`'s, added.
 */
export const RAISED_SCAR_MELANIN = 1.32;
/** How far a mature scar goes toward depigmented skin (CHOICE: paler than its skin). */
export const MATURE_SCAR_DEPIGMENT = 0.35;
/**
 * Keloids' erythema index is 1.96 times the skin's (Aoki et al. 2016):
 * a fresh or raised scar's redness is set so its log red-to-green ratio, which
 * an erythema index reads, is that multiple of the skin's, at
 * `SCAR_REFERENCE_TONE` (that cohort's skin, CHOICE on the tone axis).
 */
export const SCAR_ERYTHEMA_RATIO = 1.96;
export const SCAR_REFERENCE_TONE: Readonly<SkinTone> = {
  melanin: 0.2,
  haemoglobin: 0.5,
  undertone: 0,
  override: null,
};
/** A raised scar's height at `raised` 1, metres (CHOICE: hypertrophic scars stand 1 to 2 mm). */
export const SCAR_RAISE = 1.5e-3;
/** How much smoother (roughness) scar skin is (CHOICE: no pores or vellus). */
export const SCAR_SMOOTHNESS = 0.15;

/**
 * Dermal melanocytosis's pigment as ink: melanin deep in the dermis, a dark
 * brown seen through the epidermis and veiled by the dermis above it, which is
 * why it reads blue-grey (BODY-ART.md A1, A4). Colour and coverage are CHOICES.
 */
export const DERMAL_MELANIN_INK: Readonly<Rgb> = [0.06, 0.04, 0.03];
export const DERMAL_MELANIN_COVER = 0.75;

/** What a mark puts in the marks page at full strength (the shape scales it). */
export interface MarkChannels {
  /** -1 to 1: down toward vitiligo's residual, up by shares of `markMelaninSpan()`. */
  melanin: number;
  /** 0 to 1 of `PORT_WINE_HAEMOGLOBIN`. */
  haemoglobin: number;
  /** 0 to 1: scar skin (smooth). */
  smooth: number;
  /** 0 to 1 of `SCAR_RAISE`. */
  raise: number;
  /** Dermal pigment drawn as ink (page 0), or null. */
  ink: { colour: Rgb; cover: number } | null;
}

/** The per-tone ratios the shader raises to the marks page's channels. */
export interface MarkRatios {
  /** Vitiligo's albedo over the skin's (the melanin channel at -1). */
  light: Rgb;
  /**
   * The skin with more melanin density, over the skin, at `MARK_DARK_STEPS`
   * steps of the melanin channel from 0 to 1 (`markMelaninSpan()` more):
   * along the measured tone axis, which warms as it deepens, so the shader
   * interpolates the table rather than raising one ratio to a power, which
   * would cut straight across to the deepest skin and grey the light marks.
   */
  dark: Rgb[];
  /** `PORT_WINE_HAEMOGLOBIN` steps of haemoglobin, over the skin (the haemoglobin channel at 1). */
  blood: Rgb;
  /**
   * The skin's and the lips' albedo, and a depigmented lip's over the lip's
   * (`vitiligoLipAlbedo`): where the lips' layer mixes in, vitiligo takes each
   * of the two to its own depigmented colour.
   */
  skin: Rgb;
  lip: Rgb;
  lipLight: Rgb;
}

/**
 * Steps of `MarkRatios.dark`, at the squares of even steps of 0 to 1: the
 * measured axis is piecewise linear between its anchors, which crowd at small
 * added densities on fair skin. Interpolating the steps stays within ΔE*ab 0.5
 * of the axis at every tone, below what is visible.
 */
export const MARK_DARK_STEPS = 16;

/** The skin carrying `up` × `markMelaninSpan()` more melanin density, on the measured axis. */
export function deeperAlbedo(tone: SkinTone, up: number): Rgb {
  if (tone.override || up <= 0) return skinAlbedo(tone);
  const own = melaninDensity(tone);
  return melaninDensityAlbedo(tone, (own + up * markMelaninSpan()) / own, tone.haemoglobin);
}

/** Depigmented skin at this tone: vitiligo's absolute residual melanin, never more than the skin's own. */
export function vitiligoAlbedo(tone: SkinTone): Rgb {
  const skin = skinAlbedo(tone);
  if (tone.override) return skin;
  const residual =
    VITILIGO_RESIDUAL * melaninDensity({ ...tone, melanin: VITILIGO_COHORT_MELANIN });
  const own = melaninDensity(tone);
  if (own <= residual) return skin;
  return melaninDensityAlbedo(tone, residual / own, tone.haemoglobin);
}

/**
 * A depigmented lip at this tone, `depth` the lips' (`lipAlbedo`): the lip of
 * skin carrying vitiligo's residual melanin, the lightest measured skin's
 * where that is lighter still. Lips take their colour from the skin's
 * lightness and the blood beneath, so a lip that loses its melanin pales to
 * pink; the skin's own ratio would scale the lip's colour channel by channel
 * and, on deep skin, turned it lavender on the sheets.
 */
export function vitiligoLipAlbedo(tone: SkinTone, depth: number): Rgb {
  if (tone.override) return lipAlbedo(tone, depth);
  const residual =
    VITILIGO_RESIDUAL * melaninDensity({ ...tone, melanin: VITILIGO_COHORT_MELANIN });
  if (melaninDensity(tone) <= residual) return lipAlbedo(tone, depth);
  let lo = 0;
  let hi = Math.min(1, Math.max(0, tone.melanin));
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (melaninDensity({ ...tone, melanin: mid }) < residual) lo = mid;
    else hi = mid;
  }
  return lipAlbedo({ ...tone, melanin: (lo + hi) / 2 }, depth);
}

export function markRatios(tone: SkinTone, lips = 0.5): MarkRatios {
  const skin = skinAlbedo(tone);
  const lip = lipAlbedo(tone, lips);
  const over = (c: Rgb) => c.map((x, k) => x / Math.max(1e-6, skin[k] as number)) as Rgb;
  const overLip = vitiligoLipAlbedo(tone, lips).map(
    (x, k) => x / Math.max(1e-6, lip[k] as number),
  ) as Rgb;
  const blood = haemoglobinRatio(tone, 1).map((r) => r ** PORT_WINE_HAEMOGLOBIN) as Rgb;
  const dark = Array.from({ length: MARK_DARK_STEPS }, (_, i) =>
    over(deeperAlbedo(tone, (i / (MARK_DARK_STEPS - 1)) ** 2)),
  );
  const pair = { skin, lip, lipLight: overLip };
  if (tone.override) return { light: [1, 1, 1], dark, blood, ...pair };
  return { light: over(vitiligoAlbedo(tone)), dark, blood, ...pair };
}

/** The skin's albedo under a mark's channels (the reference the shader is held to). */
export function markedAlbedo(
  tone: SkinTone,
  c: Pick<MarkChannels, "melanin" | "haemoglobin">,
): Rgb {
  const r = markRatios(tone);
  const down = Math.max(0, -c.melanin);
  const deeper = deeperAlbedo(tone, Math.min(1, Math.max(0, c.melanin)));
  return deeper.map(
    (x, k) => x * (r.light[k] as number) ** down * (r.blood[k] as number) ** c.haemoglobin,
  ) as Rgb;
}

/**
 * The haemoglobin channel that gives a scar `SCAR_ERYTHEMA_RATIO` times the
 * skin's log red-to-green ratio at `SCAR_REFERENCE_TONE`.
 */
function scarHaemoglobin(): number {
  const skin = skinAlbedo(SCAR_REFERENCE_TONE);
  const blood = markRatios(SCAR_REFERENCE_TONE).blood;
  const own = Math.log((skin[0] as number) / (skin[1] as number));
  const step = Math.log((blood[0] as number) / (blood[1] as number));
  return ((SCAR_ERYTHEMA_RATIO - 1) * own) / step;
}
export const SCAR_HAEMOGLOBIN = scarHaemoglobin();

/** `SCAR_REFERENCE_TONE`'s melanin density as a share of `markMelaninSpan()`. */
const SCAR_REFERENCE_SHARE = melaninDensity(SCAR_REFERENCE_TONE) / markMelaninSpan();

/** What a placed mark puts in the skin at full strength. */
export function markChannels(mark: PlacedMark): MarkChannels {
  const none: MarkChannels = { melanin: 0, haemoglobin: 0, smooth: 0, raise: 0, ink: null };
  switch (mark.kind) {
    case "vitiligo":
      return { ...none, melanin: -1 };
    case "cafe-au-lait":
      return { ...none, melanin: CAFE_AU_LAIT_MELANIN };
    case "naevus":
      return { ...none, melanin: NAEVUS_MELANIN };
    case "port-wine":
      return { ...none, haemoglobin: 1 };
    case "dermal-melanocytosis":
      return {
        ...none,
        ink: { colour: [...DERMAL_MELANIN_INK] as Rgb, cover: DERMAL_MELANIN_COVER },
      };
    case "scar":
      return {
        melanin:
          (RAISED_SCAR_MELANIN - 1) * mark.raised * SCAR_REFERENCE_SHARE -
          MATURE_SCAR_DEPIGMENT * mark.maturity * (1 - mark.raised),
        haemoglobin: SCAR_HAEMOGLOBIN * Math.max(1 - mark.maturity, mark.raised),
        smooth: 1,
        raise: mark.raised,
        ink: null,
      };
  }
}
