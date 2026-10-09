/**
 * The skin layer stack, applied in this order. Each area of the body adds its
 * layers in its own file and one entry here.
 */
import type { SkinLayer } from "../layers.ts";
import { AREOLA_LAYER, FLUSH_LAYER, LIPS_LAYER } from "./rest.ts";
import { GOOSEBUMP_LAYER } from "./states.ts";

export const SKIN_LAYERS: readonly SkinLayer[] = [
  FLUSH_LAYER,
  LIPS_LAYER,
  AREOLA_LAYER,
  GOOSEBUMP_LAYER,
];

/** Every target the stack's fields are measured from; the packer puts them in the core file. */
export const SKIN_LAYER_TARGETS: readonly string[] = [
  ...new Set(SKIN_LAYERS.flatMap((l) => l.targets)),
];

export { AREOLA_LAYER, FLUSH_LAYER, GOOSEBUMP_LAYER, LIPS_LAYER };
