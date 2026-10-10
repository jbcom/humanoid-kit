/**
 * The figure battery (docs/evidence/BATTERY.md): the fixed bodies and skin
 * tones every visual feature is calibrated and judged against, and the cross
 * set of shape extremes at four tones. The one source of them:
 * `scripts/sheets/battery.json`, which `hk-sheets` expands, is written from
 * this module (`scripts/write-battery.ts`) and a test holds it to it.
 */
import type { MacroValues } from "../makehuman/macro.ts";
import { ADULT_AGE } from "../recipe/agePolicy.ts";

/** A battery tone: a skin melanin on the average adult body. */
export interface BatteryTone {
  readonly name: string;
  readonly melanin: number;
}

/**
 * A battery body. `adult` is the age policy's verdict on its age, as a literal,
 * so a type can allow adult anatomy on adult bodies alone (`FoundationAnatomy`).
 */
export interface BatteryBody<Adult extends boolean = boolean> {
  readonly name: string;
  readonly macros: Readonly<Partial<MacroValues>> & { readonly age: number };
  readonly adult: Adult;
}

/** Six tones, from melanin 0.05 to 0.9. */
export const BATTERY_TONES = [
  { name: "tone-1", melanin: 0.05 },
  { name: "tone-2", melanin: 0.2 },
  { name: "tone-3", melanin: 0.35 },
  { name: "tone-4", melanin: 0.5 },
  { name: "tone-5", melanin: 0.7 },
  { name: "tone-6", melanin: 0.9 },
] as const satisfies readonly BatteryTone[];

const adult = <const M extends BatteryBody["macros"]>(name: string, macros: M) =>
  ({ name, macros, adult: true }) as const satisfies BatteryBody<true>;
const minor = <const M extends BatteryBody["macros"]>(name: string, macros: M) =>
  ({ name, macros, adult: false }) as const satisfies BatteryBody<false>;

/**
 * Eighteen bodies at a mid tone: slim, average, heavy and muscular women and
 * men, an androgynous average, tall and short, elders of both sexes, a teen, a
 * child and the three ancestry anchors.
 */
export const BATTERY_BODIES = [
  adult("f-slim", { age: 25, gender: 0, weight: 0, muscle: 0.3 }),
  adult("f-average", { age: 25, gender: 0 }),
  adult("f-heavy", { age: 25, gender: 0, weight: 1, muscle: 0.3 }),
  adult("f-muscular", { age: 25, gender: 0, weight: 0.4, muscle: 1 }),
  adult("m-slim", { age: 25, gender: 1, weight: 0, muscle: 0.3 }),
  adult("m-average", { age: 25, gender: 1 }),
  adult("m-heavy", { age: 25, gender: 1, weight: 1, muscle: 0.3 }),
  adult("m-muscular", { age: 25, gender: 1, weight: 0.4, muscle: 1 }),
  adult("x-average", { age: 25, gender: 0.5 }),
  adult("tall", { age: 25, gender: 0.5, height: 1 }),
  adult("short", { age: 25, gender: 0.5, height: 0 }),
  adult("f-elder", { age: 75, gender: 0 }),
  adult("m-elder", { age: 75, gender: 1 }),
  minor("teen", { age: 14, gender: 0.5 }),
  minor("child", { age: 6, gender: 0.5 }),
  adult("african", { age: 25, gender: 0.5, african: 1, asian: 0, caucasian: 0 }),
  adult("asian", { age: 25, gender: 0.5, african: 0, asian: 1, caucasian: 0 }),
  adult("caucasian", { age: 25, gender: 0.5, african: 0, asian: 0, caucasian: 1 }),
] as const;

export type BatteryBodyName = (typeof BATTERY_BODIES)[number]["name"];
export type BatteryToneName = (typeof BATTERY_TONES)[number]["name"];

/** The cross set: the extremes of shape against light, mid, dark and deepest skin. */
export const BATTERY_CROSS = {
  bodies: ["f-slim", "f-heavy", "m-muscular", "m-heavy", "f-elder", "child"],
  tones: ["tone-1", "tone-3", "tone-5", "tone-6"],
} as const satisfies { bodies: readonly BatteryBodyName[]; tones: readonly BatteryToneName[] };

/** A battery body by name. */
export function batteryBody(name: BatteryBodyName): (typeof BATTERY_BODIES)[number] {
  const body = BATTERY_BODIES.find((b) => b.name === name);
  if (!body) throw new RangeError(`no battery body ${name}`);
  return body;
}

/** A battery tone by name. */
export function batteryTone(name: BatteryToneName): BatteryTone {
  const tone = BATTERY_TONES.find((t) => t.name === name);
  if (!tone) throw new RangeError(`no battery tone ${name}`);
  return tone;
}

/** Whether the age policy counts a body's age as an adult's: what its `adult` flag must say. */
export const isAdultBody = (body: BatteryBody): boolean => body.macros.age >= ADULT_AGE;

/**
 * The battery as `scripts/sheets/battery.json` holds it: recipe inputs named
 * for `hk-sheets`, which reads that file.
 */
export function batteryJson(): {
  $comment: string;
  tones: { name: string; skin: { melanin: number } }[];
  bodies: { name: string; macros: Record<string, number> }[];
  cross: { $comment: string; bodies: string[]; tones: string[] };
} {
  return {
    $comment:
      "The figure battery: the fixed set of figures every visual feature is calibrated and judged against (docs/evidence/BATTERY.md). Written from src/foundation/battery.ts by scripts/write-battery.ts; edit that, not this. A feature's evidence shows the bodies set at a mid tone and the tones set on the average adult body; anything placed on an area (marks, tattoos, piercings, hair) also shows the cross set. Recipes are createRecipe input.",
    tones: BATTERY_TONES.map((t) => ({ name: t.name, skin: { melanin: t.melanin } })),
    bodies: BATTERY_BODIES.map((b) => ({ name: b.name, macros: { ...b.macros } })),
    cross: {
      $comment:
        "Every listed body at tones 1, 3, 5 and 6: the extremes of shape against light, mid and deep skin.",
      bodies: [...BATTERY_CROSS.bodies],
      tones: [...BATTERY_CROSS.tones],
    },
  };
}
