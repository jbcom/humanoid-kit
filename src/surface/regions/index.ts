/**
 * The skin layer stack, applied in this order. Each area of the body adds its
 * layers in its own file and one entry here; the adult anatomy's layers follow
 * every body layer.
 */
import { isAdultLayer, type SkinLayer } from "../layers.ts";
import { MOUND_LAYER, PENIS_LAYER, TESTES_LAYER } from "./adult.ts";
import { HAND_SKIN_LAYERS } from "./hands.ts";
import { AREOLA_LAYER, FLUSH_LAYER, LIPS_LAYER } from "./rest.ts";
import {
  BLUSH_LAYER,
  COLD_PALLOR_LAYER,
  EXERTION_FLUSH_LAYER,
  FEAR_PALLOR_LAYER,
  GOOSEBUMP_LAYER,
  HEAT_FLUSH_LAYER,
  LIP_STATE_LAYER,
  SWEAT_EXERCISE_LAYER,
  SWEAT_REST_LAYER,
} from "./states.ts";

/**
 * The layers whose data is in the body pack: the rest layers, the areas'
 * layers (the hands'), then the state layers, so a state (cold pallor, a
 * flush) acts on the areas' colour too.
 */
const BODY_SKIN_LAYERS: readonly SkinLayer[] = [
  FLUSH_LAYER,
  LIPS_LAYER,
  AREOLA_LAYER,
  ...HAND_SKIN_LAYERS,
  GOOSEBUMP_LAYER,
  HEAT_FLUSH_LAYER,
  EXERTION_FLUSH_LAYER,
  BLUSH_LAYER,
  COLD_PALLOR_LAYER,
  FEAR_PALLOR_LAYER,
  LIP_STATE_LAYER,
  SWEAT_REST_LAYER,
  SWEAT_EXERCISE_LAYER,
];

/**
 * The adult anatomy's layers (colour code in the core, data in the adult pack;
 * gated by age and anatomy in `paintStopTable`).
 */
export const ADULT_SKIN_LAYERS: readonly SkinLayer[] = [PENIS_LAYER, TESTES_LAYER, MOUND_LAYER];

export const SKIN_LAYERS: readonly SkinLayer[] = [...BODY_SKIN_LAYERS, ...ADULT_SKIN_LAYERS];

const targetsOf = (layers: readonly SkinLayer[]): string[] => [
  ...new Set(layers.flatMap((l) => l.targets)),
];

/**
 * Every target the body layers' fields are measured from; the packer puts them
 * in the core file. Never an adult layer's: an adult layer names none (the
 * adult pack's manifest does, `AdultAnatomySpec.skinLayers`).
 */
export const SKIN_LAYER_TARGETS: readonly string[] = targetsOf(
  SKIN_LAYERS.filter((l) => !isAdultLayer(l)),
);

export * from "./hands.ts";
export * from "./rest.ts";
export * from "./skinZones.ts";
export * from "./states.ts";
export { MOUND_LAYER, PENIS_LAYER, TESTES_LAYER };
