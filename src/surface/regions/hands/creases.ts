/**
 * The palmar flexion creases: the palm's three (distal and proximal
 * transverse, thenar) and each digit's, as lines of colour and relief folds.
 *
 * A crease narrower than the mesh's vertex spacing (about 5 mm on the palm)
 * cannot be a mask: a mask is interpolated between vertices. It is carried
 * instead by the coordinate, a signed distance to the crease that
 * interpolates exactly across it, so the crease is drawn where it is wherever
 * the vertices fall. A crease is drawn twice, because a coordinate is
 * interpolated exactly only where it is linear in position:
 *
 * - as relief, a fold a face or so wide, whose coordinate is the signed
 *   distance over the fold's width (`creasePhase`), so the fold lies where the
 *   crease does however the vertices fall;
 * - as a line of colour, whose coordinate is the signed distance across a band
 *   wider than two faces (`creaseLineCoordinate`), linear across any face the
 *   crease crosses; the line is one of the layer's eight colour stops, so it is
 *   a seventh of the band wide, finer than the mesh.
 *
 * Every magnitude cites docs/research/SKIN-STATES.md Part C5 or is marked
 * there as a choice.
 */
import type { HumanoidAssets } from "../../../format/assetFormat.ts";
import { palmAlbedo } from "../../handTone.ts";
import type { ColourLayer, DetailLayer, SkinLayerFields } from "../../layers.ts";
import { type Rgb, type SkinTone, skinAlbedo } from "../../skinTone.ts";
import { skinZones } from "../skinZones.ts";
import { clamp, handFrame, type PalmLandmarks, smoothstep } from "./frame.ts";

/** The relief's phase at signed distance `ds` (metres) from a crease `width` wide: the groove at 1, its rims at 0.5 and 1.5. */
export function creasePhase(ds: number, width: number): number {
  return 1 + clamp(ds / width, -0.5, 0.5);
}

/** Phases the relief coordinate spans (it holds `creasePhase` / 2). */
export const CREASE_PHASES = 2;

/** The line's coordinate at signed distance `ds` across a band `band` wide: the line falls on the stop at 3/7. */
export function creaseLineCoordinate(ds: number, band: number): number {
  return clamp(3 / 7 + ds / band, 0, 1);
}

/** Full within `plateau` metres of a crease, fading to nothing `fade` metres further out. */
export const creaseWindow = (ds: number, plateau: number, fade: number) =>
  1 - smoothstep(plateau, plateau + fade, Math.abs(ds));

/**
 * A quadratic Bézier in the palm's plane: start, control, end. Each starts
 * where it reaches the palm's border, or meets another crease, and tapers out
 * at its end. The signed distance is positive on a curve's left, then turned
 * by `CURVE_SIGN`.
 *
 * Between two neighbouring creases the coordinate runs from one to the other,
 * and it can do so without jumping only if the sides they turn toward each
 * other carry the same sign. So the signs alternate along a chain: each
 * finger's creases from its base outward (+ distal, then − distal, then +), the
 * distal transverse crease − on its distal side (facing the fingers' first
 * creases, − proximal), the proximal transverse crease + on its distal side
 * (facing the distal transverse crease's + proximal side), and the thenar
 * crease − toward the palm's middle (facing the proximal transverse crease's −
 * proximal side, in the wedge where they part).
 */
type Curve = readonly [[number, number], [number, number], [number, number]];

/**
 * Measured distances from the creases to the joints under them, metres
 * (Bugbee and Botte 1993, radio-opaque markers on 53 hands; Doyle and Botte
 * 2003): the proximal digital crease lies 14 to 20 mm distal to the
 * metacarpophalangeal joint, the distal transverse palmar crease 6.8 to 10.3 mm
 * from the ring and little fingers' joints, the proximal transverse crease 9.1
 * to 22.1 mm from the index and middle fingers'. The distal palmar crease
 * takes the middle of its range; the other two the low ends of theirs, which
 * put the proximal transverse and thenar creases' shared origin on the palm's
 * radial border distal to the thumb's web, where it is seen (the middle of
 * both ranges put it on the ball of the thumb, behind its first crease).
 */
export const CREASE_TO_JOINT = {
  proximalDigital: 0.0144,
  distalPalmar: 0.0085,
  proximalPalmar: 0.0091,
} as const;

/**
 * The fixed palmar creases of one hand, in the palm's plane, from its
 * landmarks and its digits' crease positions (`digitCreases`). MakeHuman's
 * finger joints sit near the web, about where each finger's proximal digital
 * crease falls, not at the anatomical knuckle; so each metacarpophalangeal
 * joint is placed `CREASE_TO_JOINT.proximalDigital` proximal to that crease,
 * and the palm's creases are measured from those joints:
 *
 * - the distal transverse crease from the hand's ulnar border, at
 *   `distalPalmar` proximal to the little and ring fingers' joints, curving to
 *   end between the index and middle fingers;
 * - the proximal transverse crease from the radial border, `proximalPalmar`
 *   proximal to the index finger's joint, running obliquely across toward the
 *   ulnar side;
 * - the thenar crease from that same origin round the ball of the thumb to the
 *   middle of the wrist.
 *
 * The distances are measured; the curves' shapes between them (their control
 * points, where the ulnar crease ends) are a CHOICE after anatomy texts
 * (SKIN-STATES.md C5).
 */
export function palmCreaseCurves(
  l: PalmLandmarks,
  digits: readonly (readonly number[])[],
): Curve[] {
  const joint = (digit: 2 | 3 | 4 | 5): [number, number] => {
    const k = l.knuckles[digit - 2] as [number, number];
    const crease =
      (digitCreases(digits[digit] as number[], digit)[0] as number) -
      CREASE_TO_JOINT.proximalDigital;
    return [k[0], k[1] + crease];
  };
  const [index, middle, ring, little] = [joint(2), joint(3), joint(4), joint(5)];
  const span = index[0] - little[0];
  const wrist = (l.knuckles[1] as [number, number])[1];
  const ulnar = little[0] - 0.28 * span;
  const radial = index[0] + 0.2 * span;
  const distal = (little[1] + ring[1]) / 2 - CREASE_TO_JOINT.distalPalmar;
  const origin = index[1] - CREASE_TO_JOINT.proximalPalmar;
  return [
    // Distal transverse ("heart line").
    [
      [ulnar, distal],
      [(middle[0] + ring[0]) / 2, distal + 0.004],
      [(index[0] + middle[0]) / 2, (index[1] + middle[1]) / 2 + 0.002],
    ],
    // Proximal transverse ("head line"), sloping toward the wrist as it
    // crosses, so it stays clear of the distal transverse crease.
    [
      [radial, origin],
      [middle[0], origin - 0.013],
      [little[0] + 0.1 * span, origin - 0.027],
    ],
    // Thenar ("life line"), drawn from the origin it shares with the proximal
    // transverse crease, starting just proximal to it: it runs more steeply, so
    // starting above it would cross it.
    [
      [radial - 0.02 * span, origin - 0.002],
      [middle[0] + 0.2 * span, 0.42 * wrist],
      [0.4 * middle[0] + 0.6 * l.thumbBase[0], 0.06 * wrist],
    ],
  ];
}

/** Which way each palm crease's signed distance runs (see `Curve`). */
const CURVE_SIGN = [-1, -1, 1] as const;

/** Samples along a curve for `curveDistance`'s coarse search. */
const CURVE_STEPS = 64;

/** A curve's nearest point to (u, v): the signed distance and the point's parameter 0..1. */
type NearestOnCurve = (u: number, v: number) => { ds: number; t: number };

/**
 * A curve's nearest-point finder: the signed distance is positive on the
 * curve's left. The coarse samples are taken once per curve; the search runs
 * for every hand vertex, so it allocates nothing.
 */
function curveDistance(curve: Curve): NearestOnCurve {
  const [[ax, ay], [bx, by], [cx, cy]] = curve;
  const px = (t: number) => (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * bx + t * t * cx;
  const py = (t: number) => (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * by + t * t * cy;
  const samples = new Float64Array((CURVE_STEPS + 1) * 2);
  for (let i = 0; i <= CURVE_STEPS; i++) {
    samples[i * 2] = px(i / CURVE_STEPS);
    samples[i * 2 + 1] = py(i / CURVE_STEPS);
  }
  const dist2 = (t: number, u: number, v: number) => (u - px(t)) ** 2 + (v - py(t)) ** 2;
  return (u, v) => {
    let best = Number.POSITIVE_INFINITY;
    let bestI = 0;
    for (let i = 0; i <= CURVE_STEPS; i++) {
      const d = (u - (samples[i * 2] as number)) ** 2 + (v - (samples[i * 2 + 1] as number)) ** 2;
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    // Refine between the neighbouring samples.
    let lo = Math.max(0, (bestI - 1) / CURVE_STEPS);
    let hi = Math.min(1, (bestI + 1) / CURVE_STEPS);
    for (let i = 0; i < 20; i++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (dist2(m1, u, v) < dist2(m2, u, v)) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const tu = 2 * (1 - t) * (bx - ax) + 2 * t * (cx - bx);
    const tv = 2 * (1 - t) * (by - ay) + 2 * t * (cy - by);
    const side = Math.sign(tu * (v - py(t)) - tv * (u - px(t))) || 1;
    return { ds: side * Math.hypot(u - px(t), v - py(t)), t };
  };
}

/**
 * The two kinds of crease and how each is drawn, metres: the relief fold's
 * width and how far its mask fades past it; the colour line's band (the line
 * is a seventh of it) and how far from the crease its mask stays full before
 * fading. The palm's vertices are about 5 mm apart and the fingers' about 3,
 * so every width spans at least a face and every band two (`tests/hands.test.ts`
 * holds the fields to it). No crease width or depth was found measured
 * (SKIN-STATES.md C5): CHOICES, tuned on the contact sheets.
 */
export const CREASE_GEOMETRY = {
  palm: { width: 0.0078, fade: 0.003, band: 0.0185, plateau: 0.0045, lineFade: 0.003, relief: 1 },
  finger: {
    width: 0.0045,
    fade: 0.002,
    band: 0.011,
    plateau: 0.0025,
    lineFade: 0.002,
    relief: 0.7,
  },
} as const;

/**
 * The middle digital crease lies 1.6 to 2.6 mm proximal to the proximal
 * interphalangeal joint, the thumb's interphalangeal crease 2.2 mm proximal to
 * its joint, and the thumb's metacarpophalangeal crease directly over its
 * joint (Doyle and Botte 2003, quoted by Kosif et al. 2015). Metres.
 */
export const MIDDLE_CREASE_TO_JOINT = 0.0021;
export const THUMB_CREASE_TO_JOINT = 0.0022;

/**
 * Lengths between a finger's creases, metres: proximal to middle crease, and
 * middle to distal crease, for the index, middle, ring and little fingers
 * (Kosif et al. 2015, Int J Morphol 33:173; calipers on 164 adults, the right
 * hands of right-handed men and women, averaged).
 */
export const FINGER_CREASE_SPANS: readonly (readonly [number, number])[] = [
  [0.02359, 0.02124],
  [0.02633, 0.02416],
  [0.02298, 0.0222],
  [0.01837, 0.01611],
];

/**
 * Which way a digit's crease's signed distance runs (see `Curve`): alternating
 * from the base, a finger's first crease + on its distal side, the thumb's
 * first − (its proximal side, +, faces the thenar crease's + thenar side).
 */
export const digitCreaseSign = (digit: number, k: number): number =>
  (k % 2 === 0 ? 1 : -1) * (digit === 1 ? -1 : 1);

/**
 * A digit's flexion creases as `along` positions (`HandFrame.joints` is its
 * joints'), base outward: a finger's proximal, middle and distal creases (the
 * middle one placed from its joint, the others from it by the measured spans);
 * the thumb's metacarpophalangeal and interphalangeal creases.
 */
export function digitCreases(joints: readonly number[], digit: number): number[] {
  if (digit === 1) return [joints[1] as number, (joints[2] as number) - THUMB_CREASE_TO_JOINT];
  const [toMiddle, toDistal] = FINGER_CREASE_SPANS[digit - 2] as readonly [number, number];
  const middle = (joints[1] as number) - MIDDLE_CREASE_TO_JOINT;
  return [middle - toMiddle, middle, middle + toDistal];
}

export interface CreaseSample {
  /** Signed distance to the nearest crease, metres; NaN off the hands. */
  ds: Float32Array;
  /** 0 a palm crease, 1 a finger crease. */
  kind: Uint8Array;
  /**
   * Which crease is nearest: a palm crease's index in `palmCreaseCurves`, or
   * 10 × digit + the crease's index in `digitCreases`. Where two neighbouring
   * vertices are nearest different creases, the coordinate must not pass a
   * crease between them (`tests/hands.test.ts`).
   */
  id: Int16Array;
  /** The palmar side times the crease's taper toward its ends. */
  weight: Float32Array;
  /**
   * Every crease's signed distance at each vertex, `CREASE_SLOTS` per vertex:
   * the palm's three creases (slots 0 to 2), then its digit's (3 onward; NaN
   * where a digit has fewer).
   */
  candidates: Float32Array;
}

/** Signed distances kept per vertex in `CreaseSample.candidates`: three palm creases and up to three of a digit's. */
export const CREASE_SLOTS = 6;

const creaseSamples = new WeakMap<HumanoidAssets, CreaseSample>();

/** How far short of a digit's first crease the palm's creases take over, metres: past the finger line's mask. */
const PALM_EDGE = 0.006;

/**
 * The nearest palmar crease at each vertex: on the palm itself (the thumb's
 * metacarpal and ball, and the hand between the wrist and the knuckles) the
 * palm's creases, nearest by distance in the palm's plane, tapered off over the
 * last eighth of each; on the digits beyond, the finger creases.
 */
export function sampleCreases(assets: HumanoidAssets): CreaseSample {
  const known = creaseSamples.get(assets);
  if (known) return known;
  const frame = handFrame(assets);
  const zones = skinZones(assets);
  const n = assets.manifest.vertexCount;
  const out: CreaseSample = {
    ds: new Float32Array(n).fill(Number.NaN),
    kind: new Uint8Array(n),
    id: new Int16Array(n).fill(-1),
    weight: new Float32Array(n),
    candidates: new Float32Array(n * CREASE_SLOTS).fill(Number.NaN),
  };
  const curves: NearestOnCurve[][] = frame.landmarks.map((l, side) =>
    palmCreaseCurves(l, frame.joints[side] as number[][]).map(curveDistance),
  );
  for (let v = 0; v < n; v++) {
    // Every hand vertex gets a distance, the dorsal ones too: only the mask
    // decides where a crease shows, so the coordinate never changes abruptly
    // across the mask's edge.
    const digit = frame.digit[v] as number;
    if (digit === 0) continue;
    const palmar = zones.palm[v] as number;
    const side = frame.side[v] as number;
    const joints = (frame.joints[side] as number[][])[digit] as number[];
    const along = frame.along[v] as number;
    const creases = digitCreases(joints, digit);
    // The palm proper: short of the digit's first crease by more than its line's reach.
    const onPalm = along < (creases[0] as number) - PALM_EDGE;
    let best = Number.POSITIVE_INFINITY;
    let taper = 0;
    let kind = 1;
    let id = -1;
    // The digit's own creases, from the palm too, so the coordinate runs on
    // from a finger's first crease into the palm without changing crease.
    creases.forEach((at, k) => {
      const ds = (along - at) * digitCreaseSign(digit, k);
      out.candidates[v * CREASE_SLOTS + 3 + k] = ds;
      if (Math.abs(ds) < Math.abs(best)) {
        best = ds;
        // A finger crease shows on its digit, not on the palm.
        taper = onPalm ? 0 : 1;
        kind = 1;
        id = 10 * digit + k;
      }
    });
    const u = frame.palm[v * 2] as number;
    const w = frame.palm[v * 2 + 1] as number;
    (curves[side] as NearestOnCurve[]).forEach((nearest, i) => {
      const { ds: raw, t } = nearest(u, w);
      const ds = raw * (CURVE_SIGN[i] as number);
      out.candidates[v * CREASE_SLOTS + i] = ds;
      if (onPalm && Math.abs(ds) < Math.abs(best)) {
        best = ds;
        // Full from a little past its start (where it leaves the palm's
        // border) to its last fifth. The proximal transverse and thenar creases
        // start at the web beside the thumb's first crease, three creases
        // round one web whose sides no choice of signs can all match.
        taper = smoothstep(0, 0.12, t) * smoothstep(1, 0.8, t);
        kind = 0;
        id = i;
      }
    });
    out.ds[v] = best;
    out.kind[v] = kind;
    out.id[v] = id;
    out.weight[v] = palmar * taper;
  }
  creaseSamples.set(assets, out);
  return out;
}

const reliefCache = new WeakMap<HumanoidAssets, SkinLayerFields>();

/** The creases' relief fields: the fold's mask and its phase (`creasePhase` / `CREASE_PHASES`). */
export function palmCreaseReliefFields(assets: HumanoidAssets): SkinLayerFields {
  const known = reliefCache.get(assets);
  if (known) return known;
  const s = sampleCreases(assets);
  const n = assets.manifest.vertexCount;
  const mask = new Float32Array(n);
  const coord = new Float32Array(n).fill(0.5 / CREASE_PHASES);
  for (let v = 0; v < n; v++) {
    const ds = s.ds[v] as number;
    if (Number.isNaN(ds)) continue;
    const g = s.kind[v] === 0 ? CREASE_GEOMETRY.palm : CREASE_GEOMETRY.finger;
    mask[v] = (s.weight[v] as number) * g.relief * creaseWindow(ds, g.width / 2, g.fade);
    coord[v] = creasePhase(ds, g.width) / CREASE_PHASES;
  }
  const fields = { mask, coord };
  reliefCache.set(assets, fields);
  return fields;
}

const lineCache = new WeakMap<HumanoidAssets, SkinLayerFields>();

/** The creases' line fields: the line's mask and its coordinate across the band (`creaseLineCoordinate`). */
export function palmCreaseLineFields(assets: HumanoidAssets): SkinLayerFields {
  const known = lineCache.get(assets);
  if (known) return known;
  const s = sampleCreases(assets);
  const n = assets.manifest.vertexCount;
  const mask = new Float32Array(n);
  const coord = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const ds = s.ds[v] as number;
    if (Number.isNaN(ds)) continue;
    const g = s.kind[v] === 0 ? CREASE_GEOMETRY.palm : CREASE_GEOMETRY.finger;
    mask[v] = (s.weight[v] as number) * creaseWindow(ds, g.plateau, g.lineFade);
    coord[v] = creaseLineCoordinate(ds, g.band);
  }
  const fields = { mask, coord };
  lineCache.set(assets, fields);
  return fields;
}

/**
 * Relief depth of the creases' folds at full strength, metres. CHOICE: no
 * depth was measured (SKIN-STATES.md C5); tuned on the contact sheets so the
 * folds read at hand-close-up distance and fade at full-figure distance.
 */
export const PALM_CREASE_DEPTH = 0.0003;

/** The palmar flexion creases as relief: fixed folds, present from birth, at every age and tone. */
export const PALM_CREASE_LAYER: DetailLayer = {
  id: "palm-creases",
  kind: "detail",
  pattern: "creases",
  targets: [],
  fields: palmCreaseReliefFields,
  paint: () => ({ strength: 1, height: PALM_CREASE_DEPTH, size: CREASE_PHASES }),
};

/**
 * How far a crease's line returns toward the body's own colour (CHOICE):
 * crease pigment is a normal finding in darker skin, where the creases are
 * darker than the palm around them (SKIN-STATES.md C5). A return toward the
 * skin's own colour, so fair skin, whose palm is about the body's colour,
 * gains no pigment.
 */
export const PALM_CREASE_PIGMENT = 0.6;

/**
 * The shadow a crease's walls cast into it, as a factor on its line's colour
 * (CHOICE): the relief fold is wider than the crease, so the narrow, dark
 * bottom every palm shows at every tone is drawn into the colour.
 */
export const PALM_CREASE_SHADE = 0.8;

/** The colour a crease's line multiplies the palm by: its pigment (`PALM_CREASE_PIGMENT`) and shade. */
export function palmCreaseLine(tone: SkinTone): Rgb {
  const palm = palmAlbedo(tone);
  const skin = skinAlbedo(tone);
  return skin.map(
    (c, k) =>
      (1 + Math.min(0, c / Math.max(1e-6, palm[k] as number) - 1) * PALM_CREASE_PIGMENT) *
      PALM_CREASE_SHADE,
  ) as Rgb;
}

/**
 * The creases' lines: a multiply layer whose stop at 3/7, where each crease
 * falls (`creaseLineCoordinate`), is `palmCreaseLine` and whose other stops
 * leave the palm as it is.
 */
export const PALM_CREASE_LINE_LAYER: ColourLayer = {
  id: "palm-crease-lines",
  blend: "multiply",
  targets: [],
  fields: palmCreaseLineFields,
  paint: ({ tone }) => {
    const one: Rgb = [1, 1, 1];
    return { strength: 1, stops: [one, one, one, palmCreaseLine(tone), one, one, one, one] };
  },
};
