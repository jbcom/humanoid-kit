/**
 * Age policy.
 *
 * humanoid-kit models people of every age MakeHuman covers (1 to 90 years).
 * The line is anatomy, not nudity: below `ADULT_AGE` a figure is MakeHuman's
 * smooth doll form with no anatomical detail, which may be shown with or
 * without clothing. Adult-specific controls exist only for adults: below `ADULT_AGE`, breast
 * size and firmness are fixed at MakeHuman's defaults, adult-only shape
 * modifiers (genital, bulge and pregnancy targets) are unavailable, and the
 * separate adult anatomy pack refuses to evaluate. A recipe that sets any of
 * these for a figure under 18 is invalid; it is rejected, never silently
 * clamped, so a mistake cannot be hidden.
 */
import { ADULT_AGE, DEFAULT_MACROS } from "../makehuman/macro.ts";
import type { Recipe } from "./recipe.ts";

export { ADULT_AGE };

/**
 * Shape modifiers that only apply to adults: the adult pack's genital, bulge
 * and pregnancy modifiers, and the body pack's breast and nipple shaping.
 * Must agree with the packer's `adultOnly` flag (a test checks every modifier).
 */
export const ADULT_ONLY_MODIFIER = (id: string): boolean =>
  id.startsWith("genitals/") ||
  id.startsWith("pelvis/bulge") ||
  id.startsWith("stomach/stomach-pregnant") ||
  id.startsWith("breast/");

export const isAdult = (recipe: Recipe): boolean => recipe.macros.age >= ADULT_AGE;

export class AgePolicyError extends Error {
  override name = "AgePolicyError";
}

/** Every reason the recipe violates the age policy; empty when it is valid. */
export function agePolicyViolations(recipe: Recipe): string[] {
  if (isAdult(recipe)) return [];
  const out: string[] = [];
  const m = recipe.macros;
  if (m.breastSize !== DEFAULT_MACROS.breastSize) out.push("breastSize is adult-only");
  if (m.breastFirmness !== DEFAULT_MACROS.breastFirmness) out.push("breastFirmness is adult-only");
  for (const [region, values] of Object.entries(recipe.regionalMacros)) {
    if (values && ("breastSize" in values || "breastFirmness" in values))
      out.push(`regional breast values (${region}) are adult-only`);
  }
  for (const [id, v] of Object.entries(recipe.modifiers)) {
    if (v !== 0 && ADULT_ONLY_MODIFIER(id)) out.push(`modifier ${id} is adult-only`);
  }
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
 * Returns a copy suitable for a new age. Moving an adult recipe below 18
 * removes the adult-only values explicitly (the caller sees the result);
 * nothing is removed when the target age is adult.
 */
export function withAge(recipe: Recipe, age: number): Recipe {
  const next: Recipe = structuredClone(recipe);
  next.macros.age = age;
  if (age >= ADULT_AGE) return next;
  next.macros.breastSize = DEFAULT_MACROS.breastSize;
  next.macros.breastFirmness = DEFAULT_MACROS.breastFirmness;
  for (const values of Object.values(next.regionalMacros)) {
    if (!values) continue;
    delete values.breastSize;
    delete values.breastFirmness;
  }
  for (const id of Object.keys(next.modifiers))
    if (ADULT_ONLY_MODIFIER(id)) delete next.modifiers[id];
  return next;
}
