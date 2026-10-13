import { describe, expect, it } from "vitest";
import { BEARD_SHAPES, beardCoverage, resolveBeard } from "../src/surface/beard.ts";
import {
  BEARD_STYLES,
  type BodyHairRecipe,
  bodyHairCoverage,
  MAX_BEARD_VOLUME,
} from "../src/surface/bodyHair.ts";
import { DEFAULT_HAIR_COLOUR } from "../src/surface/hairTone.ts";
import { BEARD_LENGTHS } from "../src/surface/regions/bodyHairCoat.ts";

/** A standing adult's chin, metres above the floor. */
const CHIN = 1.45;

describe("beard shapes", () => {
  it("give every style a shape whose grown parts are the coat's", () => {
    for (const style of BEARD_STYLES) {
      const shape = BEARD_SHAPES[style];
      expect(shape, style).toBeDefined();
      for (const part of ["moustache", "chin", "cheeks"] as const)
        expect(shape.parts[part] > 0, `${style} ${part}`).toBe(BEARD_LENGTHS[style][part] > 0);
    }
  });

  it("keep the short styles short and grow the long ones to the chest", () => {
    expect(BEARD_SHAPES.none.length).toBe(0);
    expect(BEARD_SHAPES.stubble.length).toBeLessThan(0.003);
    expect(BEARD_SHAPES.full.length).toBeLessThan(0.06);
    expect(BEARD_SHAPES.forked.length).toBeGreaterThan(0.12);
    expect(BEARD_SHAPES.forked.fork).toBeGreaterThan(0.5);
    expect(BEARD_SHAPES.longstreet.length).toBeGreaterThan(0.25);
    expect(BEARD_SHAPES.full.fork).toBe(0);
  });
});

describe("resolving a recipe's beard", () => {
  it("is the style's defaults when the recipe names only the style", () => {
    const named = resolveBeard({ bodyHair: { beard: "forked" } }, CHIN);
    const spec = resolveBeard({ bodyHair: { beard: { style: "forked" } } }, CHIN);
    expect(named).toEqual(spec);
    expect(named.length).toBe(BEARD_SHAPES.forked.length);
    expect(named.volume).toBe(1);
    expect(named.grey).toBe(0);
    expect(named.fork).toBe(BEARD_SHAPES.forked.fork);
  });

  it("is clean-shaven with no recipe beard", () => {
    const b = resolveBeard({}, CHIN);
    expect(b.style).toBe("none");
    expect(b.length).toBe(0);
  });

  it("scales each part's length with the longest part's", () => {
    const short = resolveBeard({ bodyHair: { beard: "full" } }, CHIN);
    const long = resolveBeard({ bodyHair: { beard: { style: "full", length: 0.3 } } }, CHIN);
    expect(long.length).toBe(0.3);
    const longest = Math.max(...Object.values(long.parts));
    expect(longest).toBeCloseTo(0.3, 9);
    for (const part of ["moustache", "chin", "cheeks"] as const)
      expect(long.parts[part] / long.length).toBeCloseTo(short.parts[part] / short.length, 9);
  });

  it("never grows past the floor (the chin's height), nor goes negative", () => {
    expect(
      resolveBeard({ bodyHair: { beard: { style: "longstreet", length: 9 } } }, CHIN).length,
    ).toBe(CHIN);
    expect(resolveBeard({ bodyHair: { beard: { style: "full", length: -1 } } }, CHIN).length).toBe(
      0,
    );
  });

  it("clamps the other controls to their ranges", () => {
    const b = resolveBeard(
      { bodyHair: { beard: { style: "full", volume: 5, grey: 2, fork: -1, part: 0.5 } } },
      CHIN,
    );
    expect(b.volume).toBe(MAX_BEARD_VOLUME);
    expect(b.grey).toBe(1);
    expect(b.fork).toBe(0);
    expect(b.part).toBe(0.5);
  });
});

describe("how much of a chosen beard grows", () => {
  const colour = DEFAULT_HAIR_COLOUR;
  const at = (age: number, gender: number, bodyHair: BodyHairRecipe) =>
    beardCoverage({ age, gender, colour, bodyHair });

  it("is all of it on any adult, whatever the gender", () => {
    for (const gender of [0, 0.5, 1])
      expect(at(30, gender, { beard: "full" }), `${gender}`).toBe(1);
  });

  it("is none for a clean-shaven face, and none before the face's hair comes in", () => {
    expect(at(30, 1, { beard: "none" })).toBe(0);
    expect(at(30, 1, {})).toBe(0);
    expect(at(10, 1, { beard: "full" })).toBe(0);
    expect(at(18, 0, { beard: "full" })).toBeGreaterThan(0);
  });

  it("follows the recipe's own face coverage or density when it sets one", () => {
    const input = (bodyHair: BodyHairRecipe) => ({ age: 30, gender: 0, colour, bodyHair });
    const set = { beard: "full", coverage: { face: 0.4 } } as const;
    expect(at(30, 0, set)).toBeCloseTo(bodyHairCoverage("face", input(set)), 9);
    const legacy = { beard: "full", density: { face: 2 } } as const;
    expect(at(30, 0, legacy)).toBeCloseTo(bodyHairCoverage("face", input(legacy)), 9);
  });
});
