/**
 * What a host that embeds the creator may take away from it, as data: a range
 * for any slider, and sliders, groups, tasks and panels left out. Pure functions over
 * recipes and the slider taxonomy, so the creator, an application's own editor
 * and a test all apply the same limits.
 *
 * Hiding is not locking: a hidden slider keeps its value. To hold a value, give
 * it a range of one.
 */
import type { SliderGroup, SliderTask } from "../format/assetFormat.ts";
import { DEFAULT_MACROS, MAX_AGE, MIN_AGE } from "../makehuman/macro.ts";
import { isAdult, withAge } from "../recipe/agePolicy.ts";
import { withAnatomyDefaults } from "../recipe/anatomy.ts";
import type { Recipe, RegionalMacroValues } from "../recipe/recipe.ts";
import type { ModifierTable, SliderRange } from "./controls.ts";
import type { RegionalMacro } from "./regional.ts";

/** The creator's panels that are not a MakeHuman task. */
export type CreatorPanel = "regions" | "appearance" | "wardrobe";
export const CREATOR_PANELS: readonly CreatorPanel[] = ["regions", "appearance", "wardrobe"];

/** A slider's allowed values; a side left out is the slider's own. */
export interface SliderLimit {
  min?: number;
  max?: number;
}

export interface ControlLimits {
  /**
   * Slider id to its allowed values. A slider id is a macro (`age`, `gender`,
   * `muscle`, `weight`, `height`, `proportions`, `breastSize`, `breastFirmness`) or
   * a shape modifier id. Not the three ethnic macros: they sum to one, so
   * clamping one moves the others.
   */
  ranges?: Readonly<Record<string, SliderLimit>>;
  /** Slider ids left out of the tabs and the search. */
  hide?: readonly string[];
  /** Tasks (by id or label: `Main`, `Face`, ...) left out, tab and sliders. */
  hideTasks?: readonly string[];
  /**
   * Groups of a task's sliders left out, as `"<task>/<group>"`, each by id or label
   * (`"Face/Nose features"`). The task is named because group names repeat across
   * tasks. The key is split at its first `/`, so a group with a slash in its own name
   * (`"Face/Chin/jaw"`) is written as it is. A task left with no group is left out.
   */
  hideGroups?: readonly string[];
  /** Panels left out. */
  hidePanels?: readonly CreatorPanel[];
}

const MACROS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_MACROS));
const ETHNIC: ReadonlySet<string> = new Set(["african", "asian", "caucasian"]);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Throws a `RangeError` for a limit that cannot be honoured: not a number, empty, or on an ethnic macro. */
export function assertControls(controls: ControlLimits): void {
  for (const [id, limit] of Object.entries(controls.ranges ?? {})) {
    if (ETHNIC.has(id))
      throw new RangeError(
        `controls.ranges.${id}: the ethnic macros are normalised together, so they cannot be ranged one by one`,
      );
    for (const side of ["min", "max"] as const) {
      const v = limit[side];
      if (v !== undefined && !Number.isFinite(v))
        throw new RangeError(`controls.ranges.${id}.${side}: ${v} is not a number`);
    }
    if (limit.min !== undefined && limit.max !== undefined && limit.min > limit.max)
      throw new RangeError(`controls.ranges.${id}: min ${limit.min} is above max ${limit.max}`);
  }
}

/** `base` narrowed by the limit on `id`; throws when they do not meet. */
function narrowed(
  id: string,
  base: { min: number; max: number },
  controls: ControlLimits | undefined,
): { min: number; max: number } {
  const limit = controls?.ranges?.[id];
  if (!limit) return base;
  const min = Math.max(base.min, limit.min ?? Number.NEGATIVE_INFINITY);
  const max = Math.min(base.max, limit.max ?? Number.POSITIVE_INFINITY);
  if (min > max)
    throw new RangeError(
      `controls.ranges.${id}: ${limit.min ?? "…"} to ${limit.max ?? "…"} does not meet the slider's own range ${base.min} to ${base.max}`,
    );
  return { min, max };
}

/** A slider's range narrowed by the host's limit; its step stays, and neutral is kept inside. */
export function limitedRange(
  entry: { id: string },
  base: SliderRange,
  controls: ControlLimits | undefined,
): SliderRange {
  if (!controls?.ranges?.[entry.id]) return base;
  const { min, max } = narrowed(entry.id, base, controls);
  return { ...base, min, max, neutral: clamp(base.neutral, min, max) };
}

/** The range a regional override of a macro may take: the macro's own, narrowed. */
export function macroRange(
  key: RegionalMacro,
  controls: ControlLimits | undefined,
): { min: number; max: number } {
  return narrowed(key, { min: 0, max: 1 }, controls);
}

/**
 * `recipe` with every limited slider inside its range: macros (age through
 * `withAge`, so moving it under 18 still removes the adult-only values), a
 * regional override of a limited macro, and modifiers. A modifier the recipe does
 * not set is 0 unless the loaded anatomy defaults resolve it; either value is
 * set to the nearest allowed value when it falls outside the range. The input is
 * not modified; the very same recipe comes back when nothing moved.
 */
export function limitRecipe(
  recipe: Recipe,
  controls: ControlLimits | undefined,
  modifiers: ModifierTable,
  anatomyDefaults?: Readonly<Record<string, string>>,
): Recipe {
  const ranges = controls?.ranges;
  if (!ranges) return recipe;
  let out = recipe;
  for (const id of Object.keys(ranges)) {
    if (!MACROS.has(id)) continue;
    const { min, max } = narrowed(
      id,
      id === "age" ? { min: MIN_AGE, max: MAX_AGE } : { min: 0, max: 1 },
      controls,
    );
    const key = id as keyof Recipe["macros"];
    const value = clamp(out.macros[key], min, max);
    if (value !== out.macros[key])
      out =
        id === "age" ? withAge(out, value) : { ...out, macros: { ...out.macros, [key]: value } };
    if (id === "age") continue;
    for (const [region, own] of Object.entries(out.regionalMacros)) {
      const regional = own?.[key as keyof RegionalMacroValues];
      if (regional === undefined || clamp(regional, min, max) === regional) continue;
      out = {
        ...out,
        regionalMacros: {
          ...out.regionalMacros,
          [region]: { ...own, [key]: clamp(regional, min, max) },
        },
      };
    }
  }
  for (const id of Object.keys(ranges)) {
    if (MACROS.has(id)) continue;
    const entry = modifiers.get(id);
    const base = { min: entry ? (entry.lo !== null ? -1 : 0) : -1, max: 1 };
    const { min, max } = narrowed(id, base, controls);
    const before = withAnatomyDefaults(out, anatomyDefaults).modifiers[id] ?? 0;
    const value = clamp(before, min, max);
    if (value === before) continue;
    const next = { ...out.modifiers };
    // Neutral values are dropped so recipes stay small, except an adult pack's
    // defaulted modifier: omitting that zero would restore the out-of-range default.
    const retainsAdultZero =
      value === 0 &&
      isAdult(out) &&
      anatomyDefaults !== undefined &&
      Object.hasOwn(anatomyDefaults, id);
    if (value === 0 && !retainsAdultZero) delete next[id];
    else next[id] = value;
    out = { ...out, modifiers: next };
  }
  return out;
}

/**
 * The taxonomy less the sliders and tasks the host hides, and the groups and
 * tasks that leaves empty. What it does not change is the same object; with
 * nothing hidden it is `tasks` itself.
 */
export function visibleTasks(
  tasks: SliderTask[],
  controls: ControlLimits | undefined,
): SliderTask[] {
  const hide = new Set(controls?.hide);
  const hideTasks = new Set(controls?.hideTasks);
  const hideGroups = new Set(controls?.hideGroups);
  if (hide.size === 0 && hideTasks.size === 0 && hideGroups.size === 0) return tasks;
  const out: SliderTask[] = [];
  for (const task of tasks) {
    if (hideTasks.has(task.id) || hideTasks.has(task.label)) continue;
    const groupHidden = (g: SliderGroup) =>
      [task.id, task.label].some((t) =>
        [g.id, g.label].some((name) => hideGroups.has(`${t}/${name}`)),
      );
    const groups = task.groups
      .filter((g) => !groupHidden(g))
      .map((g) => {
        const sliders = g.sliders.filter((s) => !hide.has(s.id));
        return sliders.length === g.sliders.length ? g : { ...g, sliders };
      })
      .filter((g) => g.sliders.length > 0);
    if (groups.length === 0) continue;
    const unchanged =
      groups.length === task.groups.length && groups.every((g, i) => g === task.groups[i]);
    out.push(unchanged ? task : { ...task, groups });
  }
  return out;
}

/** The panels the host leaves in. */
export function visiblePanels(controls: ControlLimits | undefined): ReadonlySet<CreatorPanel> {
  const hidden = new Set(controls?.hidePanels);
  return new Set(CREATOR_PANELS.filter((p) => !hidden.has(p)));
}
