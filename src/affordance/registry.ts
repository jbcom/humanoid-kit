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
import type { ChannelId } from "./channel.ts";

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
  /** An aperture's channel behind its rim (`channel.ts`). */
  readonly channel?: ChannelId;
}

const core = (
  id: string,
  kind: AffordanceKind,
  at: AffordanceAnchor,
  channel?: ChannelId,
): Affordance => ({ id, kind, at, adult: false, ...(channel && { channel }) });

/** The finger pads, thumb (1) to little finger (5), each side: what a fingertip touches and presses with. */
const FINGER_PADS: readonly Affordance[] = (["L", "R"] as const).flatMap((side) =>
  ([1, 2, 3, 4, 5] as const).map((digit) => {
    const id = `finger-pad-${digit}.${side}` as const;
    return core(id, "contact", { landmark: id });
  }),
);

/** The core's affordances. */
export const CORE_AFFORDANCES: readonly Affordance[] = [
  core("mouth", "aperture", { between: ["upper-lip", "lower-lip"] }, "oral"),
  core("nostril.L", "aperture", { landmark: "nostril.L" }, "nasal"),
  core("nostril.R", "aperture", { landmark: "nostril.R" }, "nasal"),
  core("ear-canal.L", "aperture", { landmark: "ear-canal.L" }, "auditory"),
  core("ear-canal.R", "aperture", { landmark: "ear-canal.R" }, "auditory"),
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
  ...FINGER_PADS,
];

declare const forFigure: unique symbol;

/**
 * The affordances one figure has (`affordances`): the only list a figure's state
 * (`AffordanceStates`) and frames (`affordanceFrames`) are made from, so none of
 * the adult anatomy's can reach a figure under 18 by any route.
 */
export type FigureAffordances = readonly Affordance[] & { readonly [forFigure]: true };

/** The affordances of a figure not yet known: none. */
export const NO_AFFORDANCES = Object.freeze([]) as unknown as FigureAffordances;

/**
 * The affordances a figure has from a registry (the core's, and a pack's once
 * packs declare theirs): every one for a figure 18 or over; under 18, only those
 * that say they are not the adult anatomy's (one that says nothing is refused,
 * as an unknown piercing site is).
 */
export function affordances(
  recipe: Recipe,
  registry: readonly Affordance[] = CORE_AFFORDANCES,
): FigureAffordances {
  const own = isAdult(recipe) ? [...registry] : registry.filter((a) => a.adult === false);
  return Object.freeze(own) as unknown as FigureAffordances;
}
