/**
 * Body hair: where terminal hair grows, how much, and what colour, from the
 * figure's androgen axis (the gender macro), its age and its hair pigments
 * (docs/research/BODY-HAIR.md, which cites every number or marks it a choice).
 *
 * Coverage is the Ferriman-Gallwey grade over 4 (0 none, 1 frank and dense), by
 * region group. It is pure data and arithmetic: the skin layers and the hair
 * cards that draw body hair read it, and nothing here knows how it is drawn.
 *
 * Axillary and pubic hair are adult-only under the age policy
 * (`src/recipe/agePolicy.ts`): their coverage is 0 for any figure that is not
 * an adult, whatever the recipe says, and a recipe that sets them under 18 is
 * refused there.
 */
import { ADULT_AGE } from "../makehuman/macro.ts";
import type { HairColour } from "./hairTone.ts";
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
export const ADULT_ONLY_BODY_HAIR: readonly BodyHairGroup[] = ["axillary", "pubic"];

export const isAdultOnlyBodyHair = (group: string): boolean =>
  (ADULT_ONLY_BODY_HAIR as readonly string[]).includes(group);

/**
 * How the face's terminal hair is worn: `none` is shaven, `stubble` a few days'
 * growth over the whole beard area, the rest grown out where they name.
 */
export const BEARD_STYLES = ["none", "stubble", "moustache", "goatee", "full"] as const;
export type BeardStyle = (typeof BEARD_STYLES)[number];

/** The recipe's optional `bodyHair`. Every field is optional; absent is the default for age and sex. */
export interface BodyHairRecipe {
  /** Per group, a multiplier on the default coverage, 0..`MAX_BODY_HAIR_DENSITY` (1 is the default). */
  density?: Partial<Record<BodyHairGroup, number>>;
  beard?: BeardStyle;
}

/** The largest density multiplier: twice a group's default, clamped to full coverage. */
export const MAX_BODY_HAIR_DENSITY = 2;

/** What body hair is computed from: the figure's age, androgen axis and hair pigments. */
export interface BodyHairInput {
  /** Years (`recipe.macros.age`). */
  age: number;
  /** 0 = female anchor, 1 = male anchor (`recipe.macros.gender`), read as the androgen level. */
  gender: number;
  /** The figure's hair pigments (`recipe.hair.colour`, or the default). */
  colour: HairColour;
  bodyHair?: BodyHairRecipe;
}

/**
 * Coverage at maturity, at the female and the male end of the androgen axis
 * (Ferriman-Gallwey grade / 4). Choices read off the FG scale (BODY-HAIR.md).
 */
export const BODY_HAIR_COVERAGE: Readonly<Record<BodyHairGroup, readonly [number, number]>> = {
  face: [0.1, 1],
  chest: [0, 0.6],
  abdomen: [0.1, 0.65],
  back: [0, 0.25],
  buttocks: [0.05, 0.35],
  arms: [0.3, 0.6],
  legs: [0.45, 0.85],
  axillary: [0.85, 0.95],
  pubic: [0.85, 0.95],
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
  axillary: [12, 18],
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
  face: { eumelanin: 0.08, greyLag: 0, diameter: 100e-6, length: 0.012 },
  chest: { eumelanin: 0, greyLag: 8, diameter: 70e-6, length: 0.02 },
  abdomen: { eumelanin: 0, greyLag: 8, diameter: 70e-6, length: 0.018 },
  back: { eumelanin: 0, greyLag: 8, diameter: 60e-6, length: 0.015 },
  buttocks: { eumelanin: 0, greyLag: 8, diameter: 60e-6, length: 0.012 },
  arms: { eumelanin: -0.08, greyLag: 8, diameter: 50e-6, length: 0.01 },
  legs: { eumelanin: -0.08, greyLag: 8, diameter: 55e-6, length: 0.015 },
  axillary: { eumelanin: 0.05, greyLag: 12, diameter: 90e-6, length: 0.02 },
  pubic: { eumelanin: 0.12, greyLag: 12, diameter: 100e-6, length: 0.025 },
};

/**
 * The fraction of grey fibres by age: a smoothstep from 35 to 95 years, which
 * gives 26 % at 55, the middle of Panhard et al. 2012's 45 to 65 cohort (mean
 * intensity 27 %), and 98 % at 90. A fit, not a curve they publish.
 */
export const GREY_ONSET = 35;
export const GREY_FULL = 95;

const unit = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = unit((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** The fraction of grey fibres at this age from ageing alone. */
export const ageGrey = (age: number): number => smoothstep(GREY_ONSET, GREY_FULL, age);

/**
 * A group's default coverage (0..1) for an age and androgen level, before the
 * recipe's multiplier. Adult-only groups are 0 unless `age` is an adult's, and
 * an age that is not a number fails closed.
 */
export function defaultBodyHairCoverage(group: BodyHairGroup, age: number, gender: number): number {
  if (isAdultOnlyBodyHair(group) && !(age >= ADULT_AGE)) return 0;
  const [female, male] = BODY_HAIR_COVERAGE[group];
  const a = unit(gender);
  const [onset, full] = BODY_HAIR_MATURITY[group];
  const old = BODY_HAIR_SENESCENCE[group];
  const coverage =
    (female + (male - female) * a) *
    smoothstep(onset, full, age) *
    (1 - old.loss * smoothstep(old.from, old.to, age));
  return Number.isFinite(coverage) ? coverage : 0;
}

/**
 * A group's terminal-hair coverage, 0..1: the default for the figure's age and
 * androgen level times the recipe's density multiplier. Adult-only groups are 0
 * for any figure that is not an adult, whatever the multiplier.
 */
export function bodyHairCoverage(group: BodyHairGroup, input: BodyHairInput): number {
  const base = defaultBodyHairCoverage(group, input.age, input.gender);
  if (base === 0) return 0;
  const m = input.bodyHair?.density?.[group] ?? 1;
  return unit(base * Math.min(MAX_BODY_HAIR_DENSITY, Math.max(0, m)));
}

/**
 * The beard style: the recipe's, or by default stubble where the face carries
 * terminal hair at all (a coverage of a quarter or more) and none otherwise.
 * The default is a choice: a shadow shows the androgen axis without picking a
 * style for the figure.
 */
export function beardStyle(input: BodyHairInput): BeardStyle {
  if (input.bodyHair?.beard) return input.bodyHair.beard;
  return bodyHairCoverage("face", input) >= 0.25 ? "stubble" : "none";
}

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
