/**
 * The cover policy: what a host that must confirm before showing an uncovered
 * figure tells the creator. The library judges nothing here, it enforces the
 * host's answer: no uncovered figure is evaluated until the policy allows it.
 * Plain functions over recipes and the wardrobe; `useEditorState` applies them
 * in front of what `<Humanoid>` is handed.
 *
 * "Covered" is a function of the recipe and the wardrobe, not a flag in the
 * recipe: the recipe format has no notion of cover, and adding one would put the
 * host's rule into every saved file.
 */
import type { Recipe } from "../recipe/recipe.ts";
import type { PolicyCause } from "./gate.ts";
import type { WardrobeEntry } from "./wardrobe.ts";

/** What `allowUncover` is told. */
export interface UncoverRequest {
  /** Why the figure is being asked about: a change the creator proposed, or a figure it was given. */
  cause: PolicyCause;
  /** The figure being left; null when none is shown yet (the starting figure). */
  current: Recipe | null;
  /** The uncovered figure. */
  proposed: Recipe;
  /**
   * Aborts when the answer no longer matters: the host set another `value`, or the
   * creator unmounted. A host that shows a dialog closes it then.
   */
  signal: AbortSignal;
}

export interface CoverPolicy {
  /** Whether a figure is covered. Pure and synchronous. Default: `wearsCover`. */
  covered?: (recipe: Recipe, wardrobe: readonly WardrobeEntry[]) => boolean;
  /**
   * Asked before a figure that would be uncovered is shown: `true` allows it, anything
   * else (false, a rejection, a throw) refuses it. May be async. Without it no
   * uncovered figure is ever allowed.
   */
  allowUncover?: (request: UncoverRequest) => boolean | Promise<boolean>;
}

/**
 * The garment kinds (the clothing pack's categories, `GARMENT_LAYERS`) that are
 * cover. The pack ships `clothes`, `shoes` and `hat`: shoes and a hat do not cover.
 */
export const COVERING_KINDS: readonly string[] = ["underwear", "clothes"];

/**
 * The default notion of cover: the figure wears at least one garment of a covering
 * kind. A garment the wardrobe does not list has no kind and covers nothing, and
 * without a wardrobe nothing is worn.
 */
export function wearsCover(recipe: Recipe, wardrobe: readonly WardrobeEntry[]): boolean {
  const worn = recipe.outfit;
  if (!worn?.length) return false;
  const kinds = new Map(wardrobe.map((g) => [g.id, g.kind] as const));
  return worn.some((id) => COVERING_KINDS.includes(kinds.get(id) ?? ""));
}

/** Whether the policy counts the recipe as covered. */
export function isCovered(
  policy: CoverPolicy,
  recipe: Recipe,
  wardrobe: readonly WardrobeEntry[],
): boolean {
  return (policy.covered ?? wearsCover)(recipe, wardrobe);
}

/**
 * Whether showing `proposed` needs the host's confirmation: it is uncovered, and the
 * figure shown (`null` for none yet) is covered or absent. A figure that stays
 * uncovered is not asked about again, so a person who confirmed is not asked at every
 * slider, and one who puts a garment on and takes it off is asked once more.
 */
export function mustConfirm(
  policy: CoverPolicy,
  wardrobe: readonly WardrobeEntry[],
  proposed: Recipe,
  shown: Recipe | null,
): boolean {
  if (isCovered(policy, proposed, wardrobe)) return false;
  return shown === null || isCovered(policy, shown, wardrobe);
}
