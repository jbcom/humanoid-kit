/**
 * The editor's control model: how each slider in MakeHuman's taxonomy reads
 * and writes a recipe. Pure functions over plain data, so any UI (the shipped
 * React creator, or an application's own) behaves the same way.
 *
 * - Macros use MakeHuman's ranges: age in years (1 to 90), everything else 0 to 1.
 * - The three ethnic macros stay normalised to a sum of 1, as in MakeHuman:
 *   moving one shares the remainder between the other two in their current
 *   proportion.
 * - Changing age goes through `withAge`, so moving a figure under 18 removes
 *   adult anatomy values explicitly rather than leaving an invalid recipe.
 * - Adult anatomy sliders are unavailable under 18, with the reason given.
 */
import type { ShapeModifierEntry, SliderEntry } from "../format/assetFormat.ts";
import { ADULT_AGE, MAX_AGE, type MacroValues, MIN_AGE } from "../makehuman/macro.ts";
import { AgePolicyError, isAdult, withAge } from "../recipe/agePolicy.ts";
import { withAnatomyDefaults } from "../recipe/anatomy.ts";
import type { Recipe } from "../recipe/recipe.ts";

export interface SliderRange {
  min: number;
  max: number;
  step: number;
  /** The value that leaves the figure unchanged by this slider. */
  neutral: number;
}

export type ModifierTable = ReadonlyMap<string, ShapeModifierEntry>;

const ETHNIC = ["african", "asian", "caucasian"] as const;
type Ethnic = (typeof ETHNIC)[number];
const isEthnic = (k: string): k is Ethnic => (ETHNIC as readonly string[]).includes(k);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function modifierOf(entry: SliderEntry, modifiers: ModifierTable): ShapeModifierEntry {
  const m = modifiers.get(entry.id);
  if (!m) throw new Error(`slider ${entry.id} has no modifier in the loaded packs`);
  return m;
}

export function sliderRange(entry: SliderEntry, modifiers: ModifierTable): SliderRange {
  if (entry.kind === "macro") {
    if (entry.id === "age") return { min: MIN_AGE, max: MAX_AGE, step: 0.5, neutral: 25 };
    return {
      min: 0,
      max: 1,
      step: 0.005,
      neutral: isEthnic(entry.id) ? 1 / 3 : 0.5,
    };
  }
  const two = modifierOf(entry, modifiers).lo !== null;
  return { min: two ? -1 : 0, max: 1, step: 0.005, neutral: 0 };
}

/**
 * The value a creator row presents. Adult anatomy defaults are evaluated with
 * the same resolver as the model, so a missing recipe key is not mistaken for
 * zero when the loaded pack supplies a default.
 */
export function sliderValue(
  recipe: Recipe,
  entry: SliderEntry,
  anatomyDefaults?: Readonly<Record<string, string>>,
): number {
  if (entry.kind === "macro") return recipe.macros[entry.id as keyof MacroValues];
  return withAnatomyDefaults(recipe, anatomyDefaults).modifiers[entry.id] ?? 0;
}

/** A new recipe with the slider set; the input is not modified. */
export function withSliderValue(
  recipe: Recipe,
  entry: SliderEntry,
  value: number,
  modifiers: ModifierTable,
  anatomyDefaults?: Readonly<Record<string, string>>,
): Recipe {
  if (!Number.isFinite(value)) throw new RangeError(`${entry.id}: ${value} is not a number`);
  const range = sliderRange(entry, modifiers);
  const v = clamp(value, range.min, range.max);
  if (entry.kind === "modifier") {
    // Rejected, never clamped: a caller that skipped sliderAvailability learns it here.
    if (v !== 0 && modifierOf(entry, modifiers).adultOnly && !isAdult(recipe))
      throw new AgePolicyError(`${entry.id}: adult anatomy is not available under ${ADULT_AGE}`);
    const next = { ...recipe, modifiers: { ...recipe.modifiers } };
    // Neutral values are normally dropped so recipes stay small and diff cleanly.
    // Adult packs apply a default only when a modifier is absent, so a zero for
    // a defaulted adult modifier is an explicit override, not an omission.
    const retainsAdultZero =
      v === 0 &&
      isAdult(recipe) &&
      anatomyDefaults !== undefined &&
      Object.hasOwn(anatomyDefaults, entry.id);
    if (v === 0 && !retainsAdultZero) delete next.modifiers[entry.id];
    else next.modifiers[entry.id] = v;
    return next;
  }
  const key = entry.id as keyof MacroValues;
  if (key === "age") return withAge(recipe, v);
  const macros = { ...recipe.macros, [key]: v };
  if (isEthnic(key)) {
    const others = ETHNIC.filter((k) => k !== key);
    const rest = others.reduce((s, k) => s + recipe.macros[k], 0);
    for (const k of others)
      macros[k] = rest > 1e-9 ? ((1 - v) * recipe.macros[k]) / rest : (1 - v) / others.length;
  }
  return { ...recipe, macros };
}

/**
 * Returns a recipe as though its row's reset button was pressed. A defaulted
 * adult row clears its explicit value so the loaded pack can apply its default;
 * every other row resets to its ordinary neutral value.
 */
export function resetSliderValue(
  recipe: Recipe,
  entry: SliderEntry,
  modifiers: ModifierTable,
  anatomyDefaults?: Readonly<Record<string, string>>,
  range?: Pick<SliderRange, "min" | "max">,
): Recipe {
  if (
    entry.kind === "modifier" &&
    anatomyDefaults !== undefined &&
    Object.hasOwn(anatomyDefaults, entry.id)
  ) {
    if (!Object.hasOwn(recipe.modifiers, entry.id)) return recipe;
    const next = { ...recipe, modifiers: { ...recipe.modifiers } };
    delete next.modifiers[entry.id];
    if (!range) return next;
    const effective = sliderValue(next, entry, anatomyDefaults);
    const limited = clamp(effective, range.min, range.max);
    return limited === effective
      ? next
      : withSliderValue(recipe, entry, limited, modifiers, anatomyDefaults);
  }
  return withSliderValue(
    recipe,
    entry,
    sliderRange(entry, modifiers).neutral,
    modifiers,
    anatomyDefaults,
  );
}

export type Availability = { enabled: true } | { enabled: false; reason: string };

export function sliderAvailability(
  recipe: Recipe,
  entry: SliderEntry,
  modifiers: ModifierTable,
): Availability {
  if (entry.kind === "modifier" && modifierOf(entry, modifiers).adultOnly) {
    if (!isAdult(recipe))
      return { enabled: false, reason: `Adult anatomy is available from age ${ADULT_AGE}.` };
  }
  return { enabled: true };
}

/** The value as the editor shows it: years for age, percentages otherwise, signed when two-sided. */
export function formatSliderValue(entry: SliderEntry, value: number, range: SliderRange): string {
  // Never rounded up: 17.5 must not read as 18 while adult controls are still unavailable.
  if (entry.kind === "macro" && entry.id === "age")
    return `${Number.isInteger(value) ? value : value.toFixed(1)} yr`;
  const pct = Math.round(value * 100);
  return range.min < 0 && pct > 0 ? `+${pct}%` : `${pct}%`;
}
