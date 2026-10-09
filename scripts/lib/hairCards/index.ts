/**
 * The styles the packer authors itself (procedural cards bound to the base mesh), beside the
 * MakeHuman ones it compiles (`HAIR_STYLES` in `../packHair.ts`). The CC0 sources have no
 * twists, braids, cornrows or locs (docs/ARCHITECTURE.md, "the coily gap"); these fill it.
 */
import { braidAtlas, locAtlas, twistAtlas } from "./atlas.ts";
import type { Cards } from "./ropes.ts";
import { boxBraids, cornrows, locs, type StyleContext, twists } from "./styles.ts";

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
];
