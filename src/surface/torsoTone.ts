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

/**
 * The body mass index the figure's own mesh has, by weight macro and sex: the
 * body group's volume at the density of the body (1010 kg/m³) over its height
 * squared, measured on the base mesh at 25 years and the middle height
 * (`tests/torsoTone.test.ts` measures it again, so these cannot drift). The
 * weight macro has no stated index; this is what its extremes weigh. A slim
 * default (19.2 in a woman, 21.4 in a man), and at the macro's top a woman is
 * still within the healthy range (21.9): the mesh does not model obesity.
 */
const BMI_FEMALE = [16.1, 21.9] as const;
const BMI_MALE = [19.4, 23.4] as const;

export function figureBmi(b: Pick<FigureBuild, "weight" | "gender">): number {
  const w = clamp(b.weight);
  const f = mix(BMI_FEMALE[0], BMI_FEMALE[1], w);
  const m = mix(BMI_MALE[0], BMI_MALE[1], w);
  return mix(f, m, clamp(b.gender));
}

/**
 * Body fat as a percentage of weight from the index, sex and age, Gallagher et
 * al. 2000 (Am J Clin Nutr 72:694, the equation for all subjects without the
 * ethnic terms: standard error 2.8 to 5.4 points): 64.5 − 848/BMI + 0.079 age
 * − 16.4 sex + 0.05 sex age + 39 sex/BMI, sex 1 for a man and 0 for a woman
 * (taken continuously from the gender macro). Fitted on adults of BMI up to
 * 35; a child takes the age of 18, a choice (the equation does not reach them).
 */
export function bodyFatPercent(bmi: number, b: Pick<FigureBuild, "gender" | "age">): number {
  const sex = clamp(b.gender);
  const age = Math.max(18, b.age);
  return 64.5 - 848 / bmi + 0.079 * age - 16.4 * sex + 0.05 * sex * age + (39 * sex) / bmi;
}

/** The figure's body fat, percent: `bodyFatPercent` of its own index. */
export const figureBodyFat = (b: FigureBuild): number => bodyFatPercent(figureBmi(b), b);

/**
 * How much a bone shows through the skin at a body fat, 1 at `[full]` percent
 * and below, 0 at `[none]` and above, a smoothstep between; the thresholds are
 * by sex (the gender macro interpolates them). Choices from where the bones
 * are said to show: the collarbones in most people but those with the most
 * fat over them, the ribs only in the leanest (men under about 10 to 12% and
 * women under about 18 to 20%: fitness-science lore, not measurement; essential
 * fat is 2 to 5% in men and 10 to 13% in women).
 */
function showsAt(
  fat: number,
  gender: number,
  female: readonly [number, number],
  male: readonly [number, number],
) {
  const none = mix(female[0], male[0], clamp(gender));
  const full = mix(female[1], male[1], clamp(gender));
  return 1 - smoothstep(full, none, fat);
}

/** [none, full] body fat for the collarbones, percent: woman, man. */
export const CLAVICLE_VISIBLE_FAT = { female: [30, 18], male: [22, 10] } as const;
/** [none, full] body fat for the ribs, percent: woman, man. */
export const RIB_VISIBLE_FAT = { female: [21, 13], male: [13, 7] } as const;

/** How plainly the collarbones show on this figure, 0..1. */
export const clavicleDefinition = (b: FigureBuild): number =>
  showsAt(figureBodyFat(b), b.gender, CLAVICLE_VISIBLE_FAT.female, CLAVICLE_VISIBLE_FAT.male);

/** How plainly the ribs show on this figure, 0..1. */
export const ribDefinition = (b: FigureBuild): number =>
  showsAt(figureBodyFat(b), b.gender, RIB_VISIBLE_FAT.female, RIB_VISIBLE_FAT.male);
