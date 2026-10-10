/**
 * The foundation's permutations (docs/FOUNDATION.md, "What a permutation is"):
 * a battery body, a battery tone, a pose and, for adults only, an anatomy
 * size. The one place they are enumerated; tests and sheets iterate them, and
 * no layer keeps its own list.
 */
import {
  BATTERY_BODIES,
  BATTERY_CROSS,
  BATTERY_TONES,
  type BatteryBody,
  type BatteryTone,
  batteryBody,
  batteryTone,
} from "./battery.ts";

/**
 * How the adult anatomy is set: the adult pack's own default, or every one of
 * its features at the low or high end of its modifiers (`anatomyModifiers`).
 * Abstract, so the core names no adult modifier.
 */
export type AnatomySize = "default" | "min" | "max";

/** A pose: a whole-body pose of the body pack by name (`tpose` is the rest A-pose). */
export interface FoundationPose {
  readonly name: string;
}

/**
 * A permutation. Its anatomy is a size only on an adult body: on a body whose
 * `adult` is `false` the type admits nothing but `null`.
 */
export type FoundationPermutation =
  | {
      readonly id: string;
      readonly body: BatteryBody<true>;
      readonly tone: BatteryTone;
      readonly pose: FoundationPose;
      readonly anatomy: AnatomySize;
    }
  | {
      readonly id: string;
      readonly body: BatteryBody<false>;
      readonly tone: BatteryTone;
      readonly pose: FoundationPose;
      readonly anatomy: null;
    };

export type FoundationTier = "smoke" | "full";

/**
 * The pose set, in order: the rest A-pose first, then the working range. The
 * full tier walks all of it; a pose joins as it is authored (`scripts/poses`).
 */
export const FOUNDATION_POSES = [
  "tpose",
  "relaxed",
  "overhead",
  "twisted",
  "seated",
  "tucked",
  "squat",
  "bent",
  "flexed",
  "abducted",
  "bowed",
] as const;

/** The smoke tier's poses: rest, seated, overhead and the deep squat. */
export const SMOKE_POSES = ["tpose", "seated", "overhead", "squat"] as const;

/** The smoke tier's tones: the battery's lightest, middle and deepest (1, 3 and 6). */
export const SMOKE_TONES = ["tone-1", "tone-3", "tone-6"] as const;

const ANATOMY_SIZES: readonly AnatomySize[] = ["default", "min", "max"];

/** One permutation's id: body, tone, pose and anatomy, slash-separated. */
const idOf = (body: BatteryBody, tone: BatteryTone, pose: string, anatomy: AnatomySize | null) =>
  `${body.name}/${tone.name}/${pose}/${anatomy ?? "none"}`;

function permutation(
  body: BatteryBody,
  tone: BatteryTone,
  pose: string,
  anatomy: AnatomySize,
): FoundationPermutation {
  // An anatomy reaches an adult body alone, whatever the caller asked.
  if (body.adult)
    return {
      id: idOf(body, tone, pose, anatomy),
      body: body as BatteryBody<true>,
      tone,
      pose: { name: pose },
      anatomy,
    };
  return {
    id: idOf(body, tone, pose, null),
    body: body as BatteryBody<false>,
    tone,
    pose: { name: pose },
    anatomy: null,
  };
}

/**
 * The permutations of a tier, bodies outermost then tones, poses and anatomy.
 *
 * - smoke: the cross set's six shape extremes × tones 1, 3 and 6 × rest,
 *   seated, overhead and squat, adults at the anatomy's default;
 * - full: all eighteen bodies × all six tones × every pose, adults at the
 *   anatomy's default and both extremes.
 *
 * A body under 18 has no anatomy in either.
 */
export function foundationPermutations(tier: FoundationTier): FoundationPermutation[] {
  const bodies = tier === "smoke" ? BATTERY_CROSS.bodies.map(batteryBody) : BATTERY_BODIES;
  const tones = tier === "smoke" ? SMOKE_TONES.map(batteryTone) : BATTERY_TONES;
  const poses: readonly string[] = tier === "smoke" ? SMOKE_POSES : FOUNDATION_POSES;
  const sizes: readonly AnatomySize[] = tier === "smoke" ? ["default"] : ANATOMY_SIZES;
  const out: FoundationPermutation[] = [];
  for (const body of bodies)
    for (const tone of tones)
      for (const pose of poses)
        if (body.adult) for (const size of sizes) out.push(permutation(body, tone, pose, size));
        else out.push(permutation(body, tone, pose, "default"));
  return out;
}
