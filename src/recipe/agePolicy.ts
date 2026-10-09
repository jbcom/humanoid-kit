/**
 * Age policy.
 *
 * humanoid-kit is a system for using MakeHuman, so the body follows MakeHuman
 * exactly at every age it models (1 to 90 years): its shape targets, breast
 * development through adolescence, nipples and areolae. humanoid-kit adds no
 * judgement of its own to that.
 *
 * The one boundary is the adult anatomy pack, which mirrors how MakeHuman
 * itself keeps genital assets out of its core: genital, bulge and pregnancy
 * targets live in a separate install, and are only evaluated for figures aged
 * 18 or over. A recipe that sets any of them for a younger figure is invalid;
 * it is rejected, never silently clamped, so a mistake cannot be hidden.
 */
import { ADULT_AGE } from "../makehuman/macro.ts";
import { isBodyPiercingSite } from "./bodyArt.ts";
import type { Recipe } from "./recipe.ts";

export { ADULT_AGE };

/**
 * Shape modifiers that only apply to adults: the adult anatomy pack's genital,
 * bulge and pregnancy modifiers. Must agree with the packer's `adultOnly` flag
 * (a test checks every modifier).
 */
export const ADULT_ONLY_MODIFIER = (id: string): boolean =>
  id.startsWith("genitals/") ||
  id.startsWith("pelvis/bulge") ||
  id.startsWith("stomach/stomach-pregnant");

export const isAdult = (recipe: Recipe): boolean => recipe.macros.age >= ADULT_AGE;

export class AgePolicyError extends Error {
  override name = "AgePolicyError";
}

/** Every reason the recipe violates the age policy; empty when it is valid. */
export function agePolicyViolations(recipe: Recipe): string[] {
  if (isAdult(recipe)) return [];
  const out: string[] = [];
  for (const [id, v] of Object.entries(recipe.modifiers)) {
    if (v !== 0 && ADULT_ONLY_MODIFIER(id)) out.push(`modifier ${id} is adult-only`);
  }
  for (const p of recipe.bodyArt?.piercings ?? [])
    if (ADULT_ONLY_PIERCING(p.site)) out.push(`piercing site ${p.site} is adult-only`);
  return out;
}

/**
 * Piercing sites that only apply to adults: every site that is not one of the
 * body's own (`PIERCING_SITES`). Those are the adult anatomy pack's, which the
 * core never names, so an unknown site fails closed: it is refused under 18
 * whether or not the pack is loaded.
 */
export const ADULT_ONLY_PIERCING = (site: string): boolean => !isBodyPiercingSite(site);

export function assertAgePolicy(recipe: Recipe): void {
  const v = agePolicyViolations(recipe);
  if (v.length)
    throw new AgePolicyError(
      `recipe for age ${recipe.macros.age} violates the age policy: ${v.join("; ")}`,
    );
}

/**
 * Skin-state signals that only apply to adults: sexual arousal, in any
 * channel (colour, relief or shape). Cold, heat, exertion, blush and fear are
 * physiological at every age, as the body's own responses are.
 */
export const ADULT_ONLY_SIGNALS: readonly string[] = ["arousal"];

/** Refuses an adult-only signal for a figure under 18 (never clamps it). */
export function assertSignalPolicy(
  recipe: Recipe,
  signals: Readonly<Record<string, number>>,
): void {
  if (isAdult(recipe)) return;
  const bad = ADULT_ONLY_SIGNALS.filter((s) => (signals[s] ?? 0) !== 0);
  if (bad.length)
    throw new AgePolicyError(
      `signals for age ${recipe.macros.age} violate the age policy: ${bad.join(", ")} adult-only`,
    );
}

/**
 * Returns a copy at a new age. Moving an adult recipe below 18 removes the
 * adult-only modifiers and piercings explicitly (the caller sees the result); nothing is
 * removed when the target age is adult.
 */
export function withAge(recipe: Recipe, age: number): Recipe {
  const next: Recipe = structuredClone(recipe);
  next.macros.age = age;
  if (age >= ADULT_AGE) return next;
  for (const id of Object.keys(next.modifiers))
    if (ADULT_ONLY_MODIFIER(id)) delete next.modifiers[id];
  if (next.bodyArt)
    next.bodyArt.piercings = next.bodyArt.piercings.filter((p) => !ADULT_ONLY_PIERCING(p.site));
  return next;
}
