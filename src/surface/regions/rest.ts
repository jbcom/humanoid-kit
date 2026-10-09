/**
 * The rest-state regional colours: flush, lips and areola, the first layers of
 * the skin stack. Their masks come from MakeHuman's own targets (see
 * `targetMask`): the cheek, nose and ear targets cover where skin flushes, the
 * lip volume targets outline the lips, and the nipple-size target covers
 * nipple and areola. Each is one colour for now; skin states give them
 * internal structure (docs/ARCHITECTURE.md, Skin states).
 */
import type { SkinLayer } from "../layers.ts";
import { diskMask, targetMask } from "../layers.ts";
import { areolaAlbedo, lipAlbedo } from "../skinTone.ts";

const maskLayer = (
  targets: readonly string[],
  lo: number,
  hi: number,
): Pick<SkinLayer, "targets" | "fields"> => ({
  targets,
  fields: (assets) => ({ mask: targetMask(assets, targets, lo, hi), coord: null }),
});

/** Warmth over cheeks, nose and ears, tinting the skin by the recipe's flush. */
export const FLUSH_LAYER: SkinLayer = {
  id: "flush",
  blend: "multiply",
  ...maskLayer(
    [
      "cheek/l-cheek-volume-incr",
      "cheek/r-cheek-volume-incr",
      "nose/nose-volume-incr",
      "ears/l-ear-scale-incr",
      "ears/r-ear-scale-incr",
    ],
    0.05,
    0.7,
  ),
  paint: ({ flush }) => ({ strength: flush, stops: [[1.1, 0.84, 0.84]] }),
};

/** Lip colour from measured lips (`lipAlbedo`). */
export const LIPS_LAYER: SkinLayer = {
  id: "lips",
  blend: "mix",
  ...maskLayer(
    ["mouth/mouth-upperlip-volume-incr", "mouth/mouth-lowerlip-volume-incr"],
    0.18,
    0.55,
  ),
  paint: ({ tone, lips }) => ({ strength: 0.9, stops: [lipAlbedo(tone, lips)] }),
};

/**
 * Areola and nipple colour along the melanin axis (`areolaAlbedo`), filled
 * across the disk the nipple-size target outlines (`diskMask`).
 */
export const AREOLA_LAYER: SkinLayer = {
  id: "areola",
  blend: "mix",
  targets: ["breast/nipple-size-incr"],
  fields: (assets) => ({ mask: diskMask(assets, ["breast/nipple-size-incr"]), coord: null }),
  paint: ({ tone, areola }) => ({ strength: 0.9, stops: [areolaAlbedo(tone, areola)] }),
};
