/**
 * The skin layers the state signals drive (docs/ARCHITECTURE.md, "Skin
 * states"), appended to the rest layers (`rest.ts`). Each magnitude cites its
 * source in docs/research/SKIN-STATES.md Part C or is marked there as a choice.
 *
 * Goosebumps (`cold`, `fear`): procedural relief on hair-bearing skin. Flush and
 * pallor (`blush`, `exertion`, `heat`, `fear`, `cold`): colour moved along the
 * skin model's haemoglobin axis, by region.
 */
import type { HumanoidAssets } from "../../format/assetFormat.ts";
import type { ColourLayer, DetailLayer, SurfaceLayer } from "../layers.ts";
import { diskMask, targetMask } from "../layers.ts";
import { haemoglobinRatio, lipStateAlbedo } from "../skinTone.ts";
import { LIPS_LAYER } from "./rest.ts";
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
function hairBearing(assets: HumanoidAssets): Float32Array {
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

/**
 * How far each state moves the skin's haemoglobin, in units of the measured
 * axis (the whole pale-to-ruddy spread between people, 1; a* of about 5 on light
 * skin). No measurement of a flush's size at any skin tone exists (SKIN-STATES.md
 * B2), so these are CHOICES, bounded by the axis: a state never moves the skin
 * past the spread people already have (a blush is the whole axis). They are as
 * large as that bound lets them be and still read at the distance of a
 * full-length figure. Stephen et al. 2009 found raters prefer faces 2.4 a*
 * redder, about half the axis: a flush the face shows is more than that.
 */
export const FLUSH_DELTA = {
  blush: 1,
  exertion: 0.8,
  heat: 0.6,
  fear: -0.7,
  cold: -0.6,
} as const;

/** The strongest of several zones, each at its own weight (0..1). */
function strongest(n: number, zones: readonly (readonly [Float32Array, number])[]): Float32Array {
  const out = new Float32Array(n);
  for (const [zone, weight] of zones)
    for (let v = 0; v < n; v++) out[v] = Math.max(out[v] as number, (zone[v] as number) * weight);
  return out;
}

const CHEEKS = ["cheek/l-cheek-volume-incr", "cheek/r-cheek-volume-incr"];
const EARS = ["ears/l-ear-scale-incr", "ears/r-ear-scale-incr"];
const NOSE = ["nose/nose-volume-incr"];
/** Cheeks, ears and nose as `FLUSH_LAYER` masks them: where the face's thin, vascular skin is. */
const facial = (assets: HumanoidAssets, targets: readonly string[]) =>
  targetMask(assets, targets, 0.05, 0.7);

/** The front of the chest, the neck's base downward: where a flush spreads from the face. */
function chest(assets: HumanoidAssets): Float32Array {
  const zones = skinZones(assets);
  const upper = zones.zone("upperTrunk");
  const breast = zones.zone("breast");
  return Float32Array.from(
    upper,
    (u, v) => (u + (breast[v] as number)) * (zones.front[v] as number),
  );
}

/** A multiply layer that moves the skin's haemoglobin by `delta` where `zone` lies. */
function haemoglobinLayer(
  id: string,
  signal: keyof typeof FLUSH_DELTA,
  targets: readonly string[],
  zone: (assets: HumanoidAssets) => Float32Array,
): ColourLayer {
  return {
    id,
    blend: "multiply",
    targets,
    fields: (assets) => ({ mask: zone(assets), coord: null }),
    paint: ({ tone, signals }) => ({
      strength: unit(signals[signal] ?? 0),
      stops: [haemoglobinRatio(tone, FLUSH_DELTA[signal])],
    }),
  };
}

/**
 * Blush (`blush`): cheeks and ears at full strength, the forehead and neck
 * less, the chest less again. Cheeks and forehead go deeper red in a compliment
 * blush (Front Hum Neurosci 2017, B2); ears, neck and chest are CHOICES from
 * where the face's flush spreads.
 */
export const BLUSH_LAYER = haemoglobinLayer("blush", "blush", [...CHEEKS, ...EARS], (assets) => {
  const zones = skinZones(assets);
  return strongest(assets.manifest.vertexCount, [
    [facial(assets, [...CHEEKS, ...EARS]), 1],
    [zones.forehead, 0.7],
    [zones.neck, 0.8],
    [chest(assets), 0.5],
  ]);
});

/**
 * Exertion (`exertion`): the whole face, the neck and the chest, where an
 * exercising person's blood flow shows (CHOICE; regional differences in the
 * cutaneous vasodilation of exercise are Kondo et al. 1998, cited in B6).
 */
export const EXERTION_FLUSH_LAYER = haemoglobinLayer("exertion-flush", "exertion", [], (assets) => {
  const zones = skinZones(assets);
  return strongest(assets.manifest.vertexCount, [
    [zones.zone("head"), 1],
    [zones.neck, 0.8],
    [chest(assets), 0.7],
  ]);
});

/**
 * Heat (`heat`): the whole body, since heat vasodilates the skin everywhere
 * (CHOICE; the sweat map, `SWEAT_LAYER`, carries the regional detail).
 */
export const HEAT_FLUSH_LAYER = haemoglobinLayer("heat-flush", "heat", [], (assets) =>
  new Float32Array(assets.manifest.vertexCount).fill(1),
);

/** Fear (`fear`): the face and neck blanch, as blood is drawn from them (B2: facial blood flow falls with fright). */
export const FEAR_PALLOR_LAYER = haemoglobinLayer("fear-pallor", "fear", [], (assets) => {
  const zones = skinZones(assets);
  return strongest(assets.manifest.vertexCount, [
    [zones.zone("head"), 1],
    [zones.neck, 0.8],
  ]);
});

/**
 * Cold (`cold`): the extremities blanch first and most: hands, feet, ears and
 * nose, the forearms, shins and cheeks less (CHOICE: vasoconstriction is
 * strongest in acral skin).
 */
export const COLD_PALLOR_LAYER = haemoglobinLayer(
  "cold-pallor",
  "cold",
  [...CHEEKS, ...EARS, ...NOSE],
  (assets) => {
    const zones = skinZones(assets);
    return strongest(assets.manifest.vertexCount, [
      [zones.zone("hand"), 1],
      [zones.zone("foot"), 1],
      [zones.zone("forearm"), 0.35],
      [zones.zone("shin"), 0.35],
      [facial(assets, [...EARS, ...NOSE]), 1],
      [facial(assets, CHEEKS), 0.5],
    ]);
  },
);

/**
 * The lips' colour under `cold` (bluer) and `fear` (paler), `lipStateAlbedo`,
 * mixed over the resting lips by the stronger signal. A colour that is not
 * human skin keeps its lips.
 */
export const LIP_STATE_LAYER: ColourLayer = {
  id: "lips-state",
  blend: "mix",
  targets: LIPS_LAYER.targets,
  fields: LIPS_LAYER.fields,
  paint: ({ tone, lips, signals }) => {
    const cold = unit(signals.cold ?? 0);
    const fear = unit(signals.fear ?? 0);
    const strength = tone.override ? 0 : Math.max(cold, fear);
    // The colour at full strength of whichever signals are present, in their proportion.
    return {
      strength,
      stops: [
        lipStateAlbedo(tone, lips, strength ? cold / strength : 0, strength ? fear / strength : 0),
      ],
    };
  },
};

/**
 * Local sweat rate, mg per cm² per minute, by region, for passive heating (a
 * whole-body rate of 0.4 L/h at a core temperature 0.6 °C up) and for exercise
 * (1.0 L/h at 2.2 °C up): the `[rest, exercise]` pairs of Taylor and
 * Machado-Moreira 2013, Table 4 (Extrem Physiol Med 2:4, CC BY; B6). The axilla,
 * which the skin weights do not separate, is left out.
 */
export const SWEAT_RATE = {
  head: [0.489, 2.45],
  chest: [0.393, 1.403],
  abdomen: [0.346, 1.053],
  back: [0.564, 1.658],
  buttocks: [0.4, 0.553],
  upperArm: [0.25, 0.606],
  forearm: [0.37, 0.927],
  handPalm: [0.312, 1.461],
  handDorsal: [0.495, 1.851],
  thigh: [0.179, 0.706],
  shin: [0.189, 0.886],
  footSole: [0.24, 0.464],
  footDorsal: [0.372, 0.932],
} as const;

/**
 * The forehead sweats about twice as much as the head as a whole at rest (0.99
 * against 0.489 mg/cm²/min, the abstract of the same paper); the same factor is
 * carried to exercise, where the paper has no forehead rate (CHOICE).
 */
const FOREHEAD_FACTOR = 0.99 / SWEAT_RATE.head[0];

/**
 * The rate at which sweat covers half the skin's surface, mg/cm²/min. CHOICE:
 * no measurement of the visible wetness or gloss of sweating skin was found
 * (SKIN-STATES.md B6). The sweat rate the paper reports for the whole head at
 * rest is about this.
 */
const WETNESS_HALF_RATE = 0.5;

/** How wet the surface is at a local rate: 0 dry, saturating toward 1. */
export const wetness = (rate: number) => rate / (rate + WETNESS_HALF_RATE);

/**
 * Roughness change at full wetness. A water film smooths the stratum corneum's
 * microrelief and fills its valleys (index matching); no measurement of the
 * size was found (SKIN-STATES.md B6), so it is a CHOICE tuned on the contact
 * sheets: well short of the 0.03 floor the shader clamps to.
 */
export const SWEAT_ROUGHNESS = -0.2;

/** Specular intensity added at full wetness (a film of water over skin): a CHOICE, as above. */
export const SWEAT_SPECULAR = 0.6;

/** Each zone's sweat rate at `column` (0 rest, 1 exercise), per base vertex, blended across the zones. */
function sweatRate(assets: HumanoidAssets, column: 0 | 1): Float32Array {
  const zones = skinZones(assets);
  const r = (name: keyof typeof SWEAT_RATE) => SWEAT_RATE[name][column];
  const n = assets.manifest.vertexCount;
  const zone = zones.zone;
  const head = zone("head");
  const neck = zone("neck");
  const breast = zone("breast");
  const upperTrunk = zone("upperTrunk");
  const lowerTrunk = zone("lowerTrunk");
  const pelvis = zone("pelvis");
  const upperArm = zone("upperArm");
  const forearm = zone("forearm");
  const hand = zone("hand");
  const thigh = zone("thigh");
  const shin = zone("shin");
  const foot = zone("foot");
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const front = zones.front[v] as number;
    const palm = zones.palm[v] as number;
    const sole = zones.sole[v] as number;
    const toward = (a: number, b: number, t: number) => b + (a - b) * t;
    const handRate = hand[v] as number;
    out[v] =
      ((head[v] as number) + (neck[v] as number)) *
        r("head") *
        (1 + (FOREHEAD_FACTOR - 1) * (zones.forehead[v] as number)) +
      ((breast[v] as number) + (upperTrunk[v] as number)) * toward(r("chest"), r("back"), front) +
      (lowerTrunk[v] as number) * toward(r("abdomen"), r("back"), front) +
      (pelvis[v] as number) * toward(r("abdomen"), r("buttocks"), front) +
      (upperArm[v] as number) * r("upperArm") +
      (forearm[v] as number) * r("forearm") +
      handRate * toward(r("handPalm"), r("handDorsal"), palm) +
      (thigh[v] as number) * r("thigh") +
      (shin[v] as number) * r("shin") +
      (foot[v] as number) * toward(r("footSole"), r("footDorsal"), sole);
  }
  return out;
}

/** A surface layer, wet where the sweat rate at `column` says. */
function sweatLayer(id: string, column: 0 | 1): SurfaceLayer {
  return {
    id,
    kind: "surface",
    targets: [],
    fields: (assets) => ({
      mask: sweatRate(assets, column).map(wetness),
      coord: null,
    }),
    paint: ({ signals }) => {
      const heat = unit(signals.heat ?? 0);
      const exertion = unit(signals.exertion ?? 0);
      // One sweat drive; the passive-heating map carries heat's share of it, the exercise map exertion's.
      const drive = 1 - (1 - heat) * (1 - exertion);
      const share = heat + exertion > 0 ? exertion / (heat + exertion) : 0;
      return {
        strength: drive * (column === 0 ? 1 - share : share),
        roughness: SWEAT_ROUGHNESS,
        specular: SWEAT_SPECULAR,
      };
    },
  };
}

/** Sweat sheen from `heat`, by the passive-heating sweat map. */
export const SWEAT_REST_LAYER = sweatLayer("sweat-heat", 0);

/** Sweat sheen from `exertion`, by the exercise sweat map, which is wetter and more even. */
export const SWEAT_EXERCISE_LAYER = sweatLayer("sweat-exertion", 1);
