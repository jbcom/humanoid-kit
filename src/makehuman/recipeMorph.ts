/**
 * Recipe → morph contributions for the hm08 base pack.
 *
 * Each body region evaluates MakeHuman's macro model with the recipe's macros
 * overlaid by that region's overrides; targets whose weight is the same in
 * every region become uniform contributions. Shape modifiers add their
 * `lo`/`hi` target by the modifier value. The age policy is enforced here, so
 * no caller can evaluate an invalid recipe by skipping validation.
 */
import type { ShapeModifierEntry } from "../format/assetFormat.ts";
import { type Contribution, mergeRegionalWeights } from "../morph/evaluate.ts";
import { assertAgePolicy, isAdult } from "../recipe/agePolicy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import { macroTargetWeights } from "./macro.ts";
import { BODY_REGIONS } from "./regions.ts";

export class RecipeError extends Error {
  override name = "RecipeError";
}

export function recipeContributions(
  recipe: Recipe,
  modifiers: ReadonlyMap<string, ShapeModifierEntry>,
): Contribution[] {
  assertAgePolicy(recipe);
  const perRegion = BODY_REGIONS.map((region) =>
    macroTargetWeights({ ...recipe.macros, ...recipe.regionalMacros[region] }),
  );
  const contributions = mergeRegionalWeights(perRegion);
  for (const [id, value] of Object.entries(recipe.modifiers)) {
    if (value === 0) continue;
    const m = modifiers.get(id);
    if (!m)
      throw new RecipeError(
        `unknown shape modifier ${id} (adult-only modifiers need the adult pack)`,
      );
    if (m.adultOnly && !isAdult(recipe))
      throw new RecipeError(`shape modifier ${id} is adult-only`);
    const v = Math.max(-1, Math.min(1, value));
    if (v < 0) {
      if (!m.lo) throw new RecipeError(`shape modifier ${id} is one-sided; got ${value}`);
      contributions.push({ target: m.lo, weight: -v });
    } else {
      contributions.push({ target: m.hi, weight: v });
    }
  }
  return contributions;
}
