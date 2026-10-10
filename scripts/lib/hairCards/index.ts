/**
 * The styles the packer authors itself (procedural cards bound to the base mesh), beside the
 * MakeHuman ones it compiles (`HAIR_STYLES` in `../packHair.ts`). The CC0 sources have no
 * twists, braids, cornrows or locs (docs/ARCHITECTURE.md, "the coily gap"); these fill it.
 */
import {
  braidAtlas,
  type Cutout,
  coilCropAtlas,
  connectedPart,
  locAtlas,
  twistAtlas,
} from "./atlas.ts";
import type { Cards } from "./ropes.ts";
import { bantuKnots, boxBraids, cornrows, locs, type StyleContext, twists } from "./styles.ts";

export interface AuthoredStyleSpec {
  id: string;
  label: string;
  tags: string[];
  /** The cards, from the figure at rest. */
  build: (context: StyleContext) => Cards;
  /** The strand map before normalisation: PNG bytes. */
  atlas: () => Promise<Buffer>;
  /** What the provenance record says made it. */
  provenance: string;
  /** Written into the style's measurements (`HairStyleSpec`): ropes are solid from every side. */
  feather: false;
  fins: false;
}

const AUTHORED = (what: string) =>
  `authored by the packer: ${what}; no mesh or texture of anyone's is read, only the base mesh it is bound to (CC0)`;

export const AUTHORED_STYLES: readonly AuthoredStyleSpec[] = [
  {
    id: "braids01",
    label: "Box braids",
    tags: ["long", "braids", "coily"],
    build: boxBraids,
    atlas: () => braidAtlas(7),
    provenance: AUTHORED(
      "three-strand plait tubes from a grid of partings (scripts/lib/hairCards)",
    ),
    feather: false,
    fins: false,
  },
  {
    id: "cornrows01",
    label: "Cornrows",
    tags: ["long", "braids", "cornrows", "coily"],
    build: cornrows,
    atlas: () => braidAtlas(19),
    provenance: AUTHORED(
      "plait tubes lying on the scalp in parallel rows, with a braid hanging from each (scripts/lib/hairCards)",
    ),
    feather: false,
    fins: false,
  },
  {
    id: "twists01",
    label: "Two-strand twists",
    tags: ["medium", "twists", "coily"],
    build: twists,
    atlas: () => twistAtlas(5),
    provenance: AUTHORED("two-strand twist tubes from a grid of partings (scripts/lib/hairCards)"),
    feather: false,
    fins: false,
  },
  {
    id: "locs01",
    label: "Locs",
    tags: ["long", "locs", "coily"],
    build: locs,
    atlas: () => locAtlas(3),
    provenance: AUTHORED("matted rope tubes from a grid of partings (scripts/lib/hairCards)"),
    feather: false,
    fins: false,
  },
  {
    id: "bantu01",
    label: "Bantu knots",
    tags: ["short", "knots", "coily"],
    build: bantuKnots,
    atlas: () => twistAtlas(9),
    provenance: AUTHORED(
      "twisted ropes coiled into knots on a grid of partings (scripts/lib/hairCards)",
    ),
    feather: false,
    fins: false,
  },
];

/**
 * A style that keeps a MakeHuman style's cards (its geometry, binding and cut-out are CC0) and
 * draws its own strand map inside the cut-out: the texture a style has is the one thing a different
 * hair type needs. The packer compiles `from` as it does any MakeHuman style, under this id.
 */
export interface DerivedStyleSpec {
  id: string;
  label: string;
  tags: string[];
  /** The MakeHuman style whose cards are kept. */
  from: string;
  /** The strand map before normalisation, drawn inside the source's cut-out: PNG bytes with alpha. */
  atlas: (cutout: Cutout, density?: Float32Array) => Promise<Buffer>;
  /** The share of hair kept at a place on the head (azimuth from the front, elevation, degrees): a fade. Absent keeps it all. */
  keepAt?: (azimuth: number, elevation: number) => number;
  /** Whether the hairline thins (default true, as for a MakeHuman style). */
  feather?: boolean;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A mid fade: full on top, tapering over the ears and round the back to bare skin at the nape; the
 * front is left to the hairline. The taper starts a little lower at the back, where the neck is.
 */
export function fadeKeep(azimuth: number, elevation: number): number {
  const side = smooth(30, 55, azimuth);
  const full = 24 - 8 * smooth(80, 150, azimuth);
  const bare = 6 - 14 * smooth(80, 150, azimuth);
  return 1 - side * (1 - smooth(bare, full, elevation));
}

export const DERIVED_STYLES: readonly DerivedStyleSpec[] = [
  {
    id: "crop01",
    label: "Close crop, coily",
    tags: ["short", "crop", "coily"],
    from: "short04",
    // The cap is the part of the cut-out the centre of the top of the atlas belongs to: the
    // source's loose cards below it stay clear.
    atlas: (cutout) =>
      coilCropAtlas(
        cutout,
        connectedPart(cutout, Math.round(cutout.width / 2), Math.round(cutout.height * 0.1)),
      ),
  },
];
