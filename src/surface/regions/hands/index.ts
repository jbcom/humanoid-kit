/**
 * The hands' own skin (docs/ARCHITECTURE.md, "Hands"): palm colour here, the
 * palmar creases (`./creases.ts`), the knuckles (`./knuckles.ts`) and the
 * nails (`./nails.ts`), all measured from each hand's frame (`./frame.ts`).
 * Colour is in src/surface/handTone.ts. Every magnitude cites
 * docs/research/SKIN-STATES.md Part C5 or is marked there as a choice.
 */
import { palmAlbedo } from "../../handTone.ts";
import type { ColourLayer } from "../../layers.ts";
import { skinZones } from "../skinZones.ts";
import { PALM_CREASE_LAYER, PALM_CREASE_LINE_LAYER } from "./creases.ts";
import { KNUCKLE_LAYER, KNUCKLE_WRINKLE_LAYER } from "./knuckles.ts";
import { NAIL_GLOSS_LAYER, NAIL_LAYER } from "./nails.ts";

/**
 * Palm colour (`palmAlbedo`) over the palmar side of the hands, the fingers
 * included: the palm zone the skin states already use (`skinZones().palm`).
 */
export const PALM_LAYER: ColourLayer = {
  id: "palm",
  blend: "mix",
  targets: [],
  fields: (assets) => ({ mask: skinZones(assets).palm, coord: null }),
  paint: ({ tone }) => ({ strength: 1, stops: [palmAlbedo(tone)] }),
};

/**
 * Sole colour: the palm's (`palmAlbedo`) over `skinZones().sole`. Soles and
 * palms share the suppressed melanocytes of palmoplantar skin (Yamaguchi et
 * al. 2004, SKIN-STATES.md A1), but no sole colour was found measured, so
 * giving the sole the palm's measured colour is a CHOICE (C5). One owner for
 * the palmoplantar colour: the feet's area adds the sole's relief on top.
 */
export const SOLE_LAYER: ColourLayer = {
  id: "sole",
  blend: "mix",
  targets: [],
  fields: (assets) => ({ mask: skinZones(assets).sole, coord: null }),
  paint: ({ tone }) => ({ strength: 1, stops: [palmAlbedo(tone)] }),
};

/**
 * The hands' layers in stack order: the palm's and sole's colour first, then
 * the crease lines over the palm, the knuckles and the nails, then relief and
 * gloss.
 */
export const HAND_SKIN_LAYERS = [
  PALM_LAYER,
  SOLE_LAYER,
  PALM_CREASE_LINE_LAYER,
  KNUCKLE_LAYER,
  NAIL_LAYER,
  PALM_CREASE_LAYER,
  KNUCKLE_WRINKLE_LAYER,
  NAIL_GLOSS_LAYER,
] as const;

export {
  CREASE_GEOMETRY,
  CREASE_PHASES,
  CREASE_SLOTS,
  CREASE_TO_JOINT,
  type CreaseSample,
  creaseLineCoordinate,
  creasePhase,
  digitCreaseSign,
  digitCreases,
  FINGER_CREASE_SPANS,
  MIDDLE_CREASE_TO_JOINT,
  PALM_CREASE_DEPTH,
  PALM_CREASE_LAYER,
  PALM_CREASE_LINE_LAYER,
  PALM_CREASE_PIGMENT,
  PALM_CREASE_SHADE,
  palmCreaseCurves,
  palmCreaseLine,
  palmCreaseLineFields,
  palmCreaseReliefFields,
  sampleCreases,
  THUMB_CREASE_TO_JOINT,
} from "./creases.ts";
export { type HandFrame, handFrame, type PalmLandmarks } from "./frame.ts";
export {
  KNUCKLE_LAYER,
  KNUCKLE_PHASES,
  KNUCKLE_WRINKLE_DEPTH,
  KNUCKLE_WRINKLE_LAYER,
  KNUCKLE_WRINKLE_SPACING,
  knuckleFields,
} from "./knuckles.ts";
export {
  NAIL_GLOSS_LAYER,
  NAIL_LAYER,
  NAIL_LAYOUT,
  NAIL_ROUGHNESS,
  NAIL_SPECULAR,
  nailFields,
} from "./nails.ts";
