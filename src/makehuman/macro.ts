/**
 * MakeHuman-compatible macro interpolation.
 *
 * Macro targets are combinatorial: each file name lists one anchor per macro
 * axis (`african-male-young`, `universal-female-old-maxmuscle-minweight`, ...),
 * and a target's weight is the product of its anchors' weights. Each axis is
 * linear interpolation between its anchors, so one axis's weights sum to 1.
 *
 * The age axis is MakeHuman's own, at every age: baby at 1 year, child at 10,
 * its one adult body (`young` in its files) at 25 and old at 90, linear between
 * neighbours, so a figure of 18 is about 47% child. `ADULT_AGE` gates content,
 * never the body's shape. See docs/AGE-POLICY.md.
 */

export type Anchor = string;
export type AxisWeights = ReadonlyArray<readonly [Anchor, number]>;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Two-sided axis: `lo` at 0, `mid` at 0.5, `hi` at 1. */
function threeAnchor(v: number, lo: Anchor, mid: Anchor, hi: Anchor): AxisWeights {
  const x = clamp01(v);
  if (x < 0.5)
    return [
      [lo, 1 - x * 2],
      [mid, x * 2],
    ];
  return [
    [mid, 1 - (x - 0.5) * 2],
    [hi, (x - 0.5) * 2],
  ];
}

/** 0 = MakeHuman's female anchor, 1 = its male anchor. */
export const genderAxis = (gender: number): AxisWeights => {
  const x = clamp01(gender);
  return [
    ["female", 1 - x],
    ["male", x],
  ];
};

/** Adult-only controls and packs apply from this age. See `recipe/agePolicy.ts`. */
export const ADULT_AGE = 18;

/**
 * Whether an age is an adult's: a finite number of `ADULT_AGE` or more. The one
 * place an age is compared to the line, so NaN, a missing or non-numeric age, a
 * negative age and Infinity are all not adult, wherever the question is asked
 * and whether or not the recipe was validated (docs/AGE-POLICY.md).
 */
export const isAdultAge = (age: unknown): boolean =>
  typeof age === "number" && Number.isFinite(age) && age >= ADULT_AGE;

/**
 * The age bodies at MakeHuman's ages (`human.py`, `_setAgeVals`; its child is at
 * slider 0.1875, 1 + 48 * 0.1875 = 10 years); the axis blends linearly between
 * neighbours. `upstream` is MakeHuman's name for the body in its target files.
 */
export const AGE_ANCHORS = [
  { anchor: "baby", years: 1, upstream: "baby" },
  { anchor: "child", years: 10, upstream: "child" },
  { anchor: "adult", years: 25, upstream: "young" },
  { anchor: "old", years: 90, upstream: "old" },
] as const;
export const MIN_AGE = 1;
export const MAX_AGE = 90;

export type AgeAnchor = (typeof AGE_ANCHORS)[number]["anchor"];
/** MakeHuman's name for an age body, as it appears in target and pack file names. */
export type UpstreamAgeAnchor = (typeof AGE_ANCHORS)[number]["upstream"];

/** Age in years, as weights on the age bodies (`AGE_ANCHORS`). */
export const ageAxis = (years: number): AxisWeights => {
  const y = Math.min(MAX_AGE, Math.max(MIN_AGE, years));
  for (let i = 0; i < AGE_ANCHORS.length; i++) {
    const a = AGE_ANCHORS[i] as (typeof AGE_ANCHORS)[number];
    if (y === a.years) return [[a.anchor, 1]];
    const b = AGE_ANCHORS[i + 1];
    if (b && y < b.years) {
      const t = (y - a.years) / (b.years - a.years);
      return [
        [a.anchor, 1 - t],
        [b.anchor, t],
      ];
    }
  }
  return [["old", 1]];
};

/** MakeHuman's file name for an age body (`adult` → `young`). */
export const upstreamAgeAnchor = (anchor: AgeAnchor): UpstreamAgeAnchor =>
  (AGE_ANCHORS.find((a) => a.anchor === anchor) as (typeof AGE_ANCHORS)[number]).upstream;

/** The age axis in MakeHuman's target-name terms. */
const upstreamAgeAxis = (years: number): AxisWeights =>
  ageAxis(years).map(([anchor, w]) => [upstreamAgeAnchor(anchor as AgeAnchor), w] as const);

export const muscleAxis = (v: number) => threeAnchor(v, "minmuscle", "averagemuscle", "maxmuscle");
export const weightAxis = (v: number) => threeAnchor(v, "minweight", "averageweight", "maxweight");
export const cupAxis = (v: number) => threeAnchor(v, "mincup", "averagecup", "maxcup");
export const firmnessAxis = (v: number) =>
  threeAnchor(v, "minfirmness", "averagefirmness", "maxfirmness");

/** Height has no average target: the base mesh is the average. */
export const heightAxis = (v: number): AxisWeights => {
  const x = clamp01(v);
  return x < 0.5 ? [["minheight", 1 - x * 2]] : [["maxheight", (x - 0.5) * 2]];
};

/** 0 = uncommon, 0.5 = base, 1 = ideal proportions. */
export const proportionAxis = (v: number): AxisWeights => {
  const x = clamp01(v);
  return x < 0.5 ? [["uncommonproportions", 1 - x * 2]] : [["idealproportions", (x - 0.5) * 2]];
};

/** MakeHuman's three ethnic anchors, normalised to sum to 1. */
export function ethnicAxis(african: number, asian: number, caucasian: number): AxisWeights {
  const a = Math.max(0, african);
  const b = Math.max(0, asian);
  const c = Math.max(0, caucasian);
  const s = a + b + c;
  if (s <= 0)
    return [
      ["african", 1 / 3],
      ["asian", 1 / 3],
      ["caucasian", 1 / 3],
    ];
  return [
    ["african", a / s],
    ["asian", b / s],
    ["caucasian", c / s],
  ];
}

/**
 * Cartesian product of axes into `name -> weight`, joining anchors with `-`
 * in axis order after `prefix`. Zero weights are dropped.
 */
export function combine(prefix: string, axes: readonly AxisWeights[]): Map<string, number> {
  let acc: Array<[string, number]> = [[prefix, 1]];
  for (const axis of axes) {
    const next: Array<[string, number]> = [];
    for (const [name, w] of acc) {
      for (const [anchor, aw] of axis) {
        const ww = w * aw;
        if (ww > 0) next.push([name ? `${name}-${anchor}` : anchor, ww]);
      }
    }
    acc = next;
  }
  return new Map(acc);
}

/** MakeHuman's macro variables, in its own terms (ages in years). */
export interface MacroValues {
  gender: number;
  age: number;
  muscle: number;
  weight: number;
  height: number;
  proportions: number;
  african: number;
  asian: number;
  caucasian: number;
  breastSize: number;
  breastFirmness: number;
}

export const DEFAULT_MACROS: Readonly<MacroValues> = {
  gender: 0.5,
  age: 25,
  muscle: 0.5,
  weight: 0.5,
  height: 0.5,
  proportions: 0.5,
  african: 1 / 3,
  asian: 1 / 3,
  caucasian: 1 / 3,
  breastSize: 0.5,
  breastFirmness: 0.5,
};

/** Upstream ships no file for these combinations (the base mesh already is that shape). */
export const isEmptyUpstreamCombination = (name: string) =>
  /universal-.*-averagemuscle-averageweight$/.test(name) ||
  /-averagecup-averagefirmness$/.test(name);

/** Target name → weight for a set of macro values. Names match the packed target names. */
export function macroTargetWeights(m: MacroValues): Map<string, number> {
  const g = genderAxis(m.gender);
  const a = upstreamAgeAxis(m.age);
  const mu = muscleAxis(m.muscle);
  const we = weightAxis(m.weight);
  const out = new Map<string, number>();
  const add = (prefix: string, src: Map<string, number>, k = 1) => {
    for (const [n, w] of src) {
      const name = prefix + n;
      if (!isEmptyUpstreamCombination(name)) out.set(name, (out.get(name) ?? 0) + w * k);
    }
  };
  add("macrodetails/", combine("", [ethnicAxis(m.african, m.asian, m.caucasian), g, a]));
  add("macrodetails/", combine("universal", [g, a, mu, we]));
  // As in MakeHuman, height and proportions are combined over muscle and weight
  // too: a muscular or heavy figure takes the height variant authored for that build.
  add("macrodetails/height/", combine("", [g, a, mu, we, heightAxis(m.height)]));
  // Upstream ships no baby proportion targets, so proportions do not apply at the baby anchor.
  const ageNoBaby = a.filter(([anchor]) => anchor !== "baby");
  add(
    "macrodetails/proportions/",
    combine("", [g, ageNoBaby, mu, we, proportionAxis(m.proportions)]),
  );
  // As in MakeHuman: breast targets exist for the female anchor only and scale
  // with it, and for the child, young and old anchors (none for baby), so breast
  // development through adolescence comes from the age interpolation itself.
  const female = 1 - Math.min(1, Math.max(0, m.gender));
  const breastAge = a.filter(([anchor]) => anchor !== "baby");
  if (female > 0)
    add(
      "breast/",
      combine("female", [breastAge, mu, we, cupAxis(m.breastSize), firmnessAxis(m.breastFirmness)]),
      female,
    );
  return out;
}

/**
 * The age body a macro target belongs to (`baby`, `child`, `adult`, `old`), or
 * null. Reads MakeHuman's name in the target (`young` for the adult body).
 */
export function macroTargetAgeAnchor(name: string): AgeAnchor | null {
  for (const { anchor, upstream } of AGE_ANCHORS)
    if (new RegExp(`(^|[/-])${upstream}(-|$)`).test(name)) return anchor;
  return null;
}

/** The age bodies whose targets a figure of this age weights. */
export const ageAnchorsOf = (years: number): AgeAnchor[] =>
  ageAxis(years)
    .filter(([, weight]) => weight > 0)
    .map(([anchor]) => anchor as AgeAnchor);

/**
 * Every target name `macroTargetWeights` can weight, found by evaluating it
 * at every combination of anchors, so the set cannot drift from the model.
 */
export function macroTargetNames(): Set<string> {
  const names = new Set<string>();
  const ends = [0, 1];
  const thirds = [0, 0.5, 1];
  const ethnic = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as const;
  for (const gender of ends)
    for (const { years: age } of AGE_ANCHORS)
      for (const muscle of thirds)
        for (const weight of thirds)
          for (const height of ends)
            for (const proportions of ends)
              for (const [african, asian, caucasian] of ethnic)
                for (const breastSize of thirds)
                  for (const breastFirmness of thirds) {
                    const m = { gender, age, muscle, weight, height, proportions };
                    const all = { ...m, african, asian, caucasian, breastSize, breastFirmness };
                    for (const name of macroTargetWeights(all).keys()) names.add(name);
                  }
  return names;
}
