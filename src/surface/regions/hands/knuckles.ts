/**
 * The knuckles: more melanin and a little more blood over the back of each
 * finger joint, and the slack skin's wrinkles there as arcs across the digit.
 * Every magnitude cites docs/research/SKIN-STATES.md Part C5 or is marked
 * there as a choice.
 */
import type { HumanoidAssets } from "../../../format/assetFormat.ts";
import { knuckleAlbedo } from "../../handTone.ts";
import type { ColourLayer, DetailLayer, SkinLayerFields } from "../../layers.ts";
import { skinZones } from "../skinZones.ts";
import { creaseWindow } from "./creases.ts";
import { clamp, handFrame, smoothstep } from "./frame.ts";

/**
 * The dorsal joints, per digit: which joint of `HandFrame.joints` (1 the
 * knuckle, 2 and 3 the interphalangeal joints), the pigment patch's radius
 * along the digit (metres) and weight, and the wrinkles: how many and their
 * weight. The middle joint's patch is the largest and most wrinkled (CHOICE,
 * from its appearance; no measurement of knuckle wrinkles was found).
 */
const KNUCKLES: readonly {
  joint: 1 | 2 | 3;
  radius: number;
  pigment: number;
  wrinkles: number;
  relief: number;
}[] = [
  { joint: 1, radius: 0.007, pigment: 0.7, wrinkles: 3, relief: 0.5 },
  { joint: 2, radius: 0.0065, pigment: 1, wrinkles: 5, relief: 1 },
  { joint: 3, radius: 0.0045, pigment: 0.8, wrinkles: 3, relief: 0.7 },
];
/** The thumb's: its metacarpophalangeal and interphalangeal joints. */
const THUMB_KNUCKLES: readonly {
  joint: 1 | 2 | 3;
  radius: number;
  pigment: number;
  wrinkles: number;
  relief: number;
}[] = [
  { joint: 2, radius: 0.007, pigment: 0.8, wrinkles: 3, relief: 0.6 },
  { joint: 3, radius: 0.006, pigment: 1, wrinkles: 4, relief: 0.9 },
];

/** Spacing of the knuckle wrinkles, metres (CHOICE). */
export const KNUCKLE_WRINKLE_SPACING = 0.0016;

/**
 * How far the wrinkles bow back from the joint across the digit, metres of
 * `along` per metre² of `across`: they are arcs round the knuckle, not
 * straight lines (CHOICE).
 */
const KNUCKLE_WRINKLE_BOW = 40;

/**
 * Phases the knuckle wrinkle coordinate spans. A joint's wrinkles sit at the
 * whole phases round the middle (5), the phase running on unclamped with
 * `along` for 8 mm either side, past where any wrinkle's mask ends, so the
 * coordinate is only held at its ends where nothing shows.
 */
export const KNUCKLE_PHASES = 10;

/** How far a knuckle's wrinkle mask fades past its plateau, and a face's length on a digit, metres. */
const KNUCKLE_FADE = 0.0015;
const KNUCKLE_FACE = 0.0035;

/** The dorsal side: 1 facing away from the palm, eased off over the digit's sides. */
const dorsal = (volar: number) => smoothstep(0.05, 0.45, -volar);

const knuckleCache = new WeakMap<
  HumanoidAssets,
  { pigment: Float32Array; wrinkles: SkinLayerFields }
>();

/** The knuckles' fields: a pigment mask, and the wrinkles' mask and coordinate. */
export function knuckleFields(assets: HumanoidAssets): {
  pigment: Float32Array;
  wrinkles: SkinLayerFields;
} {
  const known = knuckleCache.get(assets);
  if (known) return known;
  const frame = handFrame(assets);
  const zones = skinZones(assets);
  const hand = zones.zone("hand");
  const n = assets.manifest.vertexCount;
  const pigment = new Float32Array(n);
  const mask = new Float32Array(n);
  const coord = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const digit = frame.digit[v] as number;
    if (digit === 0) continue;
    // The coordinate is set on the whole digit, the palmar side too, and only
    // the mask limits the wrinkles to the back: it never changes abruptly
    // across the mask's edge.
    const back = dorsal(frame.volar[v] as number) * (hand[v] as number);
    const side = frame.side[v] as number;
    const joints = (frame.joints[side] as number[][])[digit] as number[];
    const r = ((frame.radius[side] as number[])[digit] as number) || 0.007;
    const across = frame.across[v] as number;
    const lateral = 1 - smoothstep(0.75 * r, 1.25 * r, Math.abs(across));
    let nearest = Number.POSITIVE_INFINITY;
    const knuckles = digit === 1 ? THUMB_KNUCKLES : KNUCKLES;
    knuckles.forEach((k, i) => {
      const at = joints[k.joint - 1] as number;
      const ds = (frame.along[v] as number) - at;
      const patch = Math.exp(-((ds / k.radius) ** 2)) * k.pigment;
      pigment[v] = Math.max(pigment[v] as number, back * lateral * patch);
      // Wrinkles: arcs at phases 1..count, centred on the joint, from the nearest joint.
      const bowed = ds + KNUCKLE_WRINKLE_BOW * across * across;
      if (Math.abs(bowed) >= nearest) return;
      nearest = Math.abs(bowed);
      const phase = KNUCKLE_PHASES / 2 + bowed / KNUCKLE_WRINKLE_SPACING;
      coord[v] = clamp(phase / KNUCKLE_PHASES, 0, 1);
      // Full over the wrinkles and a spacing beyond each end, then fading; but
      // ended a face short of halfway to the next joint, where the coordinate
      // turns to that joint's, so a short phalanx (the little finger's) does
      // not draw a false wrinkle there.
      const gap = Math.min(
        ...[knuckles[i - 1], knuckles[i + 1]]
          .filter((o) => o !== undefined)
          .map((o) => Math.abs((joints[o.joint - 1] as number) - at)),
      );
      const reach = gap / 2 - KNUCKLE_FACE;
      const half = ((k.wrinkles - 1) * KNUCKLE_WRINKLE_SPACING) / 2;
      const plateau = Math.max(0, Math.min(half + KNUCKLE_WRINKLE_SPACING, reach - KNUCKLE_FADE));
      mask[v] = back * lateral * k.relief * creaseWindow(bowed, plateau, KNUCKLE_FADE);
    });
  }
  const fields = { pigment, wrinkles: { mask, coord } };
  knuckleCache.set(assets, fields);
  return fields;
}

/** Knuckle pigment (`knuckleAlbedo`) over the back of each finger joint. */
export const KNUCKLE_LAYER: ColourLayer = {
  id: "knuckles",
  blend: "mix",
  targets: [],
  fields: (assets) => ({ mask: knuckleFields(assets).pigment, coord: null }),
  paint: ({ tone }) => ({ strength: 1, stops: [knuckleAlbedo(tone)] }),
};

/** Relief height of the knuckle wrinkles at full strength, metres (CHOICE, tuned on the contact sheets). */
export const KNUCKLE_WRINKLE_DEPTH = 0.00012;

/** Knuckle wrinkles: the slack skin over the back of the finger joints, arcs across the digit. */
export const KNUCKLE_WRINKLE_LAYER: DetailLayer = {
  id: "knuckle-wrinkles",
  kind: "detail",
  pattern: "creases",
  targets: [],
  fields: (assets) => knuckleFields(assets).wrinkles,
  paint: () => ({ strength: 1, height: KNUCKLE_WRINKLE_DEPTH, size: KNUCKLE_PHASES }),
};
