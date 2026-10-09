/**
 * MakeHuman-compatible macro interpolation.
 *
 * Macro targets are combinatorial: each file name lists one anchor per macro
 * axis (`african-male-young`, `universal-female-old-maxmuscle-minweight`, ...),
 * and a target's weight is the product of its anchors' weights. Each axis is
 * linear interpolation between its anchors, so one axis's weights sum to 1.
 *
 * The age axis spans MakeHuman's four anchors: baby (1 year), child (11),
 * young (25) and old (90).
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

export const AGE_ANCHORS = [
  ["baby", 1],
  ["child", 11],
  ["young", 25],
  ["old", 90],
] as const;
export const MIN_AGE = 1;
export const MAX_AGE = 90;
/** Adult-only controls and packs apply from this age. See `recipe/agePolicy.ts`. */
export const ADULT_AGE = 18;

/** Age in years, piecewise linear between MakeHuman's anchors. */
export const ageAxis = (years: number): AxisWeights => {
  const y = Math.min(MAX_AGE, Math.max(MIN_AGE, years));
  for (let i = 0; i + 1 < AGE_ANCHORS.length; i++) {
    const [a, ya] = AGE_ANCHORS[i] as readonly [string, number];
    const [b, yb] = AGE_ANCHORS[i + 1] as readonly [string, number];
    if (y <= yb) {
      const t = (y - ya) / (yb - ya);
      return [
        [a, 1 - t],
        [b, t],
      ];
    }
  }
  return [["old", 1]];
};

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
        if (ww > 1e-6) next.push([name ? `${name}-${anchor}` : anchor, ww]);
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
  const a = ageAxis(m.age);
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
  const avg: AxisWeights[] = [g, a, [["averagemuscle", 1]], [["averageweight", 1]]];
  add("macrodetails/height/", combine("", [...avg, heightAxis(m.height)]));
  // Upstream ships no baby proportion targets, so proportions do not apply at the baby anchor.
  const ageNoBaby = a.filter(([anchor]) => anchor !== "baby");
  add(
    "macrodetails/proportions/",
    combine("", [
      g,
      ageNoBaby,
      [["averagemuscle", 1]],
      [["averageweight", 1]],
      proportionAxis(m.proportions),
    ]),
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

/** The age anchor a macro target belongs to (`baby`, `child`, `young`, `old`), or null. */
export function macroTargetAgeAnchor(name: string): AgeAnchor | null {
  for (const [anchor] of AGE_ANCHORS)
    if (new RegExp(`(^|[/-])${anchor}(-|$)`).test(name)) return anchor;
  return null;
}

/** The age anchors whose targets a figure of this age weights. */
export const ageAnchorsOf = (years: number): AgeAnchor[] =>
  ageAxis(years)
    .filter(([, weight]) => weight > 0)
    .map(([anchor]) => anchor as AgeAnchor);

export type AgeAnchor = (typeof AGE_ANCHORS)[number][0];

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
    for (const [, age] of AGE_ANCHORS)
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
