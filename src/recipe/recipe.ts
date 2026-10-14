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
import type { GarmentLook } from "../model/garmentLook.ts";
import type { BodyHairRecipe } from "../surface/bodyHair.ts";
import { DEFAULT_HAIR_COLOUR, type HairColour } from "../surface/hairTone.ts";
import type { Rgb } from "../surface/skinTone.ts";
import { type BodyArtInit, type BodyArtRecipe, createBodyArt } from "./bodyArt.ts";

export const RECIPE_VERSION = 1 as const;

/** Macros a region may override. Age is a property of the whole figure. */
export type RegionalMacroValues = Omit<MacroValues, "age">;

/**
 * A breast region's optional source-frame choice. `breastPresence` is not a
 * macro: in `breastL` and `breastR` it selects the existing MakeHuman source
 * frame (0 = male share, 1 = female share) beneath that side's breast targets.
 */
export type BreastRegionalTraitValues = Partial<RegionalMacroValues> & {
  breastPresence?: number;
};

/** Values that may vary by body region; only breast regions admit `breastPresence`. */
export type RegionalTraitValues = {
  [Region in BodyRegion]?: Region extends "breastL" | "breastR"
    ? BreastRegionalTraitValues
    : Partial<RegionalMacroValues>;
};

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
  /**
   * An eye material of the eye pack (`humanoid-kit-eyes`): its texture's iris pattern and
   * sclera detail, worn in `iris` and `scleraWarmth`'s colours. Absent is the built-in
   * texture, so a recipe saved before eye materials existed is unchanged. It names a
   * material the loaded library must have; without a library the built-in one is shown.
   */
  material?: string;
}

export const DEFAULT_EYES: Readonly<EyesRecipe> = {
  iris: [0.12, 0.055, 0.025],
  scleraWarmth: 0.5,
};

export interface HairRecipe {
  /**
   * A style id of the hair pack (`humanoid-kit-hair`), or null for none. It
   * names a style the loaded pack must have; evaluation rejects an unknown id.
   */
  style: string | null;
  /** The hair's colour, from two pigments (`hairAlbedo`). One colour tints the scalp hair, the brows and the lashes. */
  colour: HairColour;
  /**
   * A brows style id of the hair pack (`eyebrow001`…), worn on the figure. Absent
   * is none, so a recipe saved before brows existed is unchanged.
   */
  brows?: string;
  /** A lashes style id of the hair pack (`eyelashes01`…); absent is none. */
  lashes?: string;
}

/** Authored beard and moustache ids from the hair pack, worn together when selected. */
export type FacialHairRecipe = readonly string[];

/**
 * Extra source-authored free-offset length for selected beard attachments.
 * Each value is a multiplier: one keeps the source asset exactly as packed.
 */
export type FacialHairLengthRecipe = Readonly<Record<string, number>>;

export interface Recipe {
  version: typeof RECIPE_VERSION;
  macros: MacroValues;
  regionalMacros: RegionalTraitValues;
  /** Shape modifier id → value in [-1, 1] (one-sided modifiers [0, 1]). Missing ids are 0. */
  modifiers: Record<string, number>;
  skin: SkinRecipe;
  eyes: EyesRecipe;
  /**
   * Scalp hair. Optional: a recipe without it has none, and recipes saved before
   * hair existed are unchanged. It never changes the body's shape.
   */
  hair?: HairRecipe;
  /** Authored facial hair (`humanoid-kit-hair`); absent means none. */
  facialHair?: FacialHairRecipe;
  /**
   * Optional source-offset multipliers for selected authored beard assets.
   * Moustache and other non-beard entries do not accept a multiplier.
   */
  facialHairLength?: FacialHairLengthRecipe;
  /**
   * Body hair: legacy per-region multipliers on the physiological default, or
   * explicit coverage and physical follicle-density controls, plus a beard
   * style. Optional: absent is the default for age (`bodyHairCoverage`,
   * `beardStyle`), so recipes saved before body hair existed are unchanged. The
   * pubic controls are adult-only (the age policy refuses them under 18).
   */
  bodyHair?: BodyHairRecipe;
  /**
   * Ids of the garments the figure wears (`humanoid-kit-clothing`), in any
   * order: how they stack comes from each garment's category. Absent means
   * nothing worn.
   */
  outfit?: readonly string[];
  /**
   * Per worn garment id, the figure's own colour and finish for it
   * (`GarmentLook`). Absent means every garment as its pack made it. A look for
   * a garment the figure does not wear is ignored.
   */
  outfitLook?: Readonly<Record<string, GarmentLook>>;
  /**
   * Tattoos, piercings, scars, birthmarks and vitiligo (`./bodyArt.ts`).
   * Absent means none, and recipes saved before body art existed are unchanged.
   */
  bodyArt?: BodyArtRecipe;
}

/**
 * `recipe` with its hair changed by `patch`: the scalp style (`null` for none),
 * the colour, and the brows and lashes (`null` takes one away). What the patch
 * leaves out stays, so choosing a style or a colour never loses the brows and
 * lashes, and a figure with no hair starts from none at the default colour.
 */
export function withHair(
  recipe: Recipe,
  patch: {
    style?: string | null;
    colour?: HairColour;
    brows?: string | null;
    lashes?: string | null;
  },
): Recipe {
  const now = recipe.hair;
  const brows = patch.brows === undefined ? now?.brows : (patch.brows ?? undefined);
  const lashes = patch.lashes === undefined ? now?.lashes : (patch.lashes ?? undefined);
  return {
    ...recipe,
    hair: {
      style: patch.style === undefined ? (now?.style ?? null) : patch.style,
      colour: patch.colour ?? now?.colour ?? { ...DEFAULT_HAIR_COLOUR },
      ...(brows && { brows }),
      ...(lashes && { lashes }),
    },
  };
}

export function createRecipe(
  init: {
    macros?: Partial<MacroValues>;
    regionalMacros?: Recipe["regionalMacros"];
    modifiers?: Record<string, number>;
    skin?: Partial<SkinRecipe>;
    eyes?: Partial<EyesRecipe>;
    hair?: {
      style?: string | null;
      colour?: Partial<HairColour>;
      brows?: string;
      lashes?: string;
    };
    facialHair?: FacialHairRecipe;
    facialHairLength?: FacialHairLengthRecipe;
    bodyHair?: BodyHairRecipe;
    outfit?: readonly string[];
    outfitLook?: Readonly<Record<string, GarmentLook>>;
    bodyArt?: BodyArtInit;
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
      ...(init.eyes?.material && { material: init.eyes.material }),
    },
    ...(init.hair && {
      hair: {
        style: init.hair.style ?? null,
        ...(init.hair.brows && { brows: init.hair.brows }),
        ...(init.hair.lashes && { lashes: init.hair.lashes }),
        colour: {
          ...DEFAULT_HAIR_COLOUR,
          ...init.hair.colour,
          override: init.hair.colour?.override ? ([...init.hair.colour.override] as Rgb) : null,
        },
      },
    }),
    ...(init.facialHair && { facialHair: [...init.facialHair] }),
    ...(init.facialHairLength && { facialHairLength: { ...init.facialHairLength } }),
    ...(init.bodyHair && {
      bodyHair: {
        ...(init.bodyHair.density && { density: { ...init.bodyHair.density } }),
        ...(init.bodyHair.coverage && { coverage: { ...init.bodyHair.coverage } }),
        ...(init.bodyHair.follicleDensity && {
          follicleDensity: { ...init.bodyHair.follicleDensity },
        }),
        ...(init.bodyHair.beard && {
          beard:
            typeof init.bodyHair.beard === "string"
              ? init.bodyHair.beard
              : { ...init.bodyHair.beard },
        }),
      },
    }),
    ...(init.outfit && { outfit: [...init.outfit] }),
    ...(init.outfitLook && {
      outfitLook: Object.fromEntries(
        Object.entries(init.outfitLook).map(([id, look]) => [
          id,
          {
            ...(look.tint && { tint: [...look.tint] as Rgb }),
            ...(look.roughness !== undefined && { roughness: look.roughness }),
            ...(look.wear !== undefined && { wear: look.wear }),
          },
        ]),
      ),
    }),
    ...(init.bodyArt && { bodyArt: createBodyArt(init.bodyArt) }),
  };
}
