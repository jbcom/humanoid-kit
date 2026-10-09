/**
 * The colour and density of brows and lashes (docs/ARCHITECTURE.md, "Eyebrows
 * and eyelashes"). One hair colour (`recipe.hair.colour`: eumelanin,
 * pheomelanin, grey, or an override) drives the scalp, the brows and the
 * lashes, so a figure's hair is one colour and its pigments' physics
 * (`hairAlbedo`) the same everywhere.
 *
 * CHOICE, not measurement. The brows are the hair's own colour, lifted by a power
 * (`BROW_LIFT`, 0.8): a brow is thin, dark against skin, and lit like the face, so
 * the studio's tone curve crushes its blue and its shadows (blonde read olive, an
 * albedo of 0.21, 0.13, 0.05 came out at a third of its blue relative to its red
 * on the first sheets), and a gentle power keeps a blonde's brow golden and a white
 * one warm without lightening a black one. The lashes are
 * darker by a fixed factor, as lashes are on almost everyone, fair and red-haired
 * people most of all, whose lashes and brows read darker than their scalp hair;
 * a single factor on the albedo keeps a lash's hue and sets its depth. A young
 * child's brows and lashes are finer and fewer: the decal's opacity (the
 * share of its cut-out the renderer keeps) rises from a toddler's to full by the
 * teens, brows later and from sparser than lashes. No source of density by age
 * ships here, so the ramps are art-directed numbers, tuned against
 * docs/evidence/brows.md.
 */
import { type HairColour, hairAlbedo } from "./hairTone.ts";
import type { Rgb } from "./skinTone.ts";

export type DecalKind = "brows" | "lashes";

/** The power the hair's albedo is raised to for a brow (below 1 lifts the dark channels most). */
export const BROW_LIFT = 0.8;

/** The share of the brows' albedo a lash has. */
export const LASH_DARKEN = 0.55;

/** The brows' colour: the hair's, lifted (`BROW_LIFT`), linear. */
export function browColour(colour: HairColour): Rgb {
  const [r, g, b] = hairAlbedo(colour);
  return [r ** BROW_LIFT, g ** BROW_LIFT, b ** BROW_LIFT];
}

/** The lashes' colour: the brows', darker by `LASH_DARKEN`. */
export function lashColour(colour: HairColour): Rgb {
  const [r, g, b] = browColour(colour);
  return [r * LASH_DARKEN, g * LASH_DARKEN, b * LASH_DARKEN];
}

/** The opacity of a decal at the youngest age (0 years), by kind, rising to 1 by `DECAL_FULL_AT`. */
export const DECAL_OPACITY: Readonly<Record<DecalKind, { youngest: number }>> = {
  brows: { youngest: 0.45 },
  lashes: { youngest: 0.7 },
};

/** The age (years) at which brows and lashes are full. */
export const DECAL_FULL_AT = 14;

/** How much of a brow or lash a figure of `age` years keeps: `youngest` at birth, 1 from `DECAL_FULL_AT`. */
export function decalOpacity(kind: DecalKind, age: number | undefined): number {
  if (age === undefined) return 1;
  const t = Math.min(1, Math.max(0, age / DECAL_FULL_AT));
  const s = t * t * (3 - 2 * t);
  const { youngest } = DECAL_OPACITY[kind];
  return youngest + (1 - youngest) * s;
}
