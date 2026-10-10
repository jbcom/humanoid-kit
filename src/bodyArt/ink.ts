/**
 * How ink in the dermis looks through the skin (docs/research/BODY-ART.md, A1
 * and C1). Tattoo pigment lies in the superficial and middle dermis under a
 * normal epidermis, so:
 *
 * - light reaches it and returns through the epidermis's melanin, which
 *   filters it twice. That two-way transmittance is the skin's albedo over the
 *   melanin-free albedo, per channel, so the same ink darkens with the skin's
 *   tone by the skin model's own measured melanin, with no constant fitted to
 *   tattoos;
 * - the dermis above the ink scatters part of the light back before it reaches
 *   the ink, and scatters blue more than red (its scattering length grows with
 *   wavelength), so a dark pigment there reads bluer than it is. This is why
 *   black ink and dermal melanin (a Mongolian spot) look blue-grey;
 * - the light that does reach the ink crosses that dermis twice.
 *
 * The shader applies `inkOptics` to the baked ink after the layer stack and
 * before scattering; `inkSeen` is the reference it is held to.
 */
import { SKIN_SCATTER, WAVELENGTH_RATIO } from "../surface/scatter.ts";
import { melaninFreeAlbedo, type Rgb, type SkinTone, skinAlbedo } from "../surface/skinTone.ts";

/**
 * How deep the ink lies under the skin's surface, metres: a CHOICE at the top
 * of the papillary dermis, where most tattoo pigment is found (BODY-ART.md
 * A1), below an epidermis of about 0.1 mm. It sets how much the dermis above
 * veils the ink: at 0.2 mm fresh black ink on the fairest skin is L* 30 (0.3 mm
 * read greyish, L* 36, on the contact sheets).
 */
export const INK_DEPTH = 0.2e-3;

export interface InkOptics {
  /** The epidermis's two-way transmittance over the ink (the skin's melanin, twice). */
  through: Rgb;
  /** What the dermis above the ink scatters back on its own. */
  veil: Rgb;
  /** The share of light that crosses that dermis to the ink and back. */
  keep: Rgb;
}

/** The dermis's share of light it scatters back within `INK_DEPTH`, per channel. */
export function dermalVeil(): Rgb {
  return WAVELENGTH_RATIO.map((r) => {
    const length = SKIN_SCATTER.mfp * r ** SKIN_SCATTER.slope;
    return 1 - Math.exp(-INK_DEPTH / length);
  }) as Rgb;
}

/** How ink looks at a skin tone (the module header): `inkSeen` = through × (veil + keep × ink). */
export function inkOptics(tone: SkinTone): InkOptics {
  const skin = skinAlbedo(tone);
  const free = melaninFreeAlbedo(tone);
  const v = dermalVeil();
  return {
    through: skin.map((c, k) => Math.min(1, c / Math.max(1e-6, free[k] as number))) as Rgb,
    veil: v.map((x, k) => x * (free[k] as number)) as Rgb,
    keep: v.map((x) => (1 - x) * (1 - x)) as Rgb,
  };
}

/** The colour of `ink` (linear albedo) seen in skin of `tone`. */
export function inkSeen(tone: SkinTone, ink: Rgb): Rgb {
  const o = inkOptics(tone);
  return ink.map(
    (c, k) => (o.through[k] as number) * ((o.veil[k] as number) + (o.keep[k] as number) * c),
  ) as Rgb;
}
