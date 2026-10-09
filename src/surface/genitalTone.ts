/**
 * The colour of external genital skin, and how it deepens with arousal. The
 * colour code of the adult anatomy's skin layers; the data its masks come from
 * is in the adult anatomy pack (src/surface/regions/adult.ts).
 *
 * None of this is calibrated, and the model says so rather than pretend. A
 * search of the open literature found no colorimetry or spectroscopy of
 * scrotal, penile, labial or perianal skin by skin type, and no measured colour
 * change with arousal at any skin tone (docs/research/SKIN-STATES.md, A4 and
 * B4: only a lighter-skin forensic series whose per-site values were not
 * retrievable, and the physiology of engorgement). What is used instead is the
 * reasoning the existing areola colour uses (`areolaAlbedo`): move along the
 * measured melanin axis, which converges on the skin at the deep end because
 * the skin already absorbs most of what more melanin would, and add
 * haemoglobin where the skin is thin and unpigmented (mucosa and thin
 * keratin), through the same haemoglobin model `skinAlbedo` measures (its
 * a\* shift fades as melanin rises, so the same change is smaller on deep
 * skin without a separate rule). The sizes of the shifts are choices, not
 * measurements, and a figure whose application needs measured genital colour
 * should override the layers' paint.
 */
import { type Rgb, type SkinTone, skinAlbedo } from "./skinTone.ts";

export type GenitalSite = "shaft" | "glans" | "scrotum" | "mound";

interface SiteModel {
  /** Added to the tone's melanin (0..1): genital skin is more pigmented than its surroundings. */
  melanin: number;
  /** Added to the tone's haemoglobin: thin, vascular, unpigmented skin shows more blood. */
  haemoglobin: number;
  /**
   * How far full arousal moves haemoglobin toward its ceiling, as a fraction of
   * the headroom the rest colour leaves (a modelled deepening). A fraction, not
   * an amount, so a site already near the ceiling still deepens and none passes it.
   */
  arousal: number;
  /** For a non-natural skin colour: per-channel factors on the override. */
  override: Rgb;
}

const SITES: Record<GenitalSite, SiteModel> = {
  // Keratinised skin, somewhat more pigmented than the body.
  shaft: { melanin: 0.2, haemoglobin: 0.1, arousal: 0.6, override: [0.66, 0.48, 0.46] },
  // Non-keratinised and thin: the haemoglobin shows through and little pigment sits above it.
  glans: { melanin: 0.1, haemoglobin: 0.3, arousal: 0.8, override: [0.74, 0.4, 0.42] },
  // Thin, rugose skin; the most pigmented of the sites.
  scrotum: { melanin: 0.25, haemoglobin: 0.05, arousal: 0.25, override: [0.62, 0.46, 0.44] },
  // The mons: ordinary skin with a small shift.
  mound: { melanin: 0.1, haemoglobin: 0.05, arousal: 0, override: [0.82, 0.66, 0.62] },
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * The albedo of a genital site for a skin tone; `arousal` 0..1 deepens it
 * (modelled, uncalibrated: see the header).
 */
export function genitalAlbedo(tone: SkinTone, site: GenitalSite, arousal = 0): Rgb {
  const s = SITES[site];
  const a = clamp01(arousal);
  if (tone.override) {
    const base = skinAlbedo(tone);
    // A non-natural colour has no blood to deepen: arousal reddens it by the
    // site's share of the natural deepening (green and blue fall, red stays).
    const k = 1 - 0.2 * s.arousal * a;
    return [base[0] * s.override[0], base[1] * s.override[1] * k, base[2] * s.override[2] * k];
  }
  const rest = Math.min(1, clamp01(tone.haemoglobin) + s.haemoglobin);
  return skinAlbedo({
    ...tone,
    melanin: Math.min(1, clamp01(tone.melanin) + s.melanin),
    haemoglobin: rest + (1 - rest) * s.arousal * a,
  });
}
