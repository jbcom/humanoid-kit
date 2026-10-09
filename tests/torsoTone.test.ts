import { describe, expect, it } from "vitest";
import {
  AREOLA_RADIUS_ADULT_FEMALE,
  AREOLA_RADIUS_ADULT_MALE,
  areolaRadius,
  NIPPLE_CONTRAST_FEMALE,
  NIPPLE_CONTRAST_MALE,
  nippleContrast,
  nippleRadius,
  pubertyProgress,
} from "../src/surface/torsoTone.ts";

const FEMALE = 0;
const MALE = 1;

describe("pubertyProgress", () => {
  it("runs from 0 in a young child to 1 in an adult, and never falls with age", () => {
    for (const gender of [FEMALE, 0.5, MALE]) {
      expect(pubertyProgress(5, gender)).toBe(0);
      expect(pubertyProgress(25, gender)).toBe(1);
      let last = -1;
      for (let age = 0; age <= 40; age += 0.25) {
        const p = pubertyProgress(age, gender);
        expect(p).toBeGreaterThanOrEqual(last);
        last = p;
      }
    }
  });

  it("starts earlier in girls than in boys", () => {
    for (const age of [10, 11, 12, 13, 14]) {
      expect(pubertyProgress(age, FEMALE)).toBeGreaterThan(pubertyProgress(age, MALE));
    }
  });

  it("is half way through in the early teens", () => {
    expect(pubertyProgress(12.5, FEMALE)).toBeGreaterThan(0.35);
    expect(pubertyProgress(12.5, FEMALE)).toBeLessThan(0.65);
  });
});

describe("areolaRadius", () => {
  it("is the measured adult radius: 38.1 mm across in women, 28.0 in men", () => {
    expect(areolaRadius(30, FEMALE, 0.5)).toBeCloseTo(AREOLA_RADIUS_ADULT_FEMALE, 6);
    expect(areolaRadius(30, MALE, 0.5)).toBeCloseTo(AREOLA_RADIUS_ADULT_MALE, 6);
    expect(AREOLA_RADIUS_ADULT_FEMALE * 2).toBeCloseTo(0.0381, 4);
    expect(AREOLA_RADIUS_ADULT_MALE * 2).toBeCloseTo(0.028, 4);
  });

  it("is smaller before puberty and grows through it", () => {
    const child = areolaRadius(6, FEMALE, 0.5);
    const teen = areolaRadius(12.5, FEMALE, 0.5);
    const adult = areolaRadius(25, FEMALE, 0.5);
    expect(child).toBeLessThan(teen);
    expect(teen).toBeLessThan(adult);
    expect(child).toBeLessThan(0.6 * adult);
  });

  it("is larger on a larger breast, in women", () => {
    expect(areolaRadius(30, FEMALE, 1)).toBeGreaterThan(areolaRadius(30, FEMALE, 0.5));
    expect(areolaRadius(30, FEMALE, 0)).toBeLessThan(areolaRadius(30, FEMALE, 0.5));
    // A man's chest has no breast to scale it.
    expect(areolaRadius(30, MALE, 1)).toBeCloseTo(areolaRadius(30, MALE, 0), 9);
  });
});

describe("nippleRadius", () => {
  it("grows through puberty and is larger on a woman's breast", () => {
    expect(nippleRadius(6, FEMALE)).toBeLessThan(nippleRadius(12.5, FEMALE));
    expect(nippleRadius(12.5, FEMALE)).toBeLessThan(nippleRadius(25, FEMALE));
    expect(nippleRadius(25, FEMALE)).toBeGreaterThan(nippleRadius(25, MALE));
    // The nipple sits inside the areola at every age.
    for (const age of [4, 9, 13, 18, 40])
      for (const g of [FEMALE, MALE])
        expect(nippleRadius(age, g)).toBeLessThan(0.5 * areolaRadius(age, g, 0.5));
  });
});

describe("nippleContrast", () => {
  it("is darker than the areola in women and a little lighter in men, after puberty", () => {
    expect(nippleContrast(30, FEMALE)).toBeCloseTo(NIPPLE_CONTRAST_FEMALE, 9);
    expect(nippleContrast(30, MALE)).toBeCloseTo(NIPPLE_CONTRAST_MALE, 9);
    expect(NIPPLE_CONTRAST_FEMALE).toBeLessThan(1);
    expect(NIPPLE_CONTRAST_MALE).toBeGreaterThan(1);
  });

  it("is none in a child, whose nipple is the areola's colour", () => {
    expect(nippleContrast(5, FEMALE)).toBe(1);
    expect(nippleContrast(5, MALE)).toBe(1);
  });
});
