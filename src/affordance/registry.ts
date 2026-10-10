/**
 * The body's affordances (docs/FOUNDATION.md, "Affordances"; docs/ARCHITECTURE.md,
 * "Affordances: the registry"): every place another object or figure can
 * enter, grip, hang from or rest against, named and anchored on the
 * foundation's landmarks so its frame follows the posed, morphed body.
 *
 * The core declares the body's own here. A pack declares its own in its
 * manifest and they join a figure's registry when it loads; the core names
 * none of the adult anatomy's, and a figure under 18 is given none of them.
 */
import type { LandmarkId } from "../foundation/landmarks.ts";
import { isAdult } from "../recipe/agePolicy.ts";
import type { Recipe } from "../recipe/recipe.ts";

/**
 * What an affordance does: an aperture opens into a channel (the mouth); a grip
 * closes on what it holds (a hand); a mount carries what is worn or hung on it
 * (an ear lobe, a wrist); a contact surface rests on or against something (a
 * sole).
 */
export type AffordanceKind = "aperture" | "grip" | "mount" | "contact";

/** Where an affordance's frame comes from: a landmark, or the midpoint of two (the mouth, between the lips). */
export type AffordanceAnchor =
  | { readonly landmark: LandmarkId }
  | { readonly between: readonly [LandmarkId, LandmarkId] };

export interface Affordance {
  readonly id: string;
  readonly kind: AffordanceKind;
  readonly at: AffordanceAnchor;
  /** The adult anatomy's: declared by the adult pack, and never given to a figure under 18. */
  readonly adult: boolean;
}

const core = (id: string, kind: AffordanceKind, at: AffordanceAnchor): Affordance => ({
  id,
  kind,
  at,
  adult: false,
});

/**
 * The core's affordances. Those whose places are not yet landmarks (the
 * nostrils, the ear canals, the finger pads) join as their landmarks are
 * built.
 */
export const CORE_AFFORDANCES: readonly Affordance[] = [
  core("mouth", "aperture", { between: ["upper-lip", "lower-lip"] }),
  core("hand.L", "grip", { landmark: "palm.L" }),
  core("hand.R", "grip", { landmark: "palm.R" }),
  core("ear-lobe.L", "mount", { landmark: "ear-lobe.L" }),
  core("ear-lobe.R", "mount", { landmark: "ear-lobe.R" }),
  core("nipple.L", "mount", { landmark: "nipple.L" }),
  core("nipple.R", "mount", { landmark: "nipple.R" }),
  core("navel", "mount", { landmark: "navel" }),
  core("neck", "mount", { landmark: "neck" }),
  core("wrist.L", "mount", { landmark: "wrist.L" }),
  core("wrist.R", "mount", { landmark: "wrist.R" }),
  core("sole.L", "contact", { landmark: "sole.L" }),
  core("sole.R", "contact", { landmark: "sole.R" }),
];

/**
 * The affordances a figure has from a registry (the core's, and a pack's
 * once packs declare theirs): every one for a figure 18 or over, none of the
 * adult anatomy's for one under 18.
 */
export function affordances(
  recipe: Recipe,
  registry: readonly Affordance[] = CORE_AFFORDANCES,
): readonly Affordance[] {
  return isAdult(recipe) ? registry : registry.filter((a) => !a.adult);
}
