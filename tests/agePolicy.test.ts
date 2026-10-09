import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_MACROS, macroTargetWeights } from "../src/makehuman/macro.ts";
import { recipeContributions } from "../src/makehuman/recipeMorph.ts";
import {
  ADULT_AGE,
  ADULT_ONLY_MODIFIER,
  AgePolicyError,
  agePolicyViolations,
  withAge,
} from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { RecipeValidationError } from "../src/recipe/validate.ts";
import { adultManifest, bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets(true);
const adultModifiers = adultManifest.modifiers;
const minorAge = fc.double({ min: 1, max: ADULT_AGE - 1e-6, noNaN: true });

describe("age policy", () => {
  it("gates exactly the adult anatomy pack's modifiers, as the packer flags them", () => {
    expect(adultModifiers.length).toBeGreaterThan(0);
    for (const m of [...adultModifiers, ...bodyManifest.modifiers]) {
      expect(ADULT_ONLY_MODIFIER(m.id), m.id).toBe(m.adultOnly);
    }
    for (const m of adultModifiers) expect(m.adultOnly, m.id).toBe(true);
    for (const m of bodyManifest.modifiers) expect(m.adultOnly, m.id).toBe(false);
  });

  it("keeps adult anatomy targets out of the body pack entirely", () => {
    const body = new Set(bodyManifest.targets.entries.map((e) => e.name));
    for (const e of adultManifest.targets.entries) expect(body.has(e.name), e.name).toBe(false);
    for (const name of body)
      expect(name).not.toMatch(/^(genitals\/|pelvis\/bulge-|stomach\/stomach-pregnant-)/);
  });

  it("rejects any adult anatomy modifier on a figure under 18", () => {
    fc.assert(
      fc.property(
        minorAge,
        fc.constantFrom(...adultModifiers.map((m) => m.id)),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        (age, id, v) => {
          const r = createRecipe({ macros: { age }, modifiers: { [id]: v } });
          expect(agePolicyViolations(r)).not.toEqual([]);
          expect(() => recipeContributions(r, assets.modifiers)).toThrow(AgePolicyError);
        },
      ),
    );
  });

  it("never emits an adult anatomy target for a valid recipe under 18", () => {
    const adultTargets = new Set(adultManifest.targets.entries.map((e) => e.name));
    fc.assert(
      fc.property(minorAge, fc.double({ min: 0, max: 1, noNaN: true }), (age, gender) => {
        for (const c of recipeContributions(
          createRecipe({ macros: { age, gender } }),
          assets.modifiers,
        )) {
          expect(adultTargets.has(c.target)).toBe(false);
        }
      }),
    );
  });

  it("allows adult anatomy modifiers at 18 and over", () => {
    const id = adultModifiers[0]?.id as string;
    const r = createRecipe({ macros: { age: ADULT_AGE }, modifiers: { [id]: 0.5 } });
    expect(agePolicyViolations(r)).toEqual([]);
    expect(
      recipeContributions(r, assets.modifiers).some((c) =>
        adultManifest.targets.entries.some((e) => e.name === c.target),
      ),
    ).toBe(true);
  });

  it("withAge strips adult anatomy modifiers when moving under 18 and keeps them otherwise", () => {
    const id = adultModifiers[0]?.id as string;
    const adult = createRecipe({ macros: { age: 30 }, modifiers: { [id]: 1 } });
    const minor = withAge(adult, 12);
    expect(agePolicyViolations(minor)).toEqual([]);
    expect(minor.modifiers[id]).toBeUndefined();
    expect(adult.modifiers[id]).toBe(1); // input untouched
    expect(withAge(adult, 40).modifiers[id]).toBe(1);
  });

  it("rejects an age smuggled into a regional override (JSON can carry what the type forbids)", () => {
    fc.assert(
      fc.property(minorAge, fc.double({ min: 18, max: 90, noNaN: true }), (age, smuggled) => {
        const r = createRecipe({ macros: { age } });
        (r.regionalMacros as Record<string, Record<string, number>>).breastL = { age: smuggled };
        expect(() => recipeContributions(r, assets.modifiers)).toThrow(RecipeValidationError);
      }),
    );
  });

  it("rejects a NaN age rather than guessing an age for it", () => {
    expect(() =>
      recipeContributions(createRecipe({ macros: { age: Number.NaN } }), assets.modifiers),
    ).toThrow(RecipeValidationError);
  });
});

describe("breast development follows MakeHuman", () => {
  const breastWeights = (age: number) =>
    [...macroTargetWeights({ ...DEFAULT_MACROS, gender: 0, age, breastSize: 0.8 })].filter(([n]) =>
      n.startsWith("breast/"),
    );

  it("blends the child and young anchors through adolescence", () => {
    const names = breastWeights(16).map(([n]) => n);
    expect(names.some((n) => n.includes("-child-"))).toBe(true);
    expect(names.some((n) => n.includes("-young-"))).toBe(true);
  });

  it("has no baby breast targets, as upstream", () => {
    for (const [n] of breastWeights(1)) expect(n).not.toMatch(/-baby-/);
  });
});
