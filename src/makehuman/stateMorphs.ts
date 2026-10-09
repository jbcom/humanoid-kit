/**
 * Skin states that change shape (docs/ARCHITECTURE.md, "Skin states"): each
 * signal drives MakeHuman targets by fixed weights. A state is not identity,
 * so it enters an evaluation beside the recipe, never inside it, and is never
 * saved with a figure.
 *
 * The weights are calibrated to measured responses (docs/research/SKIN-STATES.md).
 * Under cold (B3) the areola contracts by about 5.6% in circumference and the
 * nipple rises by about 19% (both measured on partly denervated grafts, so
 * lower bounds for intact skin). On the default figure one unit of
 * `nipple-point-incr` raises the nipple 67% above the areola's plane and one
 * of `nipple-size-decr` shrinks the areola's radius 44% (and lowers the
 * nipple), so cold uses 0.37 and 0.13 (tests/stateMorphs.test.ts measures the
 * result).
 *
 * Arousal (B4) is adult-only (`ADULT_ONLY_SIGNALS`, refused under 18 before any
 * of this runs) and drives the adult anatomy pack's penis targets: erect
 * against flaccid is +25% in circumference (Rigiscan, N=803: +25.3%; Veale's
 * nomograms: 11.66 / 9.31 cm) and +43% in length (13.12 / 9.16 cm). One unit of
 * `penis-circ-incr` widens the shaft by 56% and one of `penis-length-incr`
 * lengthens it by 169%, so arousal uses 0.44 and 0.25
 * (tests/arousal.test.ts measures the result). Only targets that exist are
 * driven: there are none for the testes, whose response is unmeasured, nor for
 * the vulva and clitoris (their volume change has no verified magnitude), so
 * those stay still until the sculpt phase adds both.
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
  {
    signal: "arousal",
    targets: [
      { name: "genitals/penis-circ-incr", weight: 0.44 },
      { name: "genitals/penis-length-incr", weight: 0.25 },
    ],
  },
];

/** Every target a state morph can drive. */
export const STATE_MORPH_TARGETS: readonly string[] = [
  ...new Set(STATE_MORPHS.flatMap((m) => m.targets.map((t) => t.name))),
];

/**
 * The target weights the signals add to an evaluation (signals are 0..1).
 * `exists` limits them to targets some loaded pack knows (a state of the adult
 * anatomy does nothing, rather than fails, without the adult pack); by default
 * every target is driven.
 */
export function stateContributions(
  signals: Readonly<Record<string, number>>,
  exists: (target: string) => boolean = () => true,
): Contribution[] {
  const out: Contribution[] = [];
  for (const m of STATE_MORPHS) {
    const s = Math.min(1, Math.max(0, signals[m.signal] ?? 0));
    if (s === 0) continue;
    for (const t of m.targets)
      if (exists(t.name)) out.push({ target: t.name, weight: s * t.weight });
  }
  return out;
}
