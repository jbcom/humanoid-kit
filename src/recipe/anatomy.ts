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
import { curveAt, parseCurve } from "../format/assetFormat.ts";
import { isAdult } from "./agePolicy.ts";
import type { Recipe } from "./recipe.ts";

/**
 * The recipe an adult figure is drawn from when the adult pack is loaded: each
 * adult-only modifier the recipe leaves unset takes the pack's default for the
 * figure's gender (`AdultAnatomySpec.defaults`), so an adult with the pack is
 * anatomically complete without the developer knowing the anatomy's controls.
 * A value the recipe sets, 0 included, always wins. A minor's recipe, or one
 * evaluated without defaults, comes back unchanged (the same object).
 */
export function withAnatomyDefaults(
  recipe: Recipe,
  defaults: Readonly<Record<string, string>> | undefined,
): Recipe {
  if (!defaults || !isAdult(recipe)) return recipe;
  let filled: Record<string, number> | null = null;
  for (const [id, curve] of Object.entries(defaults)) {
    if (id in recipe.modifiers) continue;
    const v = curveAt(parseCurve(curve), recipe.macros.gender);
    if (v === 0) continue;
    filled ??= { ...recipe.modifiers };
    filled[id] = v;
  }
  return filled ? { ...recipe, modifiers: filled } : recipe;
}

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
