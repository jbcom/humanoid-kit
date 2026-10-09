/**
 * Which adult anatomy a recipe applies (docs/ARCHITECTURE.md, "Adult-pack
 * layers"), for the skin layers that colour it.
 *
 * Skin paint must know which anatomy a figure has, not only that it is an
 * adult: a layer that tints genital skin must not tint a figure whose recipe
 * shapes none. Each feature is independent (its own modifiers, its own
 * presence), so the vulva, clitoris and intersex variation the sculpt phase
 * adds are further features rather than a single male-to-female axis
 * (docs/research/ADULT-SCULPT-PLAN.md).
 *
 * The features, and the modifiers that apply each, are data of the adult
 * anatomy pack (`AdultAnatomyManifest.anatomy`): the core names no adult
 * modifier or target, so the public build, which has no adult pack, contains
 * none (`pnpm check:pages`). A feature is present (1) once any of its
 * modifiers is set, in either direction, since "smaller" is still there; the
 * sculpt's features take a continuous presence from their own weights.
 */
import { isAdult } from "./agePolicy.ts";
import type { Recipe } from "./recipe.ts";

export interface AnatomyFeature {
  /** Key of the feature in `SkinPaintInput.anatomy`, and of the layers that colour it. */
  id: string;
  /** The shape modifiers that apply the feature. All are adult-only. */
  modifiers: readonly string[];
}

/**
 * The features a recipe applies, each with its presence (0..1); absent
 * features are left out. `features` is the adult pack's list
 * (`ReadyInfo.anatomy`), empty without the pack. Always empty under 18,
 * however the recipe was built: the paint input does not depend on the age
 * policy having run first.
 */
export function appliedAnatomy(
  recipe: Recipe,
  features: readonly AnatomyFeature[],
): Readonly<Record<string, number>> {
  if (!isAdult(recipe)) return {};
  const out: Record<string, number> = {};
  for (const f of features)
    if (f.modifiers.some((id) => (recipe.modifiers[id] ?? 0) !== 0)) out[f.id] = 1;
  return out;
}
