/**
 * What the torso's skin layers take from the figure: how far through puberty
 * the chest is, how large the nipple and areola are, how they differ in colour.
 * Pure functions of the macros, so each is tested in Node; each constant names
 * its source in docs/research/SKIN-STATES.md (C7) or is marked a CHOICE there.
 */

/** The macros the torso's layers read (`MacroValues`: gender 0 is female, 1 male; age in years). */
export interface FigureBuild {
  gender: number;
  age: number;
  weight: number;
  height: number;
  muscle: number;
  breastSize: number;
}

/** The default macros (`DEFAULT_MACROS`): what a layer paints for when an input gives no build. */
export const DEFAULT_BUILD: Readonly<FigureBuild> = {
  gender: 0.5,
  age: 25,
  weight: 0.5,
  height: 0.5,
  muscle: 0.5,
  breastSize: 0.5,
};

/** A paint input's build, with the default macros where it gives none. */
export function figureBuild(input: {
  age?: number;
  build?: Partial<Omit<FigureBuild, "age">>;
}): FigureBuild {
  return { ...DEFAULT_BUILD, ...input.build, age: input.age ?? DEFAULT_BUILD.age };
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = clamp((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * How far the chest's skin is through puberty, 0 (a child) to 1 (mature): the
 * years over which the breast and its areola develop, Tanner stages B1 to B5
 * in girls (the first stage's mean age near 10 in recent samples, the last
 * near 15) and the nipple and areola's own growth in boys, about a year and a
 * half later. A CHOICE of ramp (a smoothstep over the span of those means),
 * between the measured ages.
 */
export function pubertyProgress(age: number, gender: number): number {
  const g = clamp(gender);
  return smoothstep(mix(8.5, 10.5, g), mix(16, 17.5, g), age);
}

/** Areola diameter in an adult: 38.1 mm in women, 28.0 in men (Wikipedia "Areola", citing the literature). */
export const AREOLA_RADIUS_ADULT_FEMALE = 0.0381 / 2;
export const AREOLA_RADIUS_ADULT_MALE = 0.028 / 2;
/** A child's areola radius before puberty, metres (CHOICE: 13 mm across; none measured was found). */
export const AREOLA_RADIUS_CHILD = 0.0065;
/** How much a breast at the ends of the size macro scales the areola, either way (CHOICE). */
export const AREOLA_BREAST_SCALE = 0.15;

/**
 * The areola's radius, metres: a child's, grown through puberty to the adult's
 * by sex, and in women scaled by the breast's size (the areola grows with the
 * breast; a man's chest has no breast to scale it).
 */
export function areolaRadius(age: number, gender: number, breastSize: number): number {
  const g = clamp(gender);
  const p = pubertyProgress(age, g);
  const adult = mix(AREOLA_RADIUS_ADULT_FEMALE, AREOLA_RADIUS_ADULT_MALE, g);
  const scale = 1 + AREOLA_BREAST_SCALE * 2 * (clamp(breastSize) - 0.5) * (1 - g);
  return mix(AREOLA_RADIUS_CHILD, adult * scale, p);
}

/**
 * The nipple's radius, metres. Its diameter by Tanner stage in 230 girls was
 * 1.8 mm (B1), 4.2 (B2), 5.9 (B3), 7.1 (B4) (Hacettepe study, SKIN-STATES.md C7);
 * a grown woman's is about 8 mm across, a man's about 5 (CHOICE for both
 * adult values, which that study does not reach).
 */
export function nippleRadius(age: number, gender: number): number {
  const g = clamp(gender);
  const p = pubertyProgress(age, g);
  return mix(0.0009, mix(0.004, 0.0025, g), p);
}

/**
 * The nipple's colour as a multiple of the areola's. In 30 nulliparous women
 * the nipple was darker than the areola by 29.4 to 31.9 grey levels of 255; in
 * 30 men it was lighter, by 3.8 to 7.8 (Motosko et al. 2019, SKIN-STATES.md A4,
 * C7). Taking an areola near 170 grey, those are the ratios below.
 */
export const NIPPLE_CONTRAST_FEMALE = 0.84;
export const NIPPLE_CONTRAST_MALE = 1.03;

/** The contrast at an age: none in a child, whose nipple has not yet pigmented apart. */
export function nippleContrast(age: number, gender: number): number {
  const g = clamp(gender);
  const p = pubertyProgress(age, g);
  return 1 + (mix(NIPPLE_CONTRAST_FEMALE, NIPPLE_CONTRAST_MALE, g) - 1) * p;
}
