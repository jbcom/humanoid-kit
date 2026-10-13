/**
 * A packed garment's id: `<group>/<asset directory>`, the group named for its
 * category (`GARMENT_LAYERS`). Whole outfits and jackets share "suits", as the
 * system assets' suits are both.
 */
import type { GARMENT_LAYERS } from "../../src/model/outfit.ts";

export const GARMENT_GROUP: Record<keyof typeof GARMENT_LAYERS, string> = {
  underwear: "underwear",
  hosiery: "hosiery",
  armwear: "armwear",
  socks: "socks",
  bottoms: "bottoms",
  clothes: "suits",
  top: "tops",
  sweater: "sweaters",
  jacket: "suits",
  gloves: "gloves",
  shoes: "shoes",
  coat: "coats",
  mask: "masks",
  glasses: "glasses",
  hat: "hats",
  backpack: "backpacks",
  held: "held",
};

export const garmentId = (kind: keyof typeof GARMENT_LAYERS, dir: string): string =>
  `${GARMENT_GROUP[kind]}/${dir}`;
