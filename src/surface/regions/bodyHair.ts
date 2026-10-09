/**
 * Body hair on the skin (docs/ARCHITECTURE.md, "Body hair"): vellus everywhere
 * at every age, and the sparse, fine terminal hair of the body where
 * `bodyHairCoverage` says, both drawn as strand layers in the shader. Dense
 * short hair (stubble, a dense chest) is the coat's, long hair (a grown beard)
 * the hair cards', and pubic hair the adult pack's.
 *
 * The masks are measured from the base mesh alone, like the skin states'
 * zones: the skeleton's skin weights (`skinZones`), the vertex normals, and the
 * armpits' hollows. Their exact edges are choices; where hair grows is the
 * Ferriman-Gallwey regions' (docs/research/BODY-HAIR.md).
 *
 * The axillary layer is adult-only: `paintStopTable` paints it at zero unless
 * the input says the figure is an adult, and the body hair model gives it no
 * coverage under 18 either way.
 */
import type { HumanoidAssets } from "../../format/assetFormat.ts";
import { groupFaces } from "../../format/assetFormat.ts";
import {
  BODY_HAIR_FIBRE,
  type BodyHairGroup,
  type BodyHairInput,
  bodyHairColour,
  bodyHairCoverage,
} from "../bodyHair.ts";
import { DEFAULT_HAIR_COLOUR, hairAlbedo } from "../hairTone.ts";
import type { SkinLayer, SkinPaintInput, StrandLayer, StrandPaint } from "../layers.ts";
import { diskMask } from "../layers.ts";
import { LIPS_LAYER } from "./rest.ts";
import { skinZones } from "./skinZones.ts";

const unit = (x: number) => Math.min(1, Math.max(0, x));
const ramp = (lo: number, hi: number, x: number) => {
  const t = unit((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** The age a layer paints for when the input gives none: a young adult, as other age-dependent layers. */
const DEFAULT_AGE = 25;

/** The body hair model's input from a layer's paint input. */
export function bodyHairInput(input: SkinPaintInput): BodyHairInput {
  return {
    age: input.age ?? DEFAULT_AGE,
    gender: input.gender ?? 0.5,
    colour: input.hairColour ?? DEFAULT_HAIR_COLOUR,
    ...(input.bodyHair && { bodyHair: input.bodyHair }),
  };
}

/**
 * Follicles per cm² by region group. Otberg et al. 2004 measured 14 (calf) to
 * 32 (upper arm); the values between, and the beard's, armpit's and pubis's,
 * are choices (BODY-HAIR.md).
 */
export const BODY_HAIR_DENSITY: Readonly<Record<BodyHairGroup, number>> = {
  face: 60,
  chest: 22,
  abdomen: 22,
  back: 26,
  buttocks: 20,
  arms: 25,
  legs: 16,
  axillary: 60,
  pubic: 40,
};

/**
 * Vellus: fine, short, nearly unpigmented hair from most follicles at every
 * age. Diameter about 30 µm and length about 2 mm, a choice in the range
 * vellus is defined by (under 30 µm, under 2 mm); 50 follicles per cm², a
 * choice between the body's 14 to 32 and the forehead's far higher count.
 */
export const VELLUS = { density: 50, length: 0.002, width: 30e-6, height: 20e-6 } as const;

interface Landmarks {
  armpit: { L: Float32Array; R: Float32Array };
}

const landmarkCache = new WeakMap<HumanoidAssets, Landmarks>();

/** The base mesh's landmarks for the body hair masks, measured on first use. */
function landmarks(assets: HumanoidAssets): Landmarks {
  const known = landmarkCache.get(assets);
  if (known) return known;
  const P = assets.positions;
  const zones = skinZones(assets);
  const upperArm = zones.zone("upperArm");
  const trunk = zones.zone("upperTrunk");
  const breast = zones.zone("breast");
  const body = bodyVertices(assets);
  // An armpit: the centre of the skin facing down where arm and trunk share weight.
  const armpit = (side: number) => {
    const c = new Float32Array(3);
    let n = 0;
    for (const v of body) {
      if (Math.sign(P[v * 3] as number) !== side) continue;
      const u = upperArm[v] as number;
      if (
        u > 0.25 &&
        u < 0.75 &&
        (trunk[v] as number) + (breast[v] as number) > 0.2 &&
        (zones.normals[v * 3 + 1] as number) < -0.2
      ) {
        for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (P[v * 3 + k] as number);
        n++;
      }
    }
    return c.map((x) => (n ? x / n : x));
  };
  const out: Landmarks = { armpit: { L: armpit(1), R: armpit(-1) } };
  landmarkCache.set(assets, out);
  return out;
}

/** The vertices of the drawn body (the base mesh's `body` group). */
function bodyVertices(assets: HumanoidAssets): Set<number> {
  const out = new Set<number>();
  for (const f of groupFaces(assets, "body"))
    for (let k = 0; k < 4; k++) out.add(assets.faceVerts[f * 4 + k] as number);
  return out;
}

/** Per vertex, `f(x, y, z, v)`. */
function field(
  assets: HumanoidAssets,
  f: (x: number, y: number, z: number, v: number) => number,
): Float32Array {
  const P = assets.positions;
  const out = new Float32Array(assets.manifest.vertexCount);
  for (let v = 0; v < out.length; v++)
    out[v] = unit(f(P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number, v));
  return out;
}

/** The lips, from the lips layer's own mask, where no hair grows. */
const lipsMask = (assets: HumanoidAssets) => LIPS_LAYER.fields(assets).mask;

/** Skin with no hair follicles: the lips, the palms and the soles. */
function glabrous(assets: HumanoidAssets): Float32Array {
  const zones = skinZones(assets);
  const lips = lipsMask(assets);
  return field(assets, (_x, _y, _z, v) =>
    Math.max(lips[v] as number, zones.palm[v] as number, zones.sole[v] as number),
  );
}

/** Each armpit's hair, a soft disk round the hollow under the arm. */
function axillaryMask(assets: HumanoidAssets): Float32Array {
  const { L, R } = landmarks(assets).armpit;
  return field(assets, (x, y, z) => {
    const c = x >= 0 ? L : R;
    const d = Math.hypot(x - (c[0] as number), y - (c[1] as number), z - (c[2] as number));
    return 1 - ramp(0.03, 0.05, d);
  });
}

/**
 * Terminal hair masks by group, for the groups drawn as strand layers: the
 * beard is the coat's and the cards', and pubic hair the adult pack's.
 */
export function bodyHairMasks(assets: HumanoidAssets) {
  const zones = skinZones(assets);
  const z = (name: Parameters<typeof zones.zone>[0]) => zones.zone(name);
  const front = zones.front;
  const areola = diskMask(assets, ["breast/nipple-size-incr"]);
  const axillary = axillaryMask(assets);
  const gl = glabrous(assets);
  const notGlabrous = (v: number) => 1 - (gl[v] as number);
  const notAdultOnly = (v: number) => 1 - (axillary[v] as number);
  // Zone weights are soft and reach far past a zone's middle; a group's mask is
  // cut off where its zones' weight falls under 0.2, so its support (and its
  // share of the field atlas) ends near its own region.
  const solid = (w: number) => ramp(0.2, 0.5, w);
  const chest = field(
    assets,
    (x, _y, _z, v) =>
      solid(((z("upperTrunk")[v] as number) + (z("breast")[v] as number)) * (front[v] as number)) *
      (1 - ramp(0.07, 0.15, Math.abs(x))) *
      (1 - (areola[v] as number)) *
      notAdultOnly(v),
  );
  // The linea (the midline below the navel) carries hair first and most.
  const abdomen = field(
    assets,
    (x, _y, _z, v) =>
      solid(((z("lowerTrunk")[v] as number) + (z("pelvis")[v] as number)) * (front[v] as number)) *
      Math.max(1 - ramp(0.012, 0.035, Math.abs(x)), 0.6 * (1 - ramp(0.06, 0.13, Math.abs(x)))) *
      notAdultOnly(v),
  );
  const back = field(
    assets,
    (_x, _y, _z, v) =>
      solid(
        ((z("upperTrunk")[v] as number) + (z("lowerTrunk")[v] as number)) *
          (1 - (front[v] as number)),
      ) * notAdultOnly(v),
  );
  const buttocks = field(
    assets,
    (_x, _y, _z, v) =>
      solid((z("pelvis")[v] as number) * (1 - (front[v] as number))) * notAdultOnly(v),
  );
  // The hands' backs and the feet's tops carry little terminal hair, and the
  // hand and foot lanes' layers crowd the atlas there, so limbs stop short of them.
  const arms = field(
    assets,
    (_x, _y, _z, v) =>
      solid((z("upperArm")[v] as number) + (z("forearm")[v] as number)) *
      (1 - ramp(0.2, 0.5, z("hand")[v] as number)) *
      notAdultOnly(v),
  );
  const legs = field(
    assets,
    (_x, _y, _z, v) =>
      solid((z("thigh")[v] as number) + (z("shin")[v] as number)) *
      (1 - ramp(0.2, 0.5, z("foot")[v] as number)) *
      notGlabrous(v) *
      notAdultOnly(v),
  );
  return { chest, abdomen, back, buttocks, arms, legs, axillary };
}

type MaskName = keyof ReturnType<typeof bodyHairMasks>;

const maskCache = new WeakMap<HumanoidAssets, ReturnType<typeof bodyHairMasks>>();
const masksOf = (assets: HumanoidAssets) => {
  let m = maskCache.get(assets);
  if (!m) {
    m = bodyHairMasks(assets);
    maskCache.set(assets, m);
  }
  return m;
};

/** What a terminal strand layer paints for a group, with the length it is worn at. */
function terminalPaint(group: BodyHairGroup, input: SkinPaintInput, length: number): StrandPaint {
  const hair = bodyHairInput(input);
  const fibre = BODY_HAIR_FIBRE[group];
  const coverage = length > 0 ? bodyHairCoverage(group, hair) : 0;
  return {
    strength: coverage,
    colour: hairAlbedo(bodyHairColour(group, hair)),
    density: BODY_HAIR_DENSITY[group],
    length: length > 0 ? length : fibre.length,
    width: fibre.diameter,
    height: fibre.diameter,
  };
}

const LIPS_TARGETS = LIPS_LAYER.targets;
const AREOLA_TARGETS = ["breast/nipple-size-incr"];

function terminalLayer(
  id: string,
  mask: MaskName,
  group: BodyHairGroup,
  extra: Partial<Pick<StrandLayer, "adultOnly">> = {},
): StrandLayer {
  return {
    id,
    kind: "strands",
    targets: [...LIPS_TARGETS, ...AREOLA_TARGETS],
    ...extra,
    fields: (assets) => ({ mask: masksOf(assets)[mask], coord: null }),
    paint: (input) => terminalPaint(group, input, BODY_HAIR_FIBRE[group].length),
  };
}

/**
 * Vellus at every age: pale, fine and short. It lies on all the skin
 * (`everywhere`), so it costs no channel of the field atlas; on the lips,
 * palms and soles, which have none, a strand 30 µm wide and 2 mm long is far
 * below what any view resolves. Its glow against the light is the skin
 * material's sheen, and its mean colour is in the measured skin albedo
 * (`inSkinAlbedo`); this layer is its strands and fine relief up close.
 */
export const VELLUS_LAYER: StrandLayer = {
  id: "vellus",
  kind: "strands",
  everywhere: true,
  targets: [],
  fields: (assets) => ({
    mask: new Float32Array(assets.manifest.vertexCount).fill(1),
    coord: null,
  }),
  paint: (input) => {
    // Vellus carries a trace of the figure's pigment: a fifth of its eumelanin.
    const c = bodyHairInput(input).colour;
    return {
      strength: 1,
      colour: hairAlbedo({ ...c, eumelanin: c.eumelanin * 0.2, pheomelanin: c.pheomelanin * 0.2 }),
      density: VELLUS.density,
      length: VELLUS.length,
      width: VELLUS.width,
      height: VELLUS.height,
      // Every measured skin colour was measured with its vellus.
      inSkinAlbedo: true,
    };
  },
};

/**
 * Terminal body hair drawn as strands, by group: the sparse, fine hair lying
 * on the limbs and buttocks, and the armpit's (adult-only). The beard and the
 * trunk's hair stand off the skin and are dense, so they are the coat's
 * (`BODY_HAIR_COAT`), long hair the cards', and pubic hair the adult pack's.
 */
export const TERMINAL_HAIR_LAYERS: readonly StrandLayer[] = [
  terminalLayer("hair-buttocks", "buttocks", "buttocks"),
  terminalLayer("hair-arms", "arms", "arms"),
  terminalLayer("hair-legs", "legs", "legs"),
  terminalLayer("hair-axillary", "axillary", "axillary", { adultOnly: true }),
];

/** Every body hair layer, in stack order: vellus, then terminal hair. */
export const BODY_HAIR_LAYERS: readonly SkinLayer[] = [VELLUS_LAYER, ...TERMINAL_HAIR_LAYERS];
