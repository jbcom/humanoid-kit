/**
 * Seeded random figures. The same seed and options always give the same
 * recipe, so a random figure can be shared as its seed.
 *
 * Values cluster around the middle of each range (sums of uniforms), so most
 * figures look ordinary and extremes stay rare. Age is kept from the base
 * recipe unless an age range is given, and adult anatomy is never randomised
 * unless asked for and the figure is 18 or over.
 */
import { ADULT_AGE } from "../makehuman/macro.ts";
import { withAge } from "../recipe/agePolicy.ts";
import type { Recipe } from "../recipe/recipe.ts";
import type { Rgb } from "../surface/skinTone.ts";
import type { ModifierTable } from "./controls.ts";

export interface RandomizeOptions {
  /** Randomise age within [min, max] years; omitted, the base recipe's age is kept. */
  ageRange?: [number, number];
  /** Share of shape modifiers given a non-neutral value. Default 0.3. */
  modifierChance?: number;
  /** Largest modifier magnitude. Default 0.45. */
  modifierIntensity?: number;
  /** Also randomise adult anatomy modifiers (only ever for figures 18 and over). Default false. */
  includeAdultAnatomy?: boolean;
}

/** mulberry32: small, fast, and good enough for appearance. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Natural iris colours in linear RGB. */
export const IRIS_PALETTE: readonly { name: string; rgb: Readonly<Rgb> }[] = [
  { name: "Brown", rgb: [0.12, 0.055, 0.025] },
  { name: "Dark brown", rgb: [0.07, 0.03, 0.012] },
  { name: "Hazel", rgb: [0.2, 0.12, 0.04] },
  { name: "Amber", rgb: [0.25, 0.14, 0.03] },
  { name: "Green", rgb: [0.1, 0.16, 0.06] },
  { name: "Grey", rgb: [0.16, 0.18, 0.19] },
  { name: "Blue", rgb: [0.08, 0.14, 0.26] },
];

/** Shape groups that are whole-body archetypes rather than variation; never randomised. */
const ARCHETYPE_GROUPS = new Set(["bodyshapes"]);

export function randomRecipe(
  base: Recipe,
  seed: number,
  modifiers: ModifierTable,
  options: RandomizeOptions = {},
): Recipe {
  const rand = seededRandom(seed);
  const centred = (lo = 0, hi = 1) => lo + (hi - lo) * ((rand() + rand() + rand()) / 3);
  const chance = options.modifierChance ?? 0.3;
  const intensity = options.modifierIntensity ?? 0.45;

  const e = [rand(), rand(), rand()].map((u) => -Math.log(1 - u * 0.999));
  const eSum = (e[0] as number) + (e[1] as number) + (e[2] as number);
  const age = options.ageRange
    ? options.ageRange[0] + (options.ageRange[1] - options.ageRange[0]) * rand()
    : base.macros.age;

  const recipe: Recipe = withAge(
    {
      ...base,
      macros: {
        ...base.macros,
        gender: rand(),
        muscle: centred(0.15, 0.85),
        weight: centred(0.15, 0.85),
        height: centred(0.1, 0.9),
        proportions: centred(0.25, 1),
        african: (e[0] as number) / eSum,
        asian: (e[1] as number) / eSum,
        caucasian: (e[2] as number) / eSum,
        breastSize: centred(0.1, 0.9),
        breastFirmness: centred(0.2, 0.9),
      },
      regionalMacros: {},
      modifiers: {},
      skin: {
        ...base.skin,
        melanin: rand(),
        haemoglobin: centred(0.3, 0.7),
        undertone: centred(-0.6, 0.6),
        override: null,
        flush: centred(0.2, 0.7),
        lips: centred(0.3, 0.8),
        areola: centred(0.3, 0.8),
      },
      eyes: {
        iris: [
          ...(IRIS_PALETTE[Math.floor(rand() * IRIS_PALETTE.length)] as (typeof IRIS_PALETTE)[0])
            .rgb,
        ] as Rgb,
        scleraWarmth: centred(0.3, 0.7),
      },
    },
    age,
  );

  const adultAllowed = options.includeAdultAnatomy === true && recipe.macros.age >= ADULT_AGE;
  const values: Record<string, number> = {};
  // Code-unit order, not localeCompare: the same seed must give the same figure on every machine.
  for (const m of [...modifiers.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    // Draw for every modifier, used or not, so one modifier's eligibility never
    // shifts the random stream for the others.
    const pick = rand();
    const magnitude = rand();
    const sign = rand();
    if (ARCHETYPE_GROUPS.has(m.group) || (m.adultOnly && !adultAllowed) || pick >= chance) continue;
    const scale = intensity * magnitude;
    const v = Math.round((m.lo !== null && sign < 0.5 ? -scale : scale) * 1000) / 1000;
    if (v !== 0) values[m.id] = v;
  }
  return { ...recipe, modifiers: values };
}
