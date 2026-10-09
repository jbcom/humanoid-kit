/**
 * The hands' own skin (docs/ARCHITECTURE.md, "Hands"): the palmoplantar colour
 * here, the palmar creases (`./creases.ts`), the knuckles (`./knuckles.ts`)
 * and the nails (`./nails.ts`), all measured from each hand's frame
 * (`./frame.ts`). Colour is in src/surface/handTone.ts. Every magnitude cites
 * docs/research/SKIN-STATES.md Part C5 or is marked there as a choice.
 *
 * Features whose masks never meet on the mesh share a layer, since each layer
 * costs atlas channels and the hand's features lie too close together in the
 * UV layout for the atlas to pack them apart (ARCHITECTURE.md, "Hands"): the
 * palm and the sole share one colour, the knuckles and the nails one colour
 * coordinate, and the palm's creases and the knuckles' wrinkles one relief.
 */

import type { HumanoidAssets } from "../../../format/assetFormat.ts";
import { knuckleAlbedo, nailStops, palmAlbedo } from "../../handTone.ts";
import type { ColourLayer, DetailLayer, SkinLayerFields } from "../../layers.ts";
import { skinZones } from "../skinZones.ts";
import {
  CREASE_PHASES,
  PALM_CREASE_DEPTH,
  PALM_CREASE_LINE_LAYER,
  palmCreaseReliefFields,
} from "./creases.ts";
import { KNUCKLE_PHASES, KNUCKLE_WRINKLE_DEPTH, knuckleFields } from "./knuckles.ts";
import { NAIL_GLOSS_LAYER, nailFields } from "./nails.ts";
import { palmarMask } from "./palm.ts";

/**
 * Palmoplantar colour (`palmAlbedo`) over the palms, the fingers' palmar
 * sides included (`palmarMask`, easing into the back of the hand over the
 * lateral borders and into the forearm at the wrist), and the soles
 * (`skinZones().sole`). Soles share the palm's suppressed
 * melanocytes (Yamaguchi et al. 2004, SKIN-STATES.md A1), but no sole colour
 * was found measured, so giving the sole the palm's measured colour is a
 * CHOICE (C5). One owner for the palmoplantar colour: the feet's area adds the
 * sole's relief on top.
 *
 * The zones fall off smoothly and their tails reach the knees at under 1e-6,
 * where the joint creases lie. The mask drops what the 8-bit field atlas rounds
 * to 0 anyway (`PALMOPLANTAR_FLOOR`), so it lies only where it paints and
 * shares an atlas channel with the creases cleanly.
 */
export const PALMOPLANTAR_FLOOR = 0.5 / 255;

export const PALMOPLANTAR_LAYER: ColourLayer = {
  id: "palmoplantar",
  blend: "mix",
  targets: [],
  fields: (assets) => {
    const { sole } = skinZones(assets);
    const mask = palmarMask(assets).map((p, v) => {
      const m = Math.max(p, sole[v] as number);
      return m < PALMOPLANTAR_FLOOR ? 0 : m;
    });
    return { mask, coord: null };
  },
  paint: ({ tone }) => ({ strength: 1, stops: [palmAlbedo(tone)] }),
};

const digitCache = new WeakMap<HumanoidAssets, SkinLayerFields>();

/**
 * The knuckles' and nails' colour fields: the stronger mask of the two, and
 * the nail coordinate, which is 0 everywhere short of a nail's fold, where the
 * knuckles lie (`nailFields`), so one coordinate serves both.
 */
export function digitFields(assets: HumanoidAssets): SkinLayerFields {
  const known = digitCache.get(assets);
  if (known) return known;
  const pigment = knuckleFields(assets).pigment;
  const nails = nailFields(assets).colour;
  const mask = pigment.map((k, v) => Math.max(k, nails.mask[v] as number));
  // A nail starts at its fold's stop (1/7; the knuckle's takes the nail's
  // first, at 0). Where the knuckle's edge outweighs a nail's, toward the
  // fold's sides, the coordinate leans back toward the knuckle's 0 in
  // proportion, which paints about what the nail layered over the knuckle did.
  const coord = (nails.coord as Float32Array).map((c, v) => {
    const n = nails.mask[v] as number;
    return n > 0 ? (Math.max(c, 1 / 7) * n) / (mask[v] as number) : 0;
  });
  const fields = { mask, coord };
  digitCache.set(assets, fields);
  return fields;
}

/**
 * The backs of the digits' colour: the knuckles' (`knuckleAlbedo`) at the
 * coordinate's 0, then a nail's fold, lunula, bed and free edge along it
 * (`nailStops`, whose first stop, the fold, gives way to the knuckle's: the
 * fold's colour is reached at the cuticle's side of the fold).
 */
export const DIGIT_LAYER: ColourLayer = {
  id: "knuckles-nails",
  blend: "mix",
  targets: [],
  fields: digitFields,
  paint: ({ tone }) => ({ strength: 1, stops: [knuckleAlbedo(tone), ...nailStops(tone).slice(1)] }),
};

/**
 * Phases the hands' relief coordinate spans: the knuckles' (`KNUCKLE_PHASES`);
 * a palm crease's fold (phases 0.5 to 1.5, `CREASE_PHASES` of them in its own
 * coordinate) is rescaled into it.
 */
export const HAND_RELIEF_PHASES = KNUCKLE_PHASES;

const reliefCache = new WeakMap<HumanoidAssets, SkinLayerFields>();

/**
 * The hands' relief fields: the palm's crease folds on the palmar side and
 * the knuckles' wrinkles on the dorsal, which never meet (both masks are zero
 * across the digits' sides), each where its mask is the stronger. The
 * wrinkles' smaller depth is carried in their mask.
 */
export function handReliefFields(assets: HumanoidAssets): SkinLayerFields {
  const known = reliefCache.get(assets);
  if (known) return known;
  const creases = palmCreaseReliefFields(assets);
  const wrinkles = knuckleFields(assets).wrinkles;
  const depth = KNUCKLE_WRINKLE_DEPTH / PALM_CREASE_DEPTH;
  const n = assets.manifest.vertexCount;
  const mask = new Float32Array(n);
  const coord = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const c = creases.mask[v] as number;
    const k = (wrinkles.mask[v] as number) * depth;
    if (k > c) {
      mask[v] = k;
      coord[v] = wrinkles.coord?.[v] as number;
    } else {
      mask[v] = c;
      coord[v] = ((creases.coord?.[v] as number) * CREASE_PHASES) / HAND_RELIEF_PHASES;
    }
  }
  const fields = { mask, coord };
  reliefCache.set(assets, fields);
  return fields;
}

/** The hands' relief: the palm's creases as folds and the knuckles' wrinkles as arcs. */
export const HAND_RELIEF_LAYER: DetailLayer = {
  id: "hand-relief",
  kind: "detail",
  pattern: "creases",
  targets: [],
  fields: handReliefFields,
  paint: () => ({ strength: 1, height: PALM_CREASE_DEPTH, size: HAND_RELIEF_PHASES }),
};

/**
 * The hands' layers in stack order: the palmoplantar colour first, then the
 * crease lines over the palm, the knuckles and nails, then relief and gloss.
 */
export const HAND_SKIN_LAYERS = [
  PALMOPLANTAR_LAYER,
  PALM_CREASE_LINE_LAYER,
  DIGIT_LAYER,
  HAND_RELIEF_LAYER,
  NAIL_GLOSS_LAYER,
] as const;

export {
  CREASE_BORDER_INSET,
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
  FINGER_CREASE_STRENGTH,
  MIDDLE_CREASE_TO_JOINT,
  PALM_CREASE_DEPTH,
  PALM_CREASE_LINE_LAYER,
  PALM_CREASE_LIP,
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
  KNUCKLE_PHASES,
  KNUCKLE_WRINKLE_DEPTH,
  KNUCKLE_WRINKLE_SPACING,
  knuckleFields,
} from "./knuckles.ts";
export {
  NAIL_FREE_EDGE_LENGTH,
  NAIL_FREE_EDGE_OPACITY,
  NAIL_FREE_EDGE_SOFT,
  NAIL_GLOSS_LAYER,
  NAIL_LAYOUT,
  NAIL_PLATE_KINDS,
  NAIL_PLATE_OPACITY,
  NAIL_ROUGHNESS,
  NAIL_SPECULAR,
  nailFields,
  nailPlateEdges,
} from "./nails.ts";
export {
  PALM_BORDER_BLEND,
  PALM_WRIST_BLEND,
  palmarBorderDistance,
  palmarMask,
  palmarWrist,
} from "./palm.ts";
