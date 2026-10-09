import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ADULT_ONLY_BODY_HAIR,
  ageGrey,
  BODY_HAIR_GROUPS,
  type BodyHairInput,
  beardStyle,
  bodyHairColour,
  bodyHairCoverage,
  defaultBodyHairCoverage,
} from "../src/surface/bodyHair.ts";
import { DEFAULT_HAIR_COLOUR, HAIR_COLOURS, type HairColour } from "../src/surface/hairTone.ts";

const input = (age: number, gender: number, extra: Partial<BodyHairInput> = {}): BodyHairInput => ({
  age,
  gender,
  colour: DEFAULT_HAIR_COLOUR,
  ...extra,
});
const TERMINAL = BODY_HAIR_GROUPS.filter((g) => !ADULT_ONLY_BODY_HAIR.includes(g));

describe("body hair coverage", () => {
  it("is zero everywhere before puberty, at either end of the androgen axis", () => {
    for (const g of BODY_HAIR_GROUPS)
      for (const gender of [0, 0.5, 1]) expect(defaultBodyHairCoverage(g, 8, gender)).toBe(0);
  });

  it("rises through adolescence and is fuller in a young adult than a teenager", () => {
    for (const g of TERMINAL) {
      const teen = defaultBodyHairCoverage(g, 15, 1);
      const adult = defaultBodyHairCoverage(g, 30, 1);
      expect(adult).toBeGreaterThanOrEqual(teen);
    }
    expect(defaultBodyHairCoverage("face", 16, 1)).toBeGreaterThan(0);
    expect(defaultBodyHairCoverage("legs", 14, 0)).toBeGreaterThan(0);
  });

  it("grows with the androgen axis in every group at every age", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BODY_HAIR_GROUPS),
        fc.double({ min: 1, max: 90, noNaN: true }),
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        (g, age, a) => {
          expect(defaultBodyHairCoverage(g, age, a + 0.01)).toBeGreaterThanOrEqual(
            defaultBodyHairCoverage(g, age, a),
          );
        },
      ),
    );
  });

  it("gives an adult man a beard and chest hair, and an adult woman neither", () => {
    expect(defaultBodyHairCoverage("face", 35, 1)).toBeGreaterThan(0.9);
    expect(defaultBodyHairCoverage("chest", 35, 1)).toBeGreaterThan(0.4);
    expect(defaultBodyHairCoverage("face", 35, 0)).toBeLessThan(0.15);
    expect(defaultBodyHairCoverage("chest", 35, 0)).toBe(0);
    // Both carry leg hair, unshaved.
    expect(defaultBodyHairCoverage("legs", 35, 0)).toBeGreaterThan(0.4);
  });

  it("thins on the body in old age and keeps the beard", () => {
    expect(defaultBodyHairCoverage("legs", 85, 1)).toBeLessThan(
      defaultBodyHairCoverage("legs", 50, 1),
    );
    expect(defaultBodyHairCoverage("face", 85, 1)).toBe(defaultBodyHairCoverage("face", 50, 1));
  });

  it("scales by the recipe's multiplier, clamped to full coverage and to the multiplier's range", () => {
    const base = bodyHairCoverage("chest", input(40, 1));
    expect(
      bodyHairCoverage("chest", input(40, 1, { bodyHair: { density: { chest: 0.5 } } })),
    ).toBeCloseTo(base * 0.5);
    expect(bodyHairCoverage("chest", input(40, 1, { bodyHair: { density: { chest: 0 } } }))).toBe(
      0,
    );
    expect(bodyHairCoverage("face", input(40, 1, { bodyHair: { density: { face: 9 } } }))).toBe(1);
    // A multiplier never conjures hair where the default has none.
    expect(bodyHairCoverage("chest", input(8, 1, { bodyHair: { density: { chest: 2 } } }))).toBe(0);
  });
});

describe("the adult-only groups", () => {
  it("are zero for any figure under 18, whatever the multiplier", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ADULT_ONLY_BODY_HAIR),
        fc.double({ min: 1, max: 17.999, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (g, age, gender, m) => {
          expect(
            bodyHairCoverage(g, input(age, gender, { bodyHair: { density: { [g]: m } } })),
          ).toBe(0);
        },
      ),
    );
  });

  it("fail closed on an age that is not a number", () => {
    for (const g of ADULT_ONLY_BODY_HAIR) {
      expect(defaultBodyHairCoverage(g, Number.NaN, 1)).toBe(0);
      expect(defaultBodyHairCoverage(g, Number.POSITIVE_INFINITY, 1)).toBeGreaterThanOrEqual(0);
    }
  });

  it("are present for an adult at either end of the androgen axis", () => {
    for (const g of ADULT_ONLY_BODY_HAIR)
      for (const gender of [0, 1])
        expect(defaultBodyHairCoverage(g, 18, gender)).toBeGreaterThan(0.5);
  });
});

describe("beard style", () => {
  it("defaults to stubble where the face carries terminal hair, none elsewhere", () => {
    expect(beardStyle(input(30, 1))).toBe("stubble");
    expect(beardStyle(input(30, 0))).toBe("none");
    expect(beardStyle(input(10, 1))).toBe("none");
  });

  it("keeps the recipe's style", () => {
    expect(beardStyle(input(30, 0, { bodyHair: { beard: "full" } }))).toBe("full");
  });
});

describe("body hair colour", () => {
  it("is darker on the face and pubis than on the limbs", () => {
    const i = input(30, 1);
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
    const old = input(65, 1);
    expect(bodyHairColour("face", old).grey).toBeGreaterThan(bodyHairColour("chest", old).grey);
    expect(bodyHairColour("chest", old).grey).toBeGreaterThan(bodyHairColour("pubic", old).grey);
  });

  it("keeps the recipe's grey as a floor and its override as given", () => {
    const scalp = HAIR_COLOURS.grey as HairColour;
    expect(bodyHairColour("legs", input(20, 1, { colour: scalp })).grey).toBeCloseTo(scalp.grey);
    const dyed = input(20, 1, {
      colour: { eumelanin: 0, pheomelanin: 0, grey: 0, override: [0.1, 0.2, 0.9] },
    });
    expect(bodyHairColour("chest", dyed).override).toEqual([0.1, 0.2, 0.9]);
  });
});
