import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  ADULT_ONLY_BODY_HAIR,
  BODY_HAIR_GROUPS,
  type BodyHairGroup,
  type BodyHairInput,
  type BodyHairRecipe,
  beardStyle,
  bodyHairColour,
  bodyHairCoverage,
  bodyHairFollicleDensity,
  DEFAULT_BEARD,
  defaultBodyHairCoverage,
} from "../src/surface/bodyHair.ts";
import { coatPaintFor } from "../src/surface/coatPaint.ts";
import {
  ageGrey,
  DEFAULT_HAIR_COLOUR,
  HAIR_COLOURS,
  type HairColour,
} from "../src/surface/hairTone.ts";
import type { SkinPaintInput } from "../src/surface/layers.ts";
import { TERMINAL_HAIR_LAYERS } from "../src/surface/regions/bodyHair.ts";
import { BODY_HAIR_COAT } from "../src/surface/regions/bodyHairCoat.ts";

const input = (
  age: number,
  bodyHair?: BodyHairRecipe,
  colour = DEFAULT_HAIR_COLOUR,
): BodyHairInput => ({
  age,
  colour,
  ...(bodyHair && { bodyHair }),
});
/** What the skin and coat layers paint body hair from, as a recipe hands it over. */
const paintInput = (age: number, gender: number, bodyHair?: BodyHairRecipe): SkinPaintInput => ({
  tone: { melanin: 0.5, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0,
  lips: 0,
  areola: 0,
  signals: {},
  age,
  build: { gender },
  adult: age >= 18,
  ...(bodyHair && { bodyHair }),
});
const BODY_HAIR_PAINT = [...BODY_HAIR_COAT, ...TERMINAL_HAIR_LAYERS];
const TERMINAL = BODY_HAIR_GROUPS.filter((g) => !ADULT_ONLY_BODY_HAIR.includes(g));
const explicit = (age: number, g: BodyHairGroup, c: number) =>
  bodyHairCoverage(g, input(age, { coverage: { [g]: c } }));

describe("body hair coverage", () => {
  it("is zero everywhere before puberty", () => {
    for (const g of BODY_HAIR_GROUPS) expect(defaultBodyHairCoverage(g, 8)).toBe(0);
  });

  it("rises through adolescence and is fuller in a young adult than a teenager", () => {
    for (const g of TERMINAL)
      expect(defaultBodyHairCoverage(g, 30)).toBeGreaterThanOrEqual(defaultBodyHairCoverage(g, 15));
    expect(defaultBodyHairCoverage("face", 16)).toBeGreaterThan(0);
    expect(defaultBodyHairCoverage("legs", 14)).toBeGreaterThan(0);
  });

  // DECISIONS ruling 1: no trait is multiplied, clamped or switched off by `gender`.
  it("paints the same hair at every gender value, omitted, legacy or explicit, in every region at every age", () => {
    const controls = (g: BodyHairGroup, m: number, c: number): (BodyHairRecipe | undefined)[] => [
      undefined,
      { beard: "full" },
      { beard: "stubble", density: { [g]: m } },
      { beard: "full", coverage: { [g]: c }, follicleDensity: { [g]: 2 } },
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...BODY_HAIR_GROUPS),
        fc.double({ min: 1, max: 90, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (g, age, gender, m, c) => {
          for (const bodyHair of controls(g, m, c))
            for (const region of BODY_HAIR_PAINT)
              expect(region.paint(paintInput(age, gender, bodyHair))).toEqual(
                region.paint(paintInput(age, 0, bodyHair)),
              );
        },
      ),
      { numRuns: 60 },
    );
  });

  it("hands the renderer the same coat at every gender value for a recipe's explicit or legacy controls", () => {
    const recipes: BodyHairRecipe[] = [
      { beard: "full", density: { face: 1, chest: 2, back: 2, axillary: 1, pubic: 2 } },
      { beard: "full", coverage: { face: 0.5, chest: 0.75, back: 1, axillary: 0.25, pubic: 0.5 } },
    ];
    for (const bodyHair of recipes) {
      const at = (gender: number) =>
        Array.from(coatPaintFor(createRecipe({ macros: { age: 30, gender }, bodyHair })) ?? []);
      expect(at(0).length).toBeGreaterThan(0);
      expect(at(0)).toEqual(at(1));
      expect(at(0.5)).toEqual(at(1));
    }
  });

  it("gives every adult figure the same physiological default, beard area and chest included", () => {
    expect(bodyHairCoverage("face", input(35))).toBeGreaterThan(0.9);
    expect(bodyHairCoverage("chest", input(35))).toBeGreaterThan(0);
    expect(bodyHairCoverage("back", input(45))).toBeGreaterThan(0);
    expect(bodyHairCoverage("legs", input(35))).toBeGreaterThan(0.4);
  });

  it("thins on the body in old age and keeps the beard", () => {
    expect(defaultBodyHairCoverage("legs", 85)).toBeLessThan(defaultBodyHairCoverage("legs", 50));
    expect(defaultBodyHairCoverage("face", 85)).toBe(defaultBodyHairCoverage("face", 50));
  });

  it("scales by the recipe's legacy multiplier, clamped to full coverage and to the multiplier's range", () => {
    const legacy = (age: number, g: BodyHairGroup, m: number) =>
      bodyHairCoverage(g, input(age, { density: { [g]: m } }));
    const base = bodyHairCoverage("chest", input(40));
    expect(legacy(40, "chest", 0.5)).toBeCloseTo(base * 0.5);
    expect(legacy(40, "chest", 0)).toBe(0);
    expect(legacy(40, "face", 9)).toBe(1);
    // A multiplier never conjures hair before puberty.
    expect(legacy(8, "chest", 2)).toBe(0);
    // Chest and back have a nonzero default for every figure, so the multiplier reaches them.
    expect(legacy(40, "chest", 2)).toBeGreaterThan(0);
    expect(legacy(40, "back", 2)).toBeGreaterThan(0);
  });

  it("gives an adult exactly the explicit coverage asked for: no maturation or senescence factor", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BODY_HAIR_GROUPS),
        fc.double({ min: 18, max: 90, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (g, age, c) => {
          expect(explicit(age, g, c)).toBeCloseTo(c, 12);
        },
      ),
    );
    // The two the issue measured at 30: back reached only .42 and chest .84.
    expect(explicit(30, "back", 1)).toBe(1);
    expect(explicit(30, "chest", 1)).toBe(1);
    // An unvalidated control that is not a number fails closed.
    expect(explicit(30, "chest", Number.NaN)).toBe(0);
  });

  it("responds to explicit coverage without a plateau: every step is distinct up to full", () => {
    const steps = [0, 0.25, 0.5, 0.75, 0.85, 0.95, 1];
    for (const g of BODY_HAIR_GROUPS) {
      const out = steps.map((c) => explicit(30, g, c));
      for (let i = 1; i < out.length; i++)
        expect(out[i] as number).toBeGreaterThan(out[i - 1] as number);
    }
  });

  it("brings an explicit coverage in over the group's puberty onset, complete at 18", () => {
    expect(explicit(8, "chest", 0.6)).toBe(0);
    expect(explicit(14, "chest", 0.6)).toBe(0);
    expect(explicit(16, "chest", 0.6)).toBeGreaterThan(0);
    expect(explicit(16, "chest", 0.6)).toBeLessThan(0.6);
    expect(explicit(18, "chest", 0.6)).toBeCloseTo(0.6, 12);
    // A group whose onset is the adult line comes in at it.
    expect(explicit(17.9, "back", 0.5)).toBe(0);
    expect(explicit(18, "back", 0.5)).toBeCloseTo(0.5, 12);
  });

  it("changes follicle spacing without changing regional coverage", () => {
    const baseline = input(35, { coverage: { chest: 0.6 } });
    const dense = input(35, { coverage: { chest: 0.6 }, follicleDensity: { chest: 2 } });
    expect(bodyHairCoverage("chest", dense)).toBeCloseTo(bodyHairCoverage("chest", baseline));
    expect(bodyHairFollicleDensity("chest", dense)).toBeCloseTo(
      bodyHairFollicleDensity("chest", baseline) * 2,
    );
  });
});

describe("the adult-only groups", () => {
  it("are zero for any figure under 18, whatever the control", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ADULT_ONLY_BODY_HAIR),
        fc.double({ min: 1, max: 17.999, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (g, age, m) => {
          expect(bodyHairCoverage(g, input(age, { density: { [g]: m } }))).toBe(0);
          expect(explicit(age, g, Math.min(1, m))).toBe(0);
        },
      ),
    );
  });

  it("fail closed on an age that is not a number", () => {
    for (const g of ADULT_ONLY_BODY_HAIR) {
      expect(defaultBodyHairCoverage(g, Number.NaN)).toBe(0);
      expect(defaultBodyHairCoverage(g, Number.POSITIVE_INFINITY)).toBeGreaterThanOrEqual(0);
      expect(explicit(Number.NaN, g, 1)).toBe(0);
    }
  });

  it("are present for every adult", () => {
    for (const g of ADULT_ONLY_BODY_HAIR)
      expect(bodyHairCoverage(g, input(18))).toBeGreaterThan(0.5);
  });
});

describe("beard style", () => {
  it("defaults to clean-shaven, the neutral recipe, at any age", () => {
    expect(DEFAULT_BEARD).toBe("none");
    for (const age of [30, 10]) expect(beardStyle(input(age))).toBe("none");
  });

  it("keeps the recipe's style", () => {
    expect(beardStyle(input(30, { beard: "full" }))).toBe("full");
  });
});

describe("body hair colour", () => {
  it("is darker on the face and pubis than on the limbs", () => {
    const i = input(30);
    expect(bodyHairColour("face", i).eumelanin).toBeGreaterThan(
      bodyHairColour("arms", i).eumelanin,
    );
    expect(bodyHairColour("pubic", i).eumelanin).toBeGreaterThan(
      bodyHairColour("legs", i).eumelanin,
    );
  });

  it("greys with age, the body later than the beard", () => {
    expect(ageGrey(30)).toBe(0);
    expect(ageGrey(55)).toBeGreaterThan(0.2);
    expect(ageGrey(55)).toBeLessThan(0.32);
    const old = input(65);
    expect(bodyHairColour("face", old).grey).toBeGreaterThan(bodyHairColour("chest", old).grey);
    expect(bodyHairColour("chest", old).grey).toBeGreaterThan(bodyHairColour("pubic", old).grey);
  });

  it("keeps the recipe's grey as a floor and its override as given", () => {
    const scalp = HAIR_COLOURS.grey as HairColour;
    expect(bodyHairColour("legs", input(20, undefined, scalp)).grey).toBeCloseTo(scalp.grey);
    const dyed = input(20, undefined, {
      eumelanin: 0,
      pheomelanin: 0,
      grey: 0,
      override: [0.1, 0.2, 0.9],
    });
    expect(bodyHairColour("chest", dyed).override).toEqual([0.1, 0.2, 0.9]);
  });
});
