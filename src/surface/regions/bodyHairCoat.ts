/**
 * Body hair's coat regions (docs/ARCHITECTURE.md, "The coat"): the dense,
 * short terminal hair that stands off the skin, drawn as shells. The beard in
 * three parts a style grows or leaves (the moustache, the chin, and the cheeks
 * with the sideburns and the throat), the trunk's chest, abdomen and back, and
 * the adult-only armpits.
 * Their paint is the body hair model's (`bodyHairCoverage`, `bodyHairColour`),
 * so age, sex and the recipe's multipliers move them as they move the strands.
 *
 * The beard's masks follow the face's own lines, measured from the base mesh's
 * landmarks (the lips, the chin, the eyes, the ears' front): its upper edge is
 * the cheek line, from the nose's base curving up to the sideburns; its back
 * edge runs down in front of the ear and along the jaw's angle; its lower edge
 * is the neckline, low on the throat and rising toward the jaw's angle. Every
 * edge eases over most of a centimetre, and the parts share the area by soft
 * weights that sum to it, so no style has a cut edge. The exact lines are
 * choices.
 */
import type { HumanoidAssets } from "../../format/assetFormat.ts";
import { jointPosition } from "../../format/assetFormat.ts";
import {
  type BeardStyle,
  BODY_HAIR_FIBRE,
  type BodyHairGroup,
  beardStyle,
  bodyHairColour,
  bodyHairCoverage,
} from "../bodyHair.ts";
import type { CoatPaint, CoatRegion } from "../coat.ts";
import { hairAlbedo } from "../hairTone.ts";
import type { SkinPaintInput } from "../layers.ts";
import { BODY_HAIR_DENSITY, bodyHairInput, bodyHairMasks } from "./bodyHair.ts";
import { MOUTH_INTERIOR_LAYER } from "./mouth.ts";
import { LIPS_LAYER } from "./rest.ts";
import { skinZones } from "./skinZones.ts";

const unit = (x: number) => Math.min(1, Math.max(0, x));
const ramp = (lo: number, hi: number, x: number) => {
  const t = unit((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** The beard's parts: the cheeks include the sideburns and the throat under the jaw. */
export type BeardPart = "moustache" | "chin" | "cheeks";

/**
 * How long each beard style grows each part, metres (0: shaven). Stubble is a
 * few days' growth at about 0.3 mm a day; the grown lengths are choices, and a
 * full beard's coat is its dense base, under the cards that give its length.
 */
export const BEARD_LENGTHS: Readonly<Record<BeardStyle, Readonly<Record<BeardPart, number>>>> = {
  none: { moustache: 0, chin: 0, cheeks: 0 },
  stubble: { moustache: 0.0015, chin: 0.0015, cheeks: 0.0015 },
  moustache: { moustache: 0.012, chin: 0, cheeks: 0 },
  goatee: { moustache: 0.012, chin: 0.015, cheeks: 0 },
  full: { moustache: 0.012, chin: 0.015, cheeks: 0.012 },
};

/** Per vertex, `f(|x|, y, z, v)` (the face is symmetric about x = 0). */
function field(
  assets: HumanoidAssets,
  f: (ax: number, y: number, z: number, v: number) => number,
): Float32Array {
  const P = assets.positions;
  const out = new Float32Array(assets.manifest.vertexCount);
  for (let v = 0; v < out.length; v++)
    out[v] = unit(
      f(Math.abs(P[v * 3] as number), P[v * 3 + 1] as number, P[v * 3 + 2] as number, v),
    );
  return out;
}

const beardCache = new WeakMap<HumanoidAssets, Record<BeardPart, Float32Array>>();

/** The beard's area by part, per base vertex. */
export function beardMasks(assets: HumanoidAssets): Record<BeardPart, Float32Array> {
  const known = beardCache.get(assets);
  if (known) return known;
  const at = (joint: string) => {
    const p = new Float32Array(3);
    jointPosition(assets, assets.positions, joint, p, 0);
    return p;
  };
  const zones = skinZones(assets);
  const head = zones.zone("head");
  const lips = LIPS_LAYER.fields(assets).mask;
  // The mouth's lining, which no hair grows on.
  const mouth = MOUTH_INTERIOR_LAYER.fields(assets).mask;
  const eyeY = at("eye.L____head")[1] as number;
  const lipY = at("oris05____head")[1] as number;
  const lowY = at("oris01____head")[1] as number;
  const chinY = at("special04____tail")[1] as number;
  const noseBase = lipY + 0.017;
  // The lips' mask is a target's outline, sharp at the mouth's corners; the
  // beard keeps off them by distance from the lips instead, over 6 mm.
  const P = assets.positions;
  const lipVerts: number[] = [];
  lips.forEach((m, v) => {
    if (m > 0.5) lipVerts.push(v);
  });
  const fromLips = (v: number) => {
    let d = Number.POSITIVE_INFINITY;
    for (const u of lipVerts)
      d = Math.min(
        d,
        Math.hypot(
          (P[v * 3] as number) - (P[u * 3] as number),
          (P[v * 3 + 1] as number) - (P[u * 3 + 1] as number),
          (P[v * 3 + 2] as number) - (P[u * 3 + 2] as number),
        ),
      );
    return d;
  };
  // The whole beard, then its parts as shares of it.
  const area = field(assets, (ax, y, z, v) => {
    // The cheek line: from the nose's base, curving up to the sideburns' top.
    const top = noseBase + (eyeY - 0.012 - noseBase) * ramp(0.02, 0.068, ax);
    // In front of the ear, then back along the jaw's angle below it.
    const back = 0.035 + 0.043 * ramp(0.6, 0.69, y);
    // The neckline: low on the throat, rising toward the jaw's angle.
    const bottom = chinY - 0.045 + 0.04 * ramp(0, 0.07, ax);
    const face = unit((head[v] as number) + (zones.neck[v] as number));
    // Under the jaw the mesh's edges run to 15 mm, so its lines ease over about
    // twice that: a beard's edges there are a thinning, not a line.
    const beard =
      face *
      (1 - ramp(top - 0.01, top + 0.01, y)) *
      ramp(back - 0.012, back + 0.012, z) *
      ramp(bottom - 0.02, bottom + 0.02, y);
    // The distance search runs only where there is beard to keep off the lips.
    return beard > 0 ? beard * ramp(0.001, 0.007, fromLips(v)) * (1 - (mouth[v] as number)) : 0;
  });
  // The parts' shares change over a centimetre or more, so a style that grows
  // one part and not its neighbour thins out between them rather than stopping.
  const moustacheShare = (ax: number, y: number) =>
    ramp(lipY - 0.01, lipY + 0.004, y) * (1 - ramp(0.022, 0.044, ax));
  const chinShare = (ax: number, y: number, z: number) =>
    (1 - ramp(lowY - 0.008, lowY + 0.006, y)) * (1 - ramp(0.026, 0.052, ax)) * ramp(0.06, 0.12, z);
  const moustache = field(assets, (ax, y, _z, v) => (area[v] as number) * moustacheShare(ax, y));
  const chin = field(
    assets,
    (ax, y, z, v) => (area[v] as number) * (1 - moustacheShare(ax, y)) * chinShare(ax, y, z),
  );
  const cheeks = field(assets, (_ax, _y, _z, v) =>
    Math.max(0, (area[v] as number) - (moustache[v] as number) - (chin[v] as number)),
  );
  const out = { moustache, chin, cheeks };
  beardCache.set(assets, out);
  return out;
}

/** How far each kind of hair lies along the comb: stubble stands, grown hair lies. Choices. */
const LIE = { stubble: 0.15, grown: 0.6, trunk: 0.75 } as const;

/** A coat region of the body hair model's `group`, grown at `length` (0: none). */
/**
 * Whether the recipe asks for a coat region at all. For now (2026-10-09, while
 * the coat's shading is reworked) the coat is off unless the recipe enables it:
 * the beard by a style other than none, any other group by setting its density.
 * A recipe that says nothing of body hair draws no coat.
 */
export function coatEnabled(group: BodyHairGroup, input: SkinPaintInput): boolean {
  if (group === "face") return (input.bodyHair?.beard ?? "none") !== "none";
  return input.bodyHair?.density?.[group] !== undefined;
}

function paintOf(
  group: BodyHairGroup,
  input: SkinPaintInput,
  length: number,
  lie: number,
): CoatPaint {
  const hair = bodyHairInput(input);
  const fibre = BODY_HAIR_FIBRE[group];
  return {
    cover: length > 0 && coatEnabled(group, input) ? bodyHairCoverage(group, hair) : 0,
    length: length > 0 ? length : fibre.length,
    density: BODY_HAIR_DENSITY[group],
    lie,
    width: fibre.diameter,
    colour: hairAlbedo(bodyHairColour(group, hair)),
  };
}

const LIPS_TARGETS = LIPS_LAYER.targets;

function beardRegion(part: BeardPart): CoatRegion {
  return {
    id: `beard-${part}`,
    targets: LIPS_TARGETS,
    mask: (assets) => beardMasks(assets)[part],
    paint: (input) => {
      const length = BEARD_LENGTHS[beardStyle(bodyHairInput(input))][part];
      return paintOf("face", input, length, length <= 0.002 ? LIE.stubble : LIE.grown);
    },
  };
}

function trunkRegion(group: "chest" | "abdomen" | "back"): CoatRegion {
  return {
    id: `hair-${group}`,
    targets: [...LIPS_TARGETS, "breast/nipple-size-incr"],
    mask: (assets) => bodyHairMasks(assets)[group],
    paint: (input) => paintOf(group, input, BODY_HAIR_FIBRE[group].length, LIE.trunk),
  };
}

/**
 * Axillary hair: dense and a couple of centimetres long, so the coat's. Adult
 * only under the age policy: `paintCoat` paints it only for an input that says
 * the figure is an adult, and the body hair model gives it no coverage under 18.
 */
const AXILLARY_REGION: CoatRegion = {
  id: "hair-axillary",
  targets: [...LIPS_TARGETS, "breast/nipple-size-incr"],
  adultOnly: true,
  mask: (assets) => bodyHairMasks(assets).axillary,
  paint: (input) => paintOf("axillary", input, BODY_HAIR_FIBRE.axillary.length, LIE.grown),
};

/** Body hair's coat: the beard's three parts, the trunk's dense hair and the armpits'. */
export const BODY_HAIR_COAT: readonly CoatRegion[] = [
  beardRegion("moustache"),
  beardRegion("chin"),
  beardRegion("cheeks"),
  trunkRegion("chest"),
  trunkRegion("abdomen"),
  trunkRegion("back"),
  AXILLARY_REGION,
];
