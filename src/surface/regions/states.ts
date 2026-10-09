/**
 * The skin layers the state signals drive (docs/ARCHITECTURE.md, "Skin
 * states"), appended to the rest layers (`rest.ts`). Each magnitude cites its
 * source in docs/research/SKIN-STATES.md or is marked there as a choice.
 *
 * Goosebumps are the first: `cold` and `fear`, as procedural relief on
 * hair-bearing skin.
 */
import type { DetailLayer } from "../layers.ts";
import { diskMask } from "../layers.ts";
import { skinZones } from "./skinZones.ts";

const unit = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The height of a fully raised papule, metres: the larger of the two episodes
 * Kim et al. 2014 measured on a forearm (145 and 194 µm, SKIN-STATES.md B1).
 * The signal scales the height, so 0.75 is the smaller measured papule.
 */
export const GOOSEBUMP_HEIGHT = 194e-6;

/**
 * Papules per cm²: a papule rises at every follicle, and follicle density runs
 * from 14 per cm² (calf) to 32 (upper arm) (Otberg et al. 2004, quoted by
 * McPhetres et al. 2024). 21 is the geometric mean of the two extremes; one
 * density for the whole body, since the shader's bumps have one spacing per layer.
 */
export const GOOSEBUMP_DENSITY_PER_CM2 = 21;

/** Spacing of one bump per cell at that density, metres (about 2.2 mm). */
const GOOSEBUMP_SPACING = 0.01 / Math.sqrt(GOOSEBUMP_DENSITY_PER_CM2);

/**
 * Where goosebumps can rise: skin with hair follicles and arrector pili. The
 * measured sites are arm, thigh and calf (back and trunk by follicle density).
 * Left out: the palms and soles (glabrous), the areola (smooth muscle wrinkles
 * it, which the cold state morph draws), and the lips and face, which are
 * inside the head zone (no goosebumps are observed there). The base mesh's
 * body carries no genital skin; the adult anatomy pack paints its own layers.
 */
function hairBearing(assets: Parameters<DetailLayer["fields"]>[0]): Float32Array {
  const zones = skinZones(assets);
  const head = zones.zone("head");
  const areola = diskMask(assets, ["breast/nipple-size-incr"]);
  const out = new Float32Array(assets.manifest.vertexCount);
  for (let v = 0; v < out.length; v++)
    out[v] =
      (1 - (head[v] as number)) *
      (1 - (zones.palm[v] as number)) *
      (1 - (zones.sole[v] as number)) *
      (1 - (areola[v] as number));
  return out;
}

/**
 * Goosebumps (piloerection), from `cold` and `fear`: both are valid triggers
 * (SKIN-STATES.md B1), and two triggers raise a follicle if either does.
 */
export const GOOSEBUMP_LAYER: DetailLayer = {
  id: "goosebumps",
  kind: "detail",
  pattern: "bumps",
  targets: ["breast/nipple-size-incr"],
  fields: (assets) => ({ mask: hairBearing(assets), coord: null }),
  paint: ({ signals }) => ({
    strength: 1 - (1 - unit(signals.cold ?? 0)) * (1 - unit(signals.fear ?? 0)),
    height: GOOSEBUMP_HEIGHT,
    size: GOOSEBUMP_SPACING,
  }),
};
