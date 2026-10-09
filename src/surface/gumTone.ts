/**
 * The colour of the gums, which the teeth texture paints in a red that is not
 * the colour of any gum.
 *
 * The texture's gum texels are a dark, saturated red (mean linear
 * 0.195 / 0.039 / 0.045): MakeHuman's gum, meant to be seen through a
 * display-referred pipeline at a quarter of the screen's brightness. Here,
 * with the whole texture lifted to bring the teeth to enamel
 * (`attachmentColour`), the same lift made the gums a saturated, almost pure
 * red. Healthy gingiva is a paler coral pink, and on deeper skin carries
 * physiological melanin pigmentation, brown and patchy rather than even. The
 * teeth material therefore recolours the gum texels itself: it keeps their
 * luminance (the creases and the shading painted into the texture) and gives
 * them these hues.
 *
 * CHOICE, not measurement. "Coral pink" is the periodontology textbooks'
 * descriptor of healthy gingiva and brown patchy melanosis their description of
 * its pigmentation in people of deeper complexion (graded clinically from none
 * to heavy on the Dummett oral pigmentation index), but no table of CIELAB
 * values from them ships with this repository, so the numbers below are picked
 * to read right beside the skin and lip colours (`lipAlbedo`): paler and less
 * saturated than the lip's red, as the gum is a keratinised, thicker, less
 * vascular tissue than the lips' thin epithelium over blood. They are tuned by
 * eye against the four-tone sheet in docs/evidence/gums.md.
 */
import { type Lab, linearFromLab } from "./cielab.ts";
import type { Rgb, SkinTone } from "./skinTone.ts";

/**
 * Pale coral pink: L* 70, chroma about 29, hue about 34 degrees (the lips' red
 * is near 40, orange near 60). Lighter than the 55 to 65 a gum measures in a
 * lit mouth, because the mouth's own occlusion (`BODY_OCCLUSION_*`) shades the
 * ring round the teeth to about half before it reaches the screen.
 */
export const GUM_LAB: Readonly<Lab> = [70, 24, 16];

/**
 * The same tissue where melanin has pigmented it: darker and browner, and less
 * chromatic than the pink it covers.
 */
export const GUM_PIGMENT_LAB: Readonly<Lab> = [35, 12, 13];

/**
 * The mean luminance (linear) of the teeth texture's gum texels, measured from
 * `teeth_base_teeth.webp`: the opaque texels at least half of whose linear red
 * is not green (`GUM_SATURATION`; the texture's texels fall into two groups, the
 * tooth under 0.3 and the gum over 0.5). A test re-measures the shipped texture
 * and fails if this drifts.
 */
export const GUM_TEXTURE_MEAN_LUMINANCE = 0.072;

/** The saturation, (red - green) / red in linear light, from which a texel is gum. */
export const GUM_SATURATION = 0.5;

/**
 * The fraction of the gum that is pigmented where pigment is: none up to the
 * lightest quarter of the melanin range, and more and more beyond it, never
 * all of it (the most heavily pigmented gums still show the pink of the
 * tissue between the patches).
 */
export function gumPigmentAmount(tone: Pick<SkinTone, "melanin">): number {
  const t = Math.min(1, Math.max(0, (tone.melanin - 0.25) / 0.75));
  return 0.85 * t * t * (3 - 2 * t);
}

/** What the teeth shader takes: the colours as multiples of a texel's luminance, and the pigmented share. */
export interface GumAppearance {
  /** Linear tint of unpigmented gum: multiplied by a gum texel's luminance gives its colour. */
  base: Rgb;
  /** Linear tint of pigmented gum. */
  pigment: Rgb;
  /** The share of the gum (before patchiness) that is pigmented, 0 to 1. */
  amount: number;
}

const tint = (lab: Readonly<Lab>): Rgb => {
  const [r, g, b] = linearFromLab(lab);
  return [
    r / GUM_TEXTURE_MEAN_LUMINANCE,
    g / GUM_TEXTURE_MEAN_LUMINANCE,
    b / GUM_TEXTURE_MEAN_LUMINANCE,
  ];
};

/** The gum shader's inputs for a figure of skin `tone`. */
export function gumAppearance(tone: Pick<SkinTone, "melanin">): GumAppearance {
  return { base: tint(GUM_LAB), pigment: tint(GUM_PIGMENT_LAB), amount: gumPigmentAmount(tone) };
}
