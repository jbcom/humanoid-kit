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
 *
 * Axillary and pubic hair follow the same line: a recipe under 18 may not set
 * their density (`recipe.bodyHair.density`) to anything but 0, and the body
 * hair model draws none of them for a figure that is not an adult.
 */
import { ADULT_AGE } from "../makehuman/macro.ts";
import { ADULT_ONLY_BODY_HAIR, isAdultOnlyBodyHair } from "../surface/bodyHair.ts";
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
  for (const [group, v] of Object.entries(recipe.bodyHair?.density ?? {}))
    if (v !== 0 && isAdultOnlyBodyHair(group)) out.push(`body hair ${group} is adult-only`);
  return out;
}

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
 * adult-only modifiers explicitly (the caller sees the result); nothing is
 * removed when the target age is adult.
 */
export function withAge(recipe: Recipe, age: number): Recipe {
  const next: Recipe = structuredClone(recipe);
  next.macros.age = age;
  if (age >= ADULT_AGE) return next;
  for (const id of Object.keys(next.modifiers))
    if (ADULT_ONLY_MODIFIER(id)) delete next.modifiers[id];
  const density = next.bodyHair?.density;
  if (density) for (const group of ADULT_ONLY_BODY_HAIR) delete density[group];
  return next;
}
