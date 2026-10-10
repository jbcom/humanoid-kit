/**
 * The foundation's permutations as contact-sheet cells (docs/FOUNDATION.md,
 * "the sheet set"): `scripts/foundation-cells.ts` prints a tier's, and
 * `hk-sheets` runs it in its checkout of the ref it renders to expand a
 * `{"$foundation": "<tier>"}` request, so evidence for any layer over the
 * foundation is one line.
 *
 * A cell is a permutation's recipe input, its pose for the playground, and its
 * anatomy as a size, which the sheet tool resolves through the adult pack's own
 * `anatomy.features` for the adult form, so the core names no adult modifier.
 * A view frames a body region by a bone of the posed skeleton
 * (`?frame=<bone>&view=…&span=…`), so every cell is framed on its own figure in
 * its own pose: a short body's pelvis and a tall body's are both centred.
 */
import {
  type AnatomySize,
  type FoundationTier,
  foundationPermutations,
  REST_POSE,
} from "./permutations.ts";

/** Named views a foundation sheet can take: a playground camera query each. */
export const FOUNDATION_VIEWS = {
  whole: "frame=spine03&view=0,0,1&span=2.1",
  "whole-side": "frame=spine03&view=1,0,0&span=2.1",
  pelvis: "frame=root&view=0,0,1&span=0.45&light=camera",
  "pelvis-side": "frame=root&view=1,0,0.2&span=0.45&light=camera",
  chest: "frame=spine02&view=0,0.1,1&span=0.55",
  face: "frame=head&view=0,0.05,1&span=0.32",
  hand: "frame=wrist.L&view=0.3,0,1&span=0.3&light=camera",
  feet: "frame=foot.L&view=-0.3,0.2,1&span=0.5",
} as const;
export type FoundationView = keyof typeof FOUNDATION_VIEWS;

/** One cell of a foundation sheet. */
export interface FoundationCell {
  /** The permutation's id (body/tone/pose/anatomy). */
  id: string;
  macros: Record<string, number>;
  skin: { melanin: number };
  /** The playground's pose: a whole-body pose of the body pack by name; none at rest. */
  $pose?: { body: string };
  /** The adult anatomy's size, resolved by the sheet tool for the adult form; null under 18. */
  anatomy: AnatomySize | null;
}

/** A tier's sheet: its cells, and the views a request picks from by name (`$view`). */
export function foundationSheet(tier: FoundationTier): {
  views: Record<FoundationView, string>;
  cells: FoundationCell[];
} {
  return {
    views: { ...FOUNDATION_VIEWS },
    cells: foundationPermutations(tier).map((p) => ({
      id: p.id,
      macros: { ...p.body.macros },
      skin: { melanin: p.tone.melanin },
      ...(p.pose.name !== REST_POSE && { $pose: { body: p.pose.name } }),
      anatomy: p.anatomy,
    })),
  };
}
