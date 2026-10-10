/**
 * A foundation permutation as a recipe: its body's macros, its tone's
 * melanin and, for an adult at an anatomy extreme, the adult pack's anatomy
 * modifiers at their ends. The modifiers are read from the pack's own
 * `anatomy.features`, so the core names none of them.
 */
import type { AdultAnatomyManifest, ShapeModifierEntry } from "../format/assetFormat.ts";
import { createRecipe, type Recipe } from "../recipe/recipe.ts";
import type { AnatomySize, FoundationPermutation } from "./permutations.ts";

/**
 * Every adult anatomy modifier the pack's features name, at `size`: none for
 * the pack's default; for `min` and `max` each at the low or high end of its
 * range (-1..1 for a modifier with a low side, 0..1 for one without).
 */
export function anatomyModifiers(
  adult: Pick<AdultAnatomyManifest, "anatomy" | "modifiers">,
  size: AnatomySize,
): Record<string, number> {
  if (size === "default") return {};
  const entries = new Map<string, ShapeModifierEntry>(adult.modifiers.map((m) => [m.id, m]));
  const out: Record<string, number> = {};
  for (const feature of adult.anatomy?.features ?? [])
    for (const id of feature.modifiers) {
      const m = entries.get(id);
      if (!m) throw new RangeError(`anatomy feature ${feature.id}: no modifier ${id}`);
      out[id] = size === "max" ? 1 : m.lo === null ? 0 : -1;
    }
  return out;
}

/**
 * The recipe of a permutation. An anatomy extreme needs the adult pack's
 * manifest; a permutation of a body under 18 has none to apply.
 */
export function foundationRecipe(
  p: FoundationPermutation,
  adult?: Pick<AdultAnatomyManifest, "anatomy" | "modifiers">,
): Recipe {
  let modifiers: Record<string, number> = {};
  if (p.anatomy !== null && p.anatomy !== "default") {
    if (!adult) throw new RangeError(`${p.id}: an anatomy extreme needs the adult pack`);
    modifiers = anatomyModifiers(adult, p.anatomy);
  }
  return createRecipe({
    macros: { ...p.body.macros },
    skin: { melanin: p.tone.melanin },
    modifiers,
  });
}
