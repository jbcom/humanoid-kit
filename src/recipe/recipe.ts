/**
 * A recipe is everything that defines a figure's appearance: MakeHuman's macro
 * variables, optional per-region overrides of those macros, fine shape
 * modifiers by id, and skin. It is plain JSON, versioned, and the only thing an
 * application needs to save to rebuild a figure.
 *
 * Regional macro overrides generalise MakeHuman's model: any macro except age
 * can take a different value in one body region (for example a different
 * gender anchor for the face than for the hips, or a different breast size on
 * each side). Regions blend smoothly across joints.
 */
import { DEFAULT_MACROS, type MacroValues } from "../makehuman/macro.ts";
import type { BodyRegion } from "../makehuman/regions.ts";
import type { Rgb } from "../surface/skinTone.ts";

export const RECIPE_VERSION = 1 as const;

/** Macros a region may override. Age is a property of the whole figure. */
export type RegionalMacroValues = Omit<MacroValues, "age">;

export interface SkinRecipe {
  /** 0 = very fair, 1 = very deep. */
  melanin: number;
  /** 0 = pale, 0.5 = typical, 1 = ruddy. */
  haemoglobin: number;
  /** -1 = cool/pink, 0 = neutral, 1 = warm/golden. */
  undertone: number;
  /** Linear-RGB albedo replacing the natural model (non-natural skin), or null. */
  override: Rgb | null;
  /** 0..1: flush on cheeks, nose and ears. */
  flush: number;
  /** 0..1: lip colour depth. */
  lips: number;
  /** 0..1: areola and nipple colour depth. */
  areola: number;
}

export const DEFAULT_SKIN: Readonly<SkinRecipe> = {
  melanin: 0.35,
  haemoglobin: 0.5,
  undertone: 0,
  override: null,
  flush: 0.45,
  lips: 0.55,
  areola: 0.5,
};

export interface EyesRecipe {
  /** Linear-RGB iris colour. */
  iris: Rgb;
  /** 0 = clinical white, 1 = warm ivory sclera. */
  scleraWarmth: number;
}

export const DEFAULT_EYES: Readonly<EyesRecipe> = {
  iris: [0.12, 0.055, 0.025],
  scleraWarmth: 0.5,
};

export interface Recipe {
  version: typeof RECIPE_VERSION;
  macros: MacroValues;
  regionalMacros: Partial<Record<BodyRegion, Partial<RegionalMacroValues>>>;
  /** Shape modifier id → value in [-1, 1] (one-sided modifiers [0, 1]). Missing ids are 0. */
  modifiers: Record<string, number>;
  skin: SkinRecipe;
  eyes: EyesRecipe;
  /**
   * Ids of the garments the figure wears (`humanoid-kit-clothing`), in any
   * order: how they stack comes from each garment's category. Absent means
   * nothing worn.
   */
  outfit?: readonly string[];
}

export function createRecipe(
  init: {
    macros?: Partial<MacroValues>;
    regionalMacros?: Recipe["regionalMacros"];
    modifiers?: Record<string, number>;
    skin?: Partial<SkinRecipe>;
    eyes?: Partial<EyesRecipe>;
    outfit?: readonly string[];
  } = {},
): Recipe {
  return {
    version: RECIPE_VERSION,
    macros: { ...DEFAULT_MACROS, ...init.macros },
    regionalMacros: structuredClone(init.regionalMacros ?? {}),
    modifiers: { ...init.modifiers },
    skin: { ...DEFAULT_SKIN, ...init.skin },
    eyes: {
      iris: [...(init.eyes?.iris ?? DEFAULT_EYES.iris)] as Rgb,
      scleraWarmth: init.eyes?.scleraWarmth ?? DEFAULT_EYES.scleraWarmth,
    },
    ...(init.outfit && { outfit: [...init.outfit] }),
  };
}
