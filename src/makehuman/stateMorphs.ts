/**
 * Skin states that change shape (docs/ARCHITECTURE.md, "Skin states"): each
 * signal drives MakeHuman targets by fixed weights. A state is not identity,
 * so it enters an evaluation beside the recipe, never inside it, and is never
 * saved with a figure.
 *
 * The weights are calibrated to measured responses (docs/research/SKIN-STATES.md
 * B3): under cold the areola contracts by about 5.6% in circumference and the
 * nipple rises by about 19% (both measured on partly denervated grafts, so
 * lower bounds for intact skin). On the default figure one unit of
 * `nipple-point-incr` raises the nipple 67% above the areola's plane and one
 * of `nipple-size-decr` shrinks the areola's radius 44% (and lowers the
 * nipple), so cold uses 0.37 and 0.13 (tests/stateMorphs.test.ts measures the
 * result). Sexual arousal is adult-only (`ADULT_ONLY_SIGNALS`); its shape
 * belongs to the adult anatomy pack.
 */
import type { Contribution } from "../morph/evaluate.ts";

export interface StateMorph {
  signal: string;
  targets: readonly { name: string; weight: number }[];
}

export const STATE_MORPHS: readonly StateMorph[] = [
  {
    signal: "cold",
    targets: [
      { name: "breast/nipple-point-incr", weight: 0.37 },
      { name: "breast/nipple-size-decr", weight: 0.13 },
    ],
  },
];

/** Every target a state morph can drive. */
export const STATE_MORPH_TARGETS: readonly string[] = [
  ...new Set(STATE_MORPHS.flatMap((m) => m.targets.map((t) => t.name))),
];

/**
 * How many steps a shape signal moves in, 0 to 1. A shape state re-evaluates the
 * figure, so a signal easing at the frame rate (`useSkinStateFilter`) would
 * evaluate it every frame; in 50 steps it evaluates it a few dozen times,
 * each a change under 1% of the nipple's point target.
 */
export const SHAPE_SIGNAL_STEPS = 50;

/** A shape signal rounded to its step, inside 0..1. */
export function quantiseShapeSignal(signal: number): number {
  return Math.round(Math.min(1, Math.max(0, signal)) * SHAPE_SIGNAL_STEPS) / SHAPE_SIGNAL_STEPS;
}

/** The target weights the signals add to an evaluation (signals are 0..1). */
export function stateContributions(signals: Readonly<Record<string, number>>): Contribution[] {
  const out: Contribution[] = [];
  for (const m of STATE_MORPHS) {
    const s = Math.min(1, Math.max(0, signals[m.signal] ?? 0));
    if (s === 0) continue;
    for (const t of m.targets) out.push({ target: t.name, weight: s * t.weight });
  }
  return out;
}
