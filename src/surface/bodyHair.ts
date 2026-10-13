/**
 * Body hair: where terminal hair grows, how much, and what colour, from the
 * recipe's regional controls, the figure's age and its hair pigments
 * (docs/research/BODY-HAIR.md, which cites every number or marks it a choice).
 *
 * Coverage is the Ferriman-Gallwey grade over 4 (0 none, 1 frank and dense), by
 * region group. It is pure data and arithmetic: the skin layers and the hair
 * cards that draw body hair read it, and nothing here knows how it is drawn.
 * Nothing here reads the gender macro (DECISIONS ruling 1): it is a skeletal
 * frame blend, and every region's hair is the recipe's own independent choice.
 *
 * Pubic hair is adult-only under the age policy (`src/recipe/agePolicy.ts`):
 * its coverage is 0 for any figure that is not an adult, whatever the recipe
 * says, and a recipe that sets it under 18 is refused there. Axillary hair is
 * puberty's, not the policy's: it comes in from 13 like the face's, the arms'
 * and the legs' (owner ruling 2026-10-11).
 */
import { ADULT_AGE } from "../makehuman/macro.ts";
import { ageGrey, type HairColour } from "./hairTone.ts";
import type { Rgb } from "./skinTone.ts";

/** The region groups a recipe can set a density for, after the Ferriman-Gallwey regions. */
export const BODY_HAIR_GROUPS = [
  "face",
  "chest",
  "abdomen",
  "back",
  "buttocks",
  "arms",
  "legs",
  "axillary",
  "pubic",
] as const;
export type BodyHairGroup = (typeof BODY_HAIR_GROUPS)[number];

/** Groups drawn only for adults (the age policy's line, not puberty's). */
export const ADULT_ONLY_BODY_HAIR: readonly BodyHairGroup[] = ["pubic"];

export const isAdultOnlyBodyHair = (group: string): boolean =>
  (ADULT_ONLY_BODY_HAIR as readonly string[]).includes(group);

/**
 * How the face's terminal hair is worn: `none` is shaven, `stubble` a few days'
 * growth over the whole beard area, the rest grown out where they name
 * (`src/surface/beard.ts` has each style's parts and default length).
 */
export const BEARD_STYLES = [
  "none",
  "stubble",
  "moustache",
  "goatee",
  "imperial",
  "mutton-chops",
  "chin-curtain",
  "full",
  "forked",
  "longstreet",
] as const;
export type BeardStyle = (typeof BEARD_STYLES)[number];

/**
 * A beard with its continuous controls. Every field but `style` is optional,
 * and absent is the style's default (`BEARD_SHAPES`).
 */
export interface BeardSpec {
  style: BeardStyle;
  /** The longest part's length, metres: 0 up to the chin's height above the floor. */
  length?: number;
  /** How full it is, 0..`MAX_BEARD_VOLUME`: the cards' density and how far they stand off the skin. */
  volume?: number;
  /** The fraction of its hairs that are white, 0..1, on top of the colour's own grey. */
  grey?: number;
  /** How far the chin's hair parts into two points, 0..1. */
  fork?: number;
  /** How far the moustache parts at the middle and sweeps out, 0..1. */
  part?: number;
}

/** The largest beard volume: twice the default fullness. */
export const MAX_BEARD_VOLUME = 2;

/** The recipe's optional `bodyHair`. Every field is optional; absent is the default for age. */
export interface BodyHairRecipe {
  /**
   * Legacy per-group multiplier on the physiological default coverage,
   * 0..`MAX_BODY_HAIR_DENSITY` (1 is the default). Kept so saved recipes still
   * read; it follows the default's age course and clamps at full coverage, so
   * high multipliers on a dense default plateau. New recipes use `coverage`.
   */
  density?: Partial<Record<BodyHairGroup, number>>;
  /**
   * Explicit terminal-hair coverage, 0..1. An adult gets exactly this value,
   * with no age-course or senescence factor; before 18 it comes in over the
   * group's puberty onset, and the adult-only groups are 0. It is mutually
   * exclusive with that group's legacy `density`.
   */
  coverage?: Partial<Record<BodyHairGroup, number>>;
  /**
   * Per-group multiplier on physical follicles per cm², 0.25..2. This changes
   * strand spacing only; it does not alter the covered fraction.
   */
  follicleDensity?: Partial<Record<BodyHairGroup, number>>;
  /** A style by name, or a style with its continuous controls. */
  beard?: BeardStyle | BeardSpec;
}

/** The largest density multiplier: twice a group's default, clamped to full coverage. */
export const MAX_BODY_HAIR_DENSITY = 2;
/** The smallest supported physical follicle-density multiplier. */
export const MIN_BODY_HAIR_FOLLICLE_DENSITY = 0.25;
/** The largest supported physical follicle-density multiplier. */
export const MAX_BODY_HAIR_FOLLICLE_DENSITY = 2;

/** What body hair is computed from: the figure's age, hair pigments and regional controls. */
export interface BodyHairInput {
  /** Years (`recipe.macros.age`). */
  age: number;
  /** The figure's hair pigments (`recipe.hair.colour`, or the default). */
  colour: HairColour;
  bodyHair?: BodyHairRecipe;
}

/**
 * The physiological default coverage at maturity for a group a recipe leaves
 * unset (Ferriman-Gallwey grade / 4), one value for every figure. Choices: the
 * middle of the FG scale's typical adult range for each region (BODY-HAIR.md),
 * except the beard area, which is full because the beard style (default
 * shaven) is what decides whether a face grows one.
 */
export const BODY_HAIR_COVERAGE: Readonly<Record<BodyHairGroup, number>> = {
  face: 1,
  chest: 0.3,
  abdomen: 0.375,
  back: 0.125,
  buttocks: 0.2,
  arms: 0.45,
  legs: 0.65,
  axillary: 0.9,
  pubic: 0.9,
};

/** Years over which a group's terminal hair comes in (a smoothstep from onset to full). Choices on the Tanner ages. */
export const BODY_HAIR_MATURITY: Readonly<Record<BodyHairGroup, readonly [number, number]>> = {
  face: [13, 25],
  chest: [15, 35],
  abdomen: [15, 35],
  back: [18, 45],
  buttocks: [18, 45],
  arms: [11, 20],
  legs: [11, 20],
  // Axillary stage 2 at about 11.7 to 13.1 in girls and 13.6 to 14 in boys
  // (BODY-HAIR.md): onset 13, the owner's "around 13".
  axillary: [13, 18],
  pubic: [11, 17],
};

/** Old-age thinning: the fraction lost, and the years over which it goes. Choices. */
export const BODY_HAIR_SENESCENCE: Readonly<
  Record<BodyHairGroup, { loss: number; from: number; to: number }>
> = {
  face: { loss: 0, from: 55, to: 85 },
  chest: { loss: 0.4, from: 55, to: 85 },
  abdomen: { loss: 0.4, from: 55, to: 85 },
  back: { loss: 0.4, from: 55, to: 85 },
  buttocks: { loss: 0.4, from: 55, to: 85 },
  arms: { loss: 0.4, from: 55, to: 85 },
  legs: { loss: 0.4, from: 55, to: 85 },
  axillary: { loss: 0.5, from: 50, to: 85 },
  pubic: { loss: 0.5, from: 50, to: 85 },
};

/**
 * Per group: eumelanin added to the figure's hair (darker on the face and
 * pubis, lighter on the limbs), the years its greying lags the scalp's, fibre
 * diameter and drawn length (metres). Choices (BODY-HAIR.md).
 */
export const BODY_HAIR_FIBRE: Readonly<
  Record<BodyHairGroup, { eumelanin: number; greyLag: number; diameter: number; length: number }>
> = {
  face: { eumelanin: 0.08, greyLag: 0, diameter: 120e-6, length: 0.012 },
  // These terminal fibres must exceed the coat shader's subpixel floor at the
  // direct-control endpoints; otherwise physical follicle density is visibly flat.
  chest: { eumelanin: 0, greyLag: 8, diameter: 120e-6, length: 0.02 },
  abdomen: { eumelanin: 0, greyLag: 8, diameter: 70e-6, length: 0.018 },
  back: { eumelanin: 0, greyLag: 8, diameter: 60e-6, length: 0.015 },
  buttocks: { eumelanin: 0, greyLag: 8, diameter: 60e-6, length: 0.012 },
  arms: { eumelanin: -0.08, greyLag: 8, diameter: 50e-6, length: 0.01 },
  legs: { eumelanin: -0.08, greyLag: 8, diameter: 100e-6, length: 0.015 },
  axillary: { eumelanin: 0.05, greyLag: 12, diameter: 120e-6, length: 0.02 },
  pubic: { eumelanin: 0.12, greyLag: 12, diameter: 100e-6, length: 0.025 },
};

/**
 * Follicles per cm² by region group. Otberg et al. 2004 measured 14 (calf) to
 * 32 (upper arm); the values between, and the beard's, armpit's and pubis's,
 * are choices (BODY-HAIR.md).
 */
export const BODY_HAIR_FOLLICLE_DENSITY: Readonly<Record<BodyHairGroup, number>> = {
  face: 60,
  chest: 22,
  abdomen: 22,
  back: 26,
  buttocks: 20,
  arms: 25,
  legs: 16,
  axillary: 60,
  pubic: 40,
};

/** `x` clamped to 0..1; not a number is 0, so an unvalidated control fails closed. */
const unit = (x: number) => (x > 0 ? (x < 1 ? x : 1) : 0);
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = unit((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/**
 * The fraction of a group's default mature coverage present at this age: its
 * puberty course and its old-age thinning. It shapes the default (and the
 * legacy multiplier on it), never an adult's explicit coverage.
 */
function bodyHairAgeFactor(group: BodyHairGroup, age: number): number {
  if (isAdultOnlyBodyHair(group) && !(age >= ADULT_AGE)) return 0;
  const [onset, full] = BODY_HAIR_MATURITY[group];
  const old = BODY_HAIR_SENESCENCE[group];
  const factor = smoothstep(onset, full, age) * (1 - old.loss * smoothstep(old.from, old.to, age));
  return Number.isFinite(factor) ? factor : 0;
}

/**
 * The fraction of an explicit coverage present at this age: all of it for an
 * adult, and before 18 the group's puberty onset, brought to completion at 18
 * (a group whose onset is 18 or later comes in at 18). Adult-only groups are 0
 * below 18, and an age that is not a number fails closed.
 */
function explicitAgeFactor(group: BodyHairGroup, age: number): number {
  if (Number.isNaN(age)) return 0;
  if (age >= ADULT_AGE) return 1;
  if (isAdultOnlyBodyHair(group)) return 0;
  const onset = BODY_HAIR_MATURITY[group][0];
  return onset >= ADULT_AGE ? 0 : smoothstep(onset, ADULT_AGE, age);
}

/**
 * A group's default coverage (0..1) for an age, before the recipe's legacy
 * multiplier. Adult-only groups are 0 unless `age` is an adult's, and an age
 * that is not a number fails closed.
 */
export function defaultBodyHairCoverage(group: BodyHairGroup, age: number): number {
  const coverage = BODY_HAIR_COVERAGE[group] * bodyHairAgeFactor(group, age);
  return Number.isFinite(coverage) ? coverage : 0;
}

/**
 * A group's terminal-hair coverage, 0..1. An explicit `coverage` is an
 * adult's exactly (`explicitAgeFactor` before 18); otherwise it is the
 * default for the figure's age times the recipe's legacy density multiplier.
 * Adult-only groups are 0 for any figure that is not an adult, whatever the
 * control.
 */
export function bodyHairCoverage(group: BodyHairGroup, input: BodyHairInput): number {
  const explicit = input.bodyHair?.coverage?.[group];
  if (explicit !== undefined) return unit(explicit) * explicitAgeFactor(group, input.age);
  const base = defaultBodyHairCoverage(group, input.age);
  if (base === 0) return 0;
  const m = input.bodyHair?.density?.[group] ?? 1;
  return unit(base * Math.min(MAX_BODY_HAIR_DENSITY, Math.max(0, m)));
}

/**
 * Physical follicles per cm² for this group. Unlike `bodyHairCoverage`, this
 * changes strand spacing without changing the mask's covered fraction.
 */
export function bodyHairFollicleDensity(group: BodyHairGroup, input: BodyHairInput): number {
  const requested = input.bodyHair?.follicleDensity?.[group] ?? 1;
  const multiplier = Number.isFinite(requested)
    ? Math.min(MAX_BODY_HAIR_FOLLICLE_DENSITY, Math.max(MIN_BODY_HAIR_FOLLICLE_DENSITY, requested))
    : 1;
  return BODY_HAIR_FOLLICLE_DENSITY[group] * multiplier;
}

/** The beard a recipe that names none wears: clean-shaven, the neutral recipe. */
export const DEFAULT_BEARD: BeardStyle = "none";

/** The recipe's beard with its controls, the style alone if it names only that, or the default. */
export function beardSpec(input: Pick<BodyHairInput, "bodyHair">): BeardSpec {
  const beard = input.bodyHair?.beard ?? DEFAULT_BEARD;
  return typeof beard === "string" ? { style: beard } : beard;
}

/** The beard style: the recipe's, or `DEFAULT_BEARD`. */
export const beardStyle = (input: BodyHairInput): BeardStyle => beardSpec(input).style;

/**
 * A group's hair colour: the figure's pigments, darker or lighter by region,
 * and at least as grey as ageing makes it (lagging the scalp by the group's
 * `greyLag`). The recipe's own grey stands for the scalp and is kept as a
 * floor; an override colour (dyed hair) is kept as it is.
 */
export function bodyHairColour(group: BodyHairGroup, input: BodyHairInput): HairColour {
  const fibre = BODY_HAIR_FIBRE[group];
  const c = input.colour;
  return {
    eumelanin: unit(c.eumelanin + fibre.eumelanin),
    pheomelanin: unit(c.pheomelanin),
    grey: Math.max(unit(c.grey), ageGrey(input.age - fibre.greyLag)),
    override: c.override ? ([...c.override] as Rgb) : null,
  };
}
