/**
 * The areas' layers as the stack has them: the hands' (`./hands/index.ts`) with
 * the feet's skin painted by the same layers, because the field atlas has no
 * channels to spare (docs/ARCHITECTURE.md, "Feet"). Features on one layer must
 * have masks that never meet; each takes the same colour model or the same
 * relief as the hands' feature it joins:
 *
 * - `palmoplantar`: the palm's and the sole's colour, with the sole's callus as
 *   the coordinate (0 none, 1 full) and a second stop that is the colour there;
 * - `knuckles-nails`: the toenails join the fingers' nails, on the same
 *   coordinate and stops (the nail model has one owner);
 * - `nail-gloss`: the toenails' plate gloss is the fingernails';
 * - `hand-relief`: the toes' wrinkles join the knuckles' and the toes' creases
 *   the palm's, in the coordinate the hands' relief already uses.
 *
 * The hands' own layer definitions are unchanged and keep their own tests.
 */
import type { HumanoidAssets } from "../../format/assetFormat.ts";
import { callusAlbedo } from "../footTone.ts";
import type {
  ColourLayer,
  DetailLayer,
  SkinLayer,
  SkinLayerFields,
  SurfaceLayer,
} from "../layers.ts";
import {
  CALLUS_OPACITY,
  callusAmount,
  callusWeights,
  FOOT_SKIN_LAYERS,
  TOE_CREASE_DEPTH,
  TOE_WRINKLE_COUNT,
  TOE_WRINKLE_DEPTH,
  toeCreaseFields,
  toenailFields,
  toeWrinkleFields,
} from "./feet.ts";
import {
  DIGIT_LAYER,
  digitFields,
  HAND_RELIEF_LAYER,
  HAND_RELIEF_PHASES,
  HAND_SKIN_LAYERS,
  handReliefFields,
  NAIL_GLOSS_LAYER,
  nailFields,
  PALM_CREASE_DEPTH,
  PALMOPLANTAR_LAYER,
} from "./hands/index.ts";

const cache = new WeakMap<object, Map<string, SkinLayerFields>>();
/** A layer's merged fields, worked out once per set of assets. */
function once(assets: HumanoidAssets, key: string, make: () => SkinLayerFields): SkinLayerFields {
  let m = cache.get(assets);
  if (!m) {
    m = new Map();
    cache.set(assets, m);
  }
  let f = m.get(key);
  if (!f) {
    f = make();
    m.set(key, f);
  }
  return f;
}

/**
 * Palmoplantar colour with the sole's callus as a term of its paint: the
 * coordinate is the callus weight (the palm's is 0) and the layer's second stop
 * is the sole's colour made callus (`callusAlbedo`) as far as this age's
 * `callusAmount` (and `CALLUS_OPACITY`) goes, so the coordinate blends the one
 * into the other.
 */
export const SOLE_PALMOPLANTAR_LAYER: ColourLayer = {
  ...PALMOPLANTAR_LAYER,
  fields: (assets) =>
    once(assets, "palmoplantar", () => {
      const { mask } = PALMOPLANTAR_LAYER.fields(assets);
      const weight = callusWeights(assets);
      // Only where the layer paints: the weights' faint tails are below the mask's floor.
      const coord = weight.map((w, v) => ((mask[v] as number) > 0 ? w : 0));
      return { mask, coord };
    }),
  paint: (input) => {
    const base = PALMOPLANTAR_LAYER.paint(input);
    const sole = base.stops[0] as [number, number, number];
    const callus = callusAlbedo(input.tone);
    const k = CALLUS_OPACITY * callusAmount(input.age);
    return {
      strength: base.strength,
      stops: [
        sole,
        sole.map((c, i) => c + ((callus[i] as number) - c) * k) as [number, number, number],
      ],
    };
  },
};

/** The fingers' knuckles and nails with the toenails on the same coordinate and stops. */
export const DIGIT_AND_TOENAIL_LAYER: ColourLayer = {
  ...DIGIT_LAYER,
  fields: (assets) =>
    once(assets, "digits", () => {
      const hands = digitFields(assets);
      const toes = toenailFields(assets).colour;
      const toeMask = toes.mask;
      const toeCoord = toes.coord as Float32Array;
      const mask = (hands.mask as Float32Array).map((m, v) => Math.max(m, toeMask[v] as number));
      // As the hands' nails: a nail starts at its fold's stop (1/7; the knuckle's takes the first, at 0).
      const coord = (hands.coord as Float32Array).map((c, v) => {
        const n = toeMask[v] as number;
        return n > 0 ? (Math.max(toeCoord[v] as number, 1 / 7) * n) / (mask[v] as number) : c;
      });
      return { mask, coord };
    }),
};

/** The nail plates' gloss: the toenails' with the fingernails'. */
export const NAIL_AND_TOENAIL_GLOSS_LAYER: SurfaceLayer = {
  ...NAIL_GLOSS_LAYER,
  fields: (assets) => {
    const hands = nailFields(assets).gloss;
    const toes = toenailFields(assets).gloss;
    return { mask: hands.map((g, v) => Math.max(g, toes[v] as number)), coord: null };
  },
};

/**
 * The relief the hands' layer draws (palm creases as folds, knuckle wrinkles as
 * arcs, in the coordinate of `HAND_RELIEF_PHASES` periods and a mask carrying
 * the depth against `PALM_CREASE_DEPTH`) with the toes': a wrinkle band is
 * `TOE_WRINKLE_COUNT` periods of it and a crease under a joint one.
 */
export const RELIEF_AND_TOE_LAYER: DetailLayer = {
  ...HAND_RELIEF_LAYER,
  fields: (assets) =>
    once(assets, "relief", () => {
      const hands = handReliefFields(assets);
      const wrinkles = toeWrinkleFields(assets);
      const creases = toeCreaseFields(assets);
      const n = assets.manifest.vertexCount;
      const mask = Float32Array.from(hands.mask);
      const coord = Float32Array.from(hands.coord as Float32Array);
      const wrinkleDepth = TOE_WRINKLE_DEPTH / PALM_CREASE_DEPTH;
      const creaseDepth = TOE_CREASE_DEPTH / PALM_CREASE_DEPTH;
      for (let v = 0; v < n; v++) {
        const w = (wrinkles.mask[v] as number) * wrinkleDepth;
        const c = (creases.mask[v] as number) * creaseDepth;
        if (w > (mask[v] as number) && w >= c) {
          mask[v] = w;
          coord[v] =
            ((wrinkles.coord as Float32Array)[v] as number) *
            (TOE_WRINKLE_COUNT / HAND_RELIEF_PHASES);
        } else if (c > (mask[v] as number)) {
          mask[v] = c;
          coord[v] = ((creases.coord as Float32Array)[v] as number) * (1 / HAND_RELIEF_PHASES);
        }
      }
      return { mask, coord };
    }),
};

/** The hands' and feet's layers in stack order. */
export const AREA_SKIN_LAYERS: readonly SkinLayer[] = [
  ...HAND_SKIN_LAYERS.map((l) => {
    if (l === PALMOPLANTAR_LAYER) return SOLE_PALMOPLANTAR_LAYER;
    if (l === DIGIT_LAYER) return DIGIT_AND_TOENAIL_LAYER;
    if (l === HAND_RELIEF_LAYER) return RELIEF_AND_TOE_LAYER;
    if (l === NAIL_GLOSS_LAYER) return NAIL_AND_TOENAIL_GLOSS_LAYER;
    return l;
  }),
  ...FOOT_SKIN_LAYERS,
];
