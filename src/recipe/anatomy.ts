/**
 * Which adult anatomy a recipe applies (docs/ARCHITECTURE.md, "Adult-pack
 * layers"), for the skin layers that colour it.
 *
 * Skin paint must know which anatomy a figure has, not only that it is an
 * adult: a layer that tints genital skin must not tint a figure whose recipe
 * shapes none. Each feature is independent (its own modifiers, its own
 * presence), so the vulva, clitoris and intersex variation the sculpt phase
 * adds are further features here rather than a single male-to-female axis
 * (docs/research/ADULT-SCULPT-PLAN.md).
 *
 * Today's features are the CC0 targets' own: the genital modifiers of the adult
 * anatomy pack. A feature is present (1) once any of its modifiers is set, in
 * either direction, since "smaller" is still there; the sculpt's features take
 * a continuous presence from their own weights.
 */
import { isAdult } from "./agePolicy.ts";
import type { Recipe } from "./recipe.ts";

export interface AnatomyFeature {
  /** Key of the feature in `SkinPaintInput.anatomy`, and of the layers that colour it. */
  id: string;
  /** The shape modifiers that apply the feature. All are adult-only. */
  modifiers: readonly string[];
}

export const ANATOMY_FEATURES: readonly AnatomyFeature[] = [
  { id: "penis", modifiers: ["genitals/penis-length-decr|incr", "genitals/penis-circ-decr|incr"] },
  { id: "testes", modifiers: ["genitals/penis-testicles-decr|incr"] },
  { id: "mound", modifiers: ["pelvis/bulge-decr|incr"] },
];

/**
 * The features a recipe applies, each with its presence (0..1); absent
 * features are left out. Always empty under 18, however the recipe was
 * built: the paint input does not depend on the age policy having run first.
 */
export function appliedAnatomy(recipe: Recipe): Readonly<Record<string, number>> {
  if (!isAdult(recipe)) return {};
  const out: Record<string, number> = {};
  for (const f of ANATOMY_FEATURES)
    if (f.modifiers.some((id) => (recipe.modifiers[id] ?? 0) !== 0)) out[f.id] = 1;
  return out;
}
