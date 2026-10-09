import { describe, expect, it } from "vitest";
import { groupFaces } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  AREOLA_RADIUS_ADULT_FEMALE,
  AREOLA_RADIUS_ADULT_MALE,
  abdominalDefinition,
  areolaRadius,
  bodyFatPercent,
  clavicleDefinition,
  type FigureBuild,
  figureBmi,
  lineaNigraStrength,
  NIPPLE_CONTRAST_FEMALE,
  NIPPLE_CONTRAST_MALE,
  nippleContrast,
  nippleRadius,
  pubertyProgress,
  ribDefinition,
} from "../src/surface/torsoTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

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

describe("the figure's body fat", () => {
  const build = (over: Partial<FigureBuild> = {}): FigureBuild => ({
    gender: 0,
    age: 25,
    weight: 0.5,
    height: 0.5,
    muscle: 0.5,
    breastSize: 0.5,
    ...over,
  });

  it("is Gallagher's equation of the body mass index, sex and age", () => {
    // Female, 25 years, BMI 22: 64.5 - 848 / 22 + 0.079 * 25.
    expect(bodyFatPercent(22, build())).toBeCloseTo(64.5 - 848 / 22 + 0.079 * 25, 6);
    // Male: the sex terms of the equation, -16.4 + 0.05 * age + 39 / BMI.
    expect(bodyFatPercent(22, build({ gender: 1 }))).toBeCloseTo(
      64.5 - 848 / 22 + 0.079 * 25 - 16.4 + 0.05 * 25 + 39 / 22,
      6,
    );
    // A man has less fat than a woman of the same index, and more index is more fat.
    expect(bodyFatPercent(22, build({ gender: 1 }))).toBeLessThan(bodyFatPercent(22, build()));
    expect(bodyFatPercent(26, build())).toBeGreaterThan(bodyFatPercent(22, build()));
  });

  it("takes a child as the equation's youngest adult", () => {
    expect(bodyFatPercent(20, build({ age: 8 }))).toBeCloseTo(
      bodyFatPercent(20, build({ age: 18 })),
      9,
    );
  });

  it("gives the figure the index its own volume has", () => {
    // Measured: the body mesh's volume at 1010 kg/m3 over its height squared.
    expect(figureBmi(build({ weight: 0, gender: 0 }))).toBeCloseTo(16.1, 0);
    expect(figureBmi(build({ weight: 0.5, gender: 0 }))).toBeCloseTo(19.2, 0);
    expect(figureBmi(build({ weight: 1, gender: 0 }))).toBeCloseTo(21.9, 0);
    expect(figureBmi(build({ weight: 0, gender: 1 }))).toBeCloseTo(19.4, 0);
    expect(figureBmi(build({ weight: 1, gender: 1 }))).toBeCloseTo(23.4, 0);
  });

  it("measures that index off the mesh, so the constants cannot drift from it", () => {
    const assets = loadFixtureAssets();
    const model = new HumanoidModel(assets, { subdivision: 0 });
    const faces = groupFaces(assets, "body");
    for (const [gender, weight] of [
      [0, 0],
      [0, 1],
      [1, 0.5],
    ] as const) {
      const P = model.evaluate(createRecipe({ macros: { gender, weight, age: 25 } })).control;
      let volume = 0;
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      const tri = (a: number, b: number, c: number) => {
        const [ax, ay, az] = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]] as number[];
        const [bx, by, bz] = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]] as number[];
        const [cx, cy, cz] = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]] as number[];
        volume +=
          ((ax as number) * ((by as number) * (cz as number) - (bz as number) * (cy as number)) -
            (ay as number) * ((bx as number) * (cz as number) - (bz as number) * (cx as number)) +
            (az as number) * ((bx as number) * (cy as number) - (by as number) * (cx as number))) /
          6;
      };
      for (const f of faces) {
        const v = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
        tri(v[0] as number, v[1] as number, v[2] as number);
        tri(v[0] as number, v[2] as number, v[3] as number);
        for (const x of v) {
          lo = Math.min(lo, P[x * 3 + 1] as number);
          hi = Math.max(hi, P[x * 3 + 1] as number);
        }
      }
      const bmi = (Math.abs(volume) * 1010) / (hi - lo) ** 2;
      expect(figureBmi(build({ gender, weight })), `gender ${gender} weight ${weight}`).toBeCloseTo(
        bmi,
        0,
      );
    }
  });
});

describe("how much the bones show", () => {
  const build = (over: Partial<FigureBuild> = {}): FigureBuild => ({
    gender: 0,
    age: 25,
    weight: 0.5,
    height: 0.5,
    muscle: 0.5,
    breastSize: 0.5,
    ...over,
  });

  it("shows ribs on a lean figure only, collarbones on most, and neither on a heavy one", () => {
    // A slim default woman: collarbones plain, ribs not.
    expect(ribDefinition(build())).toBe(0);
    expect(clavicleDefinition(build())).toBeGreaterThan(0.4);
    // The thinnest figure: both.
    expect(ribDefinition(build({ weight: 0 }))).toBeGreaterThan(0.9);
    expect(clavicleDefinition(build({ weight: 0 }))).toBeGreaterThan(0.95);
    // The heaviest: faint collarbones, no ribs.
    expect(ribDefinition(build({ weight: 1 }))).toBe(0);
    expect(clavicleDefinition(build({ weight: 1 }))).toBeLessThan(0.3);
  });

  it("falls with weight and shows more on a man at the same weight", () => {
    for (const f of [clavicleDefinition, ribDefinition]) {
      let last = 2;
      for (let w = 0; w <= 1.001; w += 0.1) {
        const d = f(build({ weight: w }));
        expect(d).toBeLessThanOrEqual(last + 1e-9);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
        last = d;
      }
    }
    // At the same weight a man is leaner (less fat for his index), so his collarbones show more.
    expect(clavicleDefinition(build({ gender: 1, weight: 0.8 }))).toBeGreaterThan(
      clavicleDefinition(build({ weight: 0.8 })),
    );
  });
});

describe("the midline of the abdomen", () => {
  const build = (over: Partial<FigureBuild> = {}): FigureBuild => ({
    gender: 0,
    age: 25,
    weight: 0.5,
    height: 0.5,
    muscle: 0.5,
    breastSize: 0.5,
    ...over,
  });

  it("shows the linea alba's furrow on a lean, muscular figure and not on a heavy one", () => {
    expect(abdominalDefinition(build({ gender: 1, weight: 0, muscle: 0.8 }))).toBeGreaterThan(0.9);
    expect(abdominalDefinition(build({ weight: 1 }))).toBe(0);
    // Muscle deepens it.
    expect(abdominalDefinition(build({ gender: 1, weight: 0.4, muscle: 1 }))).toBeGreaterThan(
      abdominalDefinition(build({ gender: 1, weight: 0.4, muscle: 0 })),
    );
    for (let w = 0; w <= 1.001; w += 0.1) {
      const d = abdominalDefinition(build({ weight: w }));
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it("paints the linea nigra faintly at rest, after puberty only", () => {
    expect(lineaNigraStrength(build({ age: 5 }))).toBe(0);
    expect(lineaNigraStrength(build())).toBeGreaterThan(0);
    expect(lineaNigraStrength(build())).toBeLessThan(0.3);
    expect(lineaNigraStrength(build({ age: 12.5 }))).toBeLessThan(lineaNigraStrength(build()));
    // The same line for either sex: it is found in men too.
    expect(lineaNigraStrength(build({ gender: 1 }))).toBeGreaterThan(0);
  });
});
