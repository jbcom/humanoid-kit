import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recipeContributions } from "../src/makehuman/recipeMorph.ts";
import {
  ADULT_AGE,
  ADULT_ONLY_MODIFIER,
  AgePolicyError,
  agePolicyViolations,
  withAge,
} from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets(true);
const adultModifiers = adultManifest.modifiers;
const minorAge = fc.double({ min: 1, max: ADULT_AGE - 1e-6, noNaN: true });

describe("age policy", () => {
  it("the packer's adult-only flag and the policy predicate agree on every modifier", () => {
    expect(adultModifiers.length).toBeGreaterThan(0);
    for (const m of adultModifiers) expect(ADULT_ONLY_MODIFIER(m.id), m.id).toBe(true);
    for (const m of bodyManifest.modifiers) expect(ADULT_ONLY_MODIFIER(m.id), m.id).toBe(false);
  });

  it("keeps adult-only targets out of the body pack entirely", () => {
    const body = new Set(bodyManifest.targets.entries.map((e) => e.name));
    for (const e of adultManifest.targets.entries) expect(body.has(e.name), e.name).toBe(false);
    for (const name of body)
      expect(name).not.toMatch(/^(genitals\/|pelvis\/bulge-|stomach\/stomach-pregnant-)/);
  });

  it("rejects any adult-only value on a figure under 18", () => {
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
    fc.assert(
      fc.property(
        minorAge,
        fc.double({ min: 0, max: 1, noNaN: true }).filter((x) => x !== 0.5),
        (age, b) => {
          expect(() =>
            recipeContributions(createRecipe({ macros: { age, breastSize: b } }), assets.modifiers),
          ).toThrow(AgePolicyError);
          expect(() =>
            recipeContributions(
              createRecipe({ macros: { age }, regionalMacros: { breastL: { breastSize: b } } }),
              assets.modifiers,
            ),
          ).toThrow(AgePolicyError);
        },
      ),
    );
  });

  it("never emits an adult-only or breast target for a valid recipe under 18", () => {
    const adultTargets = new Set(adultManifest.targets.entries.map((e) => e.name));
    fc.assert(
      fc.property(minorAge, fc.double({ min: 0, max: 1, noNaN: true }), (age, gender) => {
        for (const c of recipeContributions(
          createRecipe({ macros: { age, gender } }),
          assets.modifiers,
        )) {
          expect(adultTargets.has(c.target)).toBe(false);
          expect(c.target.startsWith("breast/female-")).toBe(false);
        }
      }),
    );
  });

  it("allows adult-only modifiers at 18 and over", () => {
    const id = adultModifiers[0]?.id as string;
    const r = createRecipe({ macros: { age: ADULT_AGE }, modifiers: { [id]: 0.5 } });
    expect(agePolicyViolations(r)).toEqual([]);
    expect(
      recipeContributions(r, assets.modifiers).some(
        (c) =>
          c.target.startsWith("genitals/") ||
          c.target.startsWith("pelvis/") ||
          c.target.startsWith("stomach/"),
      ),
    ).toBe(true);
  });

  it("withAge strips adult-only values when moving under 18 and keeps them otherwise", () => {
    const id = adultModifiers[0]?.id as string;
    const adult = createRecipe({
      macros: { age: 30, breastSize: 0.9 },
      regionalMacros: { breastR: { breastSize: 0.2 } },
      modifiers: { [id]: 1 },
    });
    const minor = withAge(adult, 12);
    expect(agePolicyViolations(minor)).toEqual([]);
    expect(minor.modifiers[id]).toBeUndefined();
    expect(adult.modifiers[id]).toBe(1); // input untouched
    expect(withAge(adult, 40).modifiers[id]).toBe(1);
  });
});
