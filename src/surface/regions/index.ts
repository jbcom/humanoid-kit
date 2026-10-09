/**
 * The skin layer stack, applied in this order. Each area of the body adds its
 * layers in its own file and one entry here.
 */
import type { SkinLayer } from "../layers.ts";
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

export const SKIN_LAYERS: readonly SkinLayer[] = [
  FLUSH_LAYER,
  LIPS_LAYER,
  AREOLA_LAYER,
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

/** Every target the stack's fields are measured from; the packer puts them in the core file. */
export const SKIN_LAYER_TARGETS: readonly string[] = [
  ...new Set(SKIN_LAYERS.flatMap((l) => l.targets)),
];

export {
  AREOLA_LAYER,
  BLUSH_LAYER,
  COLD_PALLOR_LAYER,
  EXERTION_FLUSH_LAYER,
  FEAR_PALLOR_LAYER,
  FLUSH_LAYER,
  GOOSEBUMP_LAYER,
  HEAT_FLUSH_LAYER,
  LIP_STATE_LAYER,
  LIPS_LAYER,
  SWEAT_EXERCISE_LAYER,
  SWEAT_REST_LAYER,
};
