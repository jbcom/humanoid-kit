/**
 * A recipe is everything that defines a figure's shape: MakeHuman's macro
 * variables, optional per-region overrides of those macros, and fine shape
 * modifiers by id. It is plain JSON, versioned, and the only thing an
 * application needs to save to rebuild a figure.
 *
 * Regional macro overrides generalise MakeHuman's model: any macro except age
 * can take a different value in one body region (for example a different
 * gender anchor for the face than for the hips, or a different breast size on
 * each side). Regions blend smoothly across joints.
 */
import { DEFAULT_MACROS, type MacroValues } from "../makehuman/macro.ts";
import type { BodyRegion } from "../makehuman/regions.ts";

export const RECIPE_VERSION = 1 as const;

/** Macros a region may override. Age is a property of the whole figure. */
export type RegionalMacroValues = Omit<MacroValues, "age">;

export interface Recipe {
  version: typeof RECIPE_VERSION;
  macros: MacroValues;
  regionalMacros: Partial<Record<BodyRegion, Partial<RegionalMacroValues>>>;
  /** Shape modifier id → value in [-1, 1] (one-sided modifiers [0, 1]). Missing ids are 0. */
  modifiers: Record<string, number>;
}

export function createRecipe(
  init: {
    macros?: Partial<MacroValues>;
    regionalMacros?: Recipe["regionalMacros"];
    modifiers?: Record<string, number>;
  } = {},
): Recipe {
  return {
    version: RECIPE_VERSION,
    macros: { ...DEFAULT_MACROS, ...init.macros },
    regionalMacros: structuredClone(init.regionalMacros ?? {}),
    modifiers: { ...init.modifiers },
  };
}
