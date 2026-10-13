/**
 * Beard shapes (docs/ARCHITECTURE.md, "Beards"): what each named style grows
 * where, and how long, and the recipe's continuous controls resolved against
 * them. A style is a set of defaults, not a separate asset: every control is a
 * number the recipe may set, so a beard can grow, grey and fork over time
 * without swapping styles.
 */
import {
  type BeardStyle,
  type BodyHairInput,
  beardSpec,
  bodyHairCoverage,
  MAX_BEARD_VOLUME,
} from "./bodyHair.ts";
import type { BeardPart } from "./regions/bodyHairCoat.ts";

export interface BeardShape {
  /** Per part, its length as a fraction of the longest part's (0 grows nothing there). */
  parts: Readonly<Record<BeardPart, number>>;
  /** The longest part's default length, metres. */
  length: number;
  /** The default fork of the chin's hair, 0..1. */
  fork: number;
  /** The default part and sweep of the moustache, 0..1. */
  part: number;
}

const shape = (
  parts: Partial<Record<BeardPart, number>>,
  length: number,
  fork = 0,
  part = 0,
): BeardShape => ({
  parts: { moustache: parts.moustache ?? 0, chin: parts.chin ?? 0, cheeks: parts.cheeks ?? 0 },
  length,
  fork,
  part,
});

/**
 * Each style's parts and defaults. The parts a style grows are the coat's
 * (`BEARD_LENGTHS`); the lengths are measured off reference portraits: a
 * trimmed full beard about 3 cm, a forked beard about 20 cm to the points, a
 * Longstreet chest-length one about 35 cm from the chin.
 */
export const BEARD_SHAPES: Readonly<Record<BeardStyle, BeardShape>> = {
  none: shape({}, 0),
  stubble: shape({ moustache: 1, chin: 1, cheeks: 1 }, 0.0015),
  moustache: shape({ moustache: 1 }, 0.012),
  goatee: shape({ moustache: 0.8, chin: 1 }, 0.015),
  imperial: shape({ moustache: 1, chin: 0.8 }, 0.02, 0, 0.6),
  "mutton-chops": shape({ moustache: 0.7, cheeks: 1 }, 0.025),
  "chin-curtain": shape({ chin: 1, cheeks: 0.7 }, 0.03),
  full: shape({ moustache: 0.8, chin: 1, cheeks: 0.8 }, 0.03),
  forked: shape({ moustache: 0.5, chin: 1, cheeks: 0.6 }, 0.2, 0.8),
  longstreet: shape({ moustache: 0.4, chin: 1, cheeks: 0.7 }, 0.35),
};

/** A recipe's beard with every control resolved and in range. */
export interface ResolvedBeard {
  style: BeardStyle;
  /** The longest part's length, metres, 0 up to the chin's height. */
  length: number;
  /** Per part, its length in metres. */
  parts: Record<BeardPart, number>;
  volume: number;
  grey: number;
  fork: number;
  part: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The recipe's beard, its absent controls the style's defaults. `chinHeight`
 * is the chin's height above the floor in metres: no beard grows past the
 * floor, so a length beyond it is clamped there rather than refused, since the
 * recipe alone does not know the figure's height.
 */
export function resolveBeard(
  input: Pick<BodyHairInput, "bodyHair">,
  chinHeight: number,
): ResolvedBeard {
  const spec = beardSpec(input);
  const s = BEARD_SHAPES[spec.style];
  const length = clamp(spec.length ?? s.length, 0, Math.max(0, chinHeight));
  return {
    style: spec.style,
    length,
    parts: {
      moustache: s.parts.moustache * length,
      chin: s.parts.chin * length,
      cheeks: s.parts.cheeks * length,
    },
    volume: clamp(spec.volume ?? 1, 0, MAX_BEARD_VOLUME),
    grey: clamp(spec.grey ?? 0, 0, 1),
    fork: clamp(spec.fork ?? s.fork, 0, 1),
    part: clamp(spec.part ?? s.part, 0, 1),
  };
}

/**
 * How much of the recipe's beard grows, 0..1: the beard's coat cover and the
 * share of its cards drawn: none clean-shaven, else the face's coverage
 * (`bodyHairCoverage`), which reads no gender (DECISIONS ruling 1), comes in
 * from puberty, and follows the recipe's own face `coverage` or `density`.
 */
export function beardCoverage(input: BodyHairInput): number {
  return beardSpec(input).style === "none" ? 0 : bodyHairCoverage("face", input);
}
