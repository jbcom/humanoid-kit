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
import type { BreastRegionalTraitValues, Recipe } from "../recipe/recipe.ts";
import { assertValidRecipe } from "../recipe/validate.ts";
import { macroTargetWeights } from "./macro.ts";
import { BODY_REGIONS } from "./regions.ts";

export class RecipeError extends Error {
  override name = "RecipeError";
}

export function recipeContributions(
  recipe: Recipe,
  modifiers: ReadonlyMap<string, ShapeModifierEntry>,
): Contribution[] {
  assertValidRecipe(recipe);
  assertAgePolicy(recipe);
  // Age is a whole-figure property: a regional override can never change it,
  // even if a recipe loaded from JSON carries one (the type forbids it).
  const bothBreastFoundations = (["breastL", "breastR"] as const).every(
    (region) => recipe.regionalMacros[region]?.breastPresence !== undefined,
  );
  const perRegion = BODY_REGIONS.map((region) => {
    // `breastPresence` is applied by the source-derived foundation after the
    // ordinary MakeHuman frame. It must never be turned into a masked whole-body
    // gender contribution here: that was the discontinuous experimental transfer.
    const { breastPresence, ...regionalMacros } = (recipe.regionalMacros[region] ??
      {}) as BreastRegionalTraitValues;
    // The foundation starts from MakeHuman's average cup/firmness source cell;
    // its own source grid then applies the requested coordinate. This confines
    // the baseline substitution to the existing breast-target family, never a
    // whole-body gender target.
    return macroTargetWeights({
      ...recipe.macros,
      ...regionalMacros,
      ...(bothBreastFoundations ? { breastSize: 0.5, breastFirmness: 0.5 } : {}),
      age: recipe.macros.age,
    });
  });
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
    // An end named "" is a virtual one: the value is legal and carries no target of its own,
    // for a pack's `AdultDetailSpec` factors to read (a size that blends baked shapes).
    if (v < 0) {
      if (m.lo === null) throw new RecipeError(`shape modifier ${id} is one-sided; got ${value}`);
      if (m.lo !== "") contributions.push({ target: m.lo, weight: -v });
    } else if (m.hi !== "") {
      contributions.push({ target: m.hi, weight: v });
    }
  }
  return contributions;
}
