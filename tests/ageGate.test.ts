/**
 * The age gate's edges (docs/AGE-POLICY.md, "One predicate decides who is an
 * adult"): every value that is not a finite age of 18 or more is not adult, on
 * every route, including the ones that never run recipe validation.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { affordances } from "../src/affordance/registry.ts";
import { sliderAvailability, withSliderValue } from "../src/editor/controls.ts";
import { ADULT_AGE, isAdultAge } from "../src/makehuman/macro.ts";
import { recipeContributions } from "../src/makehuman/recipeMorph.ts";
import {
  AgePolicyError,
  agePolicyViolations,
  assertAgePolicy,
  assertSignalPolicy,
  isAdult,
  withAge,
} from "../src/recipe/agePolicy.ts";
import { withAnatomyDefaults } from "../src/recipe/anatomy.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { RecipeValidationError, recipeProblems } from "../src/recipe/validate.ts";
import {
  type BodyHairRecipe,
  bodyHairCoverage,
  defaultBodyHairCoverage,
} from "../src/surface/bodyHair.ts";
import { DEFAULT_HAIR_COLOUR } from "../src/surface/hairTone.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets(true);
const adultModifier = adultManifest.modifiers[0]?.id as string;
const adultEntry = assets.sliders
  .flatMap((t) => t.groups.flatMap((g) => g.sliders))
  .find((s) => s.id === adultModifier);
if (!adultEntry) throw new Error(`no slider for ${adultModifier}`);

/** What a JSON save, a URL or a careless caller can put where an age belongs. */
const NOT_AGES: readonly [string, unknown][] = [
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  ["a negative age", -5],
  ["zero", 0],
  ["undefined", undefined],
  ["null", null],
  ["a numeric string", "30"],
  ["a boolean", true],
  ["an array", [30]],
];

/** A recipe whose age is whatever `age` is: the type forbids most of these, JSON does not. */
const withBadAge = (age: unknown, init: Parameters<typeof createRecipe>[0] = {}): Recipe => {
  const r = createRecipe(init);
  (r.macros as unknown as Record<string, unknown>).age = age;
  return r;
};

describe("isAdultAge", () => {
  it("is true only for a finite number of 18 or more", () => {
    expect(isAdultAge(ADULT_AGE)).toBe(true);
    expect(isAdultAge(ADULT_AGE - 1e-9)).toBe(false);
    expect(isAdultAge(90)).toBe(true);
    expect(isAdultAge(1e6)).toBe(true);
    for (const [, v] of NOT_AGES) expect(isAdultAge(v)).toBe(false);
  });

  it("agrees with the plain comparison on every finite number", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (age) => {
        expect(isAdultAge(age)).toBe(age >= ADULT_AGE);
      }),
    );
  });
});

describe.each(NOT_AGES)("a recipe whose age is %s", (_name, age) => {
  it("is not an adult", () => {
    expect(isAdult(withBadAge(age))).toBe(false);
  });

  it("is refused adult-only modifiers and pubic hair by the policy", () => {
    const r = withBadAge(age, {
      modifiers: { [adultModifier]: 0.5 },
      bodyHair: { density: { pubic: 1 } },
    });
    expect(agePolicyViolations(r)).toEqual([
      `modifier ${adultModifier} is adult-only`,
      "body hair pubic is adult-only",
    ]);
    expect(() => assertAgePolicy(r)).toThrow(AgePolicyError);
  });

  it("is never evaluated with adult anatomy: the validator or the policy refuses it", () => {
    const r = withBadAge(age, { modifiers: { [adultModifier]: 0.5 } });
    const notANumber = typeof age !== "number" || !Number.isFinite(age);
    // Not a finite number: refused as malformed. A finite number under 18: refused by the policy.
    expect(() => recipeContributions(r, assets.modifiers)).toThrow(
      notANumber ? RecipeValidationError : AgePolicyError,
    );
    expect(recipeProblems(r).includes("macros.age must be a finite number")).toBe(notANumber);
  });

  it("has none of the adult anatomy's affordances, and no default anatomy", () => {
    const packAperture = {
      id: "a-pack-aperture",
      kind: "aperture",
      at: { landmark: "pubic-point" },
      adult: true,
    } as const;
    expect(affordances(withBadAge(age), [packAperture]).map((a) => a.id)).toEqual([]);
    const r = withBadAge(age, { macros: { gender: 0.5 } });
    expect(withAnatomyDefaults(r, adultManifest.anatomy?.defaults)).toBe(r);
  });

  it("is refused the adult-only signal", () => {
    expect(() => assertSignalPolicy(withBadAge(age), { arousal: 0.4 })).toThrow(AgePolicyError);
  });

  it("is refused an adult-only slider by the editor, which never clamps it", () => {
    const r = withBadAge(age);
    expect(sliderAvailability(r, adultEntry, assets.modifiers).enabled).toBe(false);
    expect(() => withSliderValue(r, adultEntry, 0.5, assets.modifiers)).toThrow(AgePolicyError);
  });

  it("has its adult-only values removed when withAge moves it below 18", () => {
    const adult = createRecipe({
      macros: { age: 30 },
      modifiers: { [adultModifier]: 0.5 },
      bodyHair: { density: { pubic: 1 } },
    });
    const moved = withAge(adult, age as number);
    expect(moved.modifiers).toEqual({});
    expect(moved.bodyHair?.density).toEqual({});
  });
});

describe("pubic hair at an age that is not a finite number", () => {
  const input = (age: number, bodyHair?: BodyHairRecipe) => ({
    age,
    colour: DEFAULT_HAIR_COLOUR,
    ...(bodyHair && { bodyHair }),
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("is never drawn at %s, by default or by an explicit coverage", (_name, age) => {
    expect(defaultBodyHairCoverage("pubic", age)).toBe(0);
    expect(bodyHairCoverage("pubic", input(age))).toBe(0);
    expect(bodyHairCoverage("pubic", input(age, { coverage: { pubic: 1 } }))).toBe(0);
    expect(bodyHairCoverage("chest", input(age, { coverage: { chest: 1 } }))).toBe(0);
  });

  it("is drawn from 18, as an adult's explicit coverage asks", () => {
    expect(bodyHairCoverage("pubic", input(ADULT_AGE, { coverage: { pubic: 0.5 } }))).toBe(0.5);
    expect(bodyHairCoverage("pubic", input(ADULT_AGE - 0.01, { coverage: { pubic: 0.5 } }))).toBe(
      0,
    );
  });
});

describe("a recipe without an age", () => {
  it("is not an adult, and the validator names the missing age", () => {
    const r = createRecipe({ modifiers: { [adultModifier]: 0.5 } });
    delete (r.macros as unknown as Record<string, unknown>).age;
    expect(isAdult(r)).toBe(false);
    expect(agePolicyViolations(r)).toEqual([`modifier ${adultModifier} is adult-only`]);
    expect(recipeProblems(r)).toContain("macros.age must be a finite number");
    expect(() => recipeContributions(r, assets.modifiers)).toThrow(RecipeValidationError);
  });
});

describe("a recipe of exactly 18", () => {
  it("is an adult: the adult pack's modifiers and pubic hair are allowed", () => {
    const r = createRecipe({
      macros: { age: ADULT_AGE },
      modifiers: { [adultModifier]: 0.5 },
      bodyHair: { density: { pubic: 1 } },
    });
    expect(isAdult(r)).toBe(true);
    expect(agePolicyViolations(r)).toEqual([]);
    expect(() => recipeContributions(r, assets.modifiers)).not.toThrow();
  });
});
