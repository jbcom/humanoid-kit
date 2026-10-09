/**
 * The hands' own skin (docs/ARCHITECTURE.md, "Hands"). Every field is
 * measured from the base mesh alone, as the skin-state zones are: the
 * skeleton's finger joints give each hand a frame (which digit a vertex lies
 * on, how far along it and how far across), and the vertex normals tell the
 * palmar side from the dorsal. No target or vertex group is added.
 *
 * A crease narrower than the mesh's vertex spacing (about 5 mm on the palm)
 * cannot be a mask: a mask is interpolated between vertices. It is carried
 * instead by the coordinate, a signed distance to the crease that
 * interpolates exactly across it, so the crease is drawn where it is wherever
 * the vertices fall. Every magnitude cites docs/research/SKIN-STATES.md Part
 * C5 or is marked there as a choice.
 */
import type { HumanoidAssets } from "../../format/assetFormat.ts";
import { jointPosition } from "../../format/assetFormat.ts";
import { knuckleAlbedo, nailColours, palmAlbedo } from "../handTone.ts";
import type { ColourLayer, DetailLayer, SkinLayerFields, SurfaceLayer } from "../layers.ts";
import { type Rgb, type SkinTone, skinAlbedo } from "../skinTone.ts";
import { palmDirection, skinZones } from "./skinZones.ts";

type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: Vec3, b: Vec3, w: number): Vec3 => [
  a[0] + (b[0] - a[0]) * w,
  a[1] + (b[1] - a[1]) * w,
  a[2] + (b[2] - a[2]) * w,
];
const normalise = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Digits, thumb first. */
const DIGITS = [1, 2, 3, 4, 5] as const;

/**
 * A digit's polyline from the wrist: the wrist, then its base joint (the
 * thumb's carpometacarpal joint, a finger's knuckle), its two interphalangeal
 * joints (the thumb's metacarpophalangeal and interphalangeal) and its tip.
 */
function digitJoints(assets: HumanoidAssets, side: "L" | "R", digit: number): Vec3[] {
  const at = (joint: string): Vec3 => {
    const p = new Float32Array(3);
    jointPosition(assets, assets.positions, joint, p, 0);
    return [p[0] as number, p[1] as number, p[2] as number];
  };
  return [
    at(`wrist.${side}____head`),
    at(`finger${digit}-1.${side}____head`),
    at(`finger${digit}-2.${side}____head`),
    at(`finger${digit}-3.${side}____head`),
    at(`finger${digit}-3.${side}____tail`),
  ];
}

/**
 * Where each vertex of a hand lies in that hand's frame. `digit` is the digit
 * whose polyline is nearest (0 for none: off the hands); `along` is the
 * distance along that polyline from its base joint, metres (negative over the
 * back and front of the hand, between the wrist and the knuckle); `across` the
 * signed distance across the digit; `volar` the normal's alignment with the
 * palm's facing, 1 on the palm and −1 on the back. `joints[side][digit]` are
 * the `along` of the digit's joints: base 0, then the two joints, then the
 * tip; `palm` holds each vertex's coordinates in the palm's plane.
 */
export interface HandFrame {
  digit: Int8Array;
  along: Float32Array;
  across: Float32Array;
  volar: Float32Array;
  /** Per vertex: 0 for the left hand, 1 for the right. */
  side: Uint8Array;
  /** `along` of each digit's joints, per side then digit (1 to 5): base, two joints, tip. */
  joints: readonly (readonly (readonly number[])[])[];
  /** Per side and digit: the digit's mean radius over its last segment, metres. */
  radius: readonly (readonly number[])[];
  /**
   * Coordinates in the palm's plane, metres, two per vertex: across the palm
   * toward the thumb (u) and from the wrist toward the middle finger (v).
   */
  palm: Float32Array;
  /** Per side, the palm-plane coordinates of the landmarks the creases are drawn from. */
  landmarks: readonly PalmLandmarks[];
}

/** Landmarks in the palm's plane, metres: (u, v) each. */
export interface PalmLandmarks {
  /** The knuckles of the index, middle, ring and little fingers. */
  knuckles: readonly [number, number][];
  /** The thumb's carpometacarpal and metacarpophalangeal joints. */
  thumbBase: [number, number];
  thumbKnuckle: [number, number];
}

const frames = new WeakMap<HumanoidAssets, HandFrame>();

/** The hands' frame of a base mesh, measured on first use. */
export function handFrame(assets: HumanoidAssets): HandFrame {
  const known = frames.get(assets);
  if (known) return known;
  const n = assets.manifest.vertexCount;
  const P = assets.positions;
  const zones = skinZones(assets);
  const hand = zones.zone("hand");
  const N = zones.normals;
  const frame: HandFrame = {
    digit: new Int8Array(n),
    along: new Float32Array(n),
    across: new Float32Array(n),
    volar: new Float32Array(n),
    side: new Uint8Array(n),
    joints: [],
    radius: [],
    palm: new Float32Array(n * 2),
    landmarks: [],
  };
  const joints: number[][][] = [];
  const radius: number[][] = [];
  const landmarks: PalmLandmarks[] = [];
  (["L", "R"] as const).forEach((sideName, sideIndex) => {
    const sign = sideName === "L" ? 1 : -1;
    const palmDir = palmDirection(assets, sideName);
    const lines = DIGITS.map((d) => digitJoints(assets, sideName, d));
    // Each segment of each digit: start, unit axis, length, `along` at its start,
    // and its neighbours along the digit.
    interface Segment {
      digit: number;
      a: Vec3;
      axis: Vec3;
      len: number;
      s0: number;
      prev: Segment | null;
      next: Segment | null;
    }
    const segments: Segment[] = [];
    const sideJoints: number[][] = [[]];
    lines.forEach((pts, i) => {
      const lens = pts.slice(1).map((p, k) => length(sub(p, pts[k] as Vec3)));
      const s: number[] = [-(lens[0] as number)];
      for (let k = 1; k < pts.length; k++) s.push((s[k - 1] as number) + (lens[k - 1] as number));
      let prev: Segment | null = null;
      for (let k = 0; k < pts.length - 1; k++) {
        const seg: Segment = {
          digit: i + 1,
          a: pts[k] as Vec3,
          axis: normalise(sub(pts[k + 1] as Vec3, pts[k] as Vec3)),
          len: lens[k] as number,
          s0: s[k] as number,
          prev,
          next: null,
        };
        if (prev) prev.next = seg;
        segments.push(seg);
        prev = seg;
      }
      sideJoints.push(s.slice(1));
    });
    joints.push(sideJoints);
    // The palm's plane: v from the wrist toward the middle finger's knuckle, u across toward the thumb.
    const wrist = (lines[0] as Vec3[])[0] as Vec3;
    const toMiddle = sub((lines[2] as Vec3[])[1] as Vec3, wrist);
    const vAxis = normalise(sub(toMiddle, palmDir.map((c) => c * dot(toMiddle, palmDir)) as Vec3));
    let uAxis = cross(palmDir, vAxis);
    if (dot(uAxis, sub((lines[0] as Vec3[])[2] as Vec3, wrist)) < 0)
      uAxis = [-uAxis[0], -uAxis[1], -uAxis[2]];
    const uv = (p: Vec3): [number, number] => [
      dot(sub(p, wrist), uAxis),
      dot(sub(p, wrist), vAxis),
    ];
    landmarks.push({
      knuckles: [2, 3, 4, 5].map((d) => uv((lines[d - 1] as Vec3[])[1] as Vec3)),
      thumbBase: uv((lines[0] as Vec3[])[1] as Vec3),
      thumbKnuckle: uv((lines[0] as Vec3[])[2] as Vec3),
    });
    const radSum = [0, 0, 0, 0, 0, 0];
    const radCount = [0, 0, 0, 0, 0, 0];
    for (let v = 0; v < n; v++) {
      if ((hand[v] as number) <= 0.01) continue;
      const x = P[v * 3] as number;
      if (Math.sign(x) !== sign) continue;
      const p: Vec3 = [x, P[v * 3 + 1] as number, P[v * 3 + 2] as number];
      let best = Number.POSITIVE_INFINITY;
      let pick = segments[0] as (typeof segments)[number];
      let t = 0;
      // The nearest segment (squared distance, no allocation: this runs for
      // every hand vertex against every segment).
      for (const seg of segments) {
        const [ax, ay, az] = seg.a;
        const [ux, uy, uz] = seg.axis;
        const dx = p[0] - ax;
        const dy = p[1] - ay;
        const dz = p[2] - az;
        const proj = dx * ux + dy * uy + dz * uz;
        const c = clamp(proj, 0, seg.len);
        const ex = dx - ux * c;
        const ey = dy - uy * c;
        const ez = dz - uz * c;
        const dist2 = ex * ex + ey * ey + ez * ez;
        if (dist2 < best) {
          best = dist2;
          pick = seg;
          t = proj;
        }
      }
      // Near a joint, blend the projections onto the segments either side of
      // it, so `along` and `across` run on smoothly round the bend. (Taking the
      // nearest segment's alone jumps by about the radius times the bend at
      // the bisector, which would draw a crease there.)
      const before = t < pick.len / 2 ? pick.prev : pick;
      const after = t < pick.len / 2 ? pick : pick.next;
      let origin = pick.a;
      let s0 = pick.s0;
      let axis = pick.axis;
      let along = pick.s0 + t;
      if (before && after) {
        origin = after.a;
        s0 = after.s0;
        const dj = sub(p, origin);
        const reach = 0.4 * Math.min(before.len, after.len);
        const w = smoothstep(
          -reach,
          reach,
          dot(dj, normalise(lerp3(before.axis, after.axis, 0.5))),
        );
        along = s0 + (1 - w) * dot(dj, before.axis) + w * dot(dj, after.axis);
        axis = normalise(lerp3(before.axis, after.axis, w));
      }
      const dj = sub(p, origin);
      const offset = sub(dj, axis.map((c) => c * dot(dj, axis)) as Vec3);
      const acrossDir = normalise(cross(axis, palmDir));
      frame.digit[v] = pick.digit;
      frame.along[v] = along;
      frame.across[v] = dot(offset, acrossDir);
      frame.volar[v] = dot(
        [N[v * 3] as number, N[v * 3 + 1] as number, N[v * 3 + 2] as number],
        palmDir,
      );
      frame.side[v] = sideIndex;
      const [u, w] = uv(p);
      frame.palm[v * 2] = u;
      frame.palm[v * 2 + 1] = w;
      // The last segment's radius: the fingertip's, where the nail lies.
      const tipJoints = sideJoints[pick.digit] as number[];
      if (along > (tipJoints[2] as number) + 0.002 && along < (tipJoints[3] as number) - 0.004) {
        radSum[pick.digit] = (radSum[pick.digit] as number) + length(offset);
        radCount[pick.digit] = (radCount[pick.digit] as number) + 1;
      }
    }
    radius.push(radSum.map((r, d) => (radCount[d] ? r / (radCount[d] as number) : 0)));
  });
  frame.joints = joints;
  frame.radius = radius;
  frame.landmarks = landmarks;
  frames.set(assets, frame);
  return frame;
}

/* ------------------------------------------------------------------ creases */

/*
 * A crease is drawn twice, because a mask is interpolated between vertices and
 * a coordinate is interpolated exactly only where it is linear in position, and
 * the palm's vertices are about 5 mm apart:
 *
 * - as relief, a fold a face or so wide, whose coordinate is the signed
 *   distance over the fold's width (`creasePhase`), so the fold lies where the
 *   crease does however the vertices fall;
 * - as a line of colour, whose coordinate is the signed distance across a band
 *   wider than two faces (`creaseLineCoordinate`), linear across any face the
 *   crease crosses; the line is one of the layer's eight colour stops, so it is
 *   a seventh of the band wide, finer than the mesh.
 */

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
const creaseWindow = (ds: number, plateau: number, fade: number) =>
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

/**
 * A curve's nearest-point finder: (u, v) to the signed distance (positive on
 * the curve's left) and the parameter 0..1 of the nearest point. The coarse
 * samples are taken once per curve; the search runs for every hand vertex, so
 * it allocates nothing.
 */
function curveDistance(curve: Curve): (u: number, v: number) => { ds: number; t: number } {
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
  const curves = frame.landmarks.map((l, side) =>
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
    (curves[side] as ((u: number, v: number) => { ds: number; t: number })[]).forEach(
      (nearest, i) => {
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
      },
    );
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

/* ------------------------------------------------------------------ palm */

/**
 * Palm colour (`palmAlbedo`) over the palmar side of the hands, the fingers
 * included: the palm zone the skin states already use (`skinZones().palm`).
 */
export const PALM_LAYER: ColourLayer = {
  id: "palm",
  blend: "mix",
  targets: [],
  fields: (assets) => ({ mask: skinZones(assets).palm, coord: null }),
  paint: ({ tone }) => ({ strength: 1, stops: [palmAlbedo(tone)] }),
};

/* ------------------------------------------------------------------ knuckles */

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

/* ------------------------------------------------------------------ nails */

/**
 * Where each nail lies on its digit's last segment, as fractions of that
 * segment from its joint to the tip: the proximal fold's start, the cuticle
 * (where the plate emerges), the lunula's end and the free edge's start. The
 * mesh sculpts each nail; these follow the sculpt (measured on the base mesh's
 * dorsal profile). The lunula is largest on the thumb and least visible on the
 * little finger, as its visibility by finger is (SKIN-STATES.md C5); its size
 * is a CHOICE.
 */
export const NAIL_LAYOUT: readonly {
  fold: number;
  cuticle: number;
  lunula: number;
  freeEdge: number;
}[] = [
  { fold: 0.4, cuticle: 0.52, lunula: 0.62, freeEdge: 0.97 },
  { fold: 0.34, cuticle: 0.45, lunula: 0.51, freeEdge: 0.965 },
  { fold: 0.34, cuticle: 0.45, lunula: 0.5, freeEdge: 0.965 },
  { fold: 0.34, cuticle: 0.45, lunula: 0.48, freeEdge: 0.965 },
  { fold: 0.34, cuticle: 0.45, lunula: 0.46, freeEdge: 0.965 },
];

/** How far the lunula and free edge bow toward the tip at the nail's middle, fraction of the segment (CHOICE). */
const NAIL_BOW = 0.03;
/** The nail's half-width as a fraction of the fingertip's radius, and the width of its soft edge (CHOICE). */
const NAIL_HALF_WIDTH = 0.62;
const NAIL_EDGE = 0.18;
/** Half the width of a sharp colour edge on the nail, metres. */
const NAIL_SHARP = 0.0004;

/**
 * The nail coordinate at fraction `u` of the last segment: its eight stops are
 * fold, fold, lunula, lunula, bed, bed, free edge, free edge, and each colour
 * changes sharply at the cuticle, the lunula's end and the free edge.
 */
function nailCoordinate(u: number, layout: (typeof NAIL_LAYOUT)[number], sharp: number): number {
  const lunula = Math.max(layout.lunula, layout.cuticle + 2 * sharp);
  const knots: [number, number][] = [
    [layout.fold, 0],
    [layout.cuticle - sharp, 1],
    [layout.cuticle + sharp, 2],
    [lunula - sharp, 3],
    [lunula + sharp, 4],
    [layout.freeEdge - sharp, 5],
    [layout.freeEdge + sharp, 6],
    [1, 7],
  ];
  if (u <= (knots[0] as [number, number])[0]) return 0;
  for (let k = 1; k < knots.length; k++) {
    const [u1, c1] = knots[k] as [number, number];
    const [u0, c0] = knots[k - 1] as [number, number];
    if (u <= u1) return (c0 + ((u - u0) / Math.max(1e-9, u1 - u0)) * (c1 - c0)) / 7;
  }
  return 1;
}

const nailCache = new WeakMap<HumanoidAssets, { colour: SkinLayerFields; gloss: Float32Array }>();

/** The nails' fields: the colour layer's mask and coordinate, and the plate's gloss mask. */
export function nailFields(assets: HumanoidAssets): {
  colour: SkinLayerFields;
  gloss: Float32Array;
} {
  const known = nailCache.get(assets);
  if (known) return known;
  const frame = handFrame(assets);
  const n = assets.manifest.vertexCount;
  const mask = new Float32Array(n);
  const coord = new Float32Array(n);
  const gloss = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const digit = frame.digit[v] as number;
    if (digit === 0) continue;
    const side = frame.side[v] as number;
    const joints = (frame.joints[side] as number[][])[digit] as number[];
    const start = joints[2] as number;
    const len = (joints[3] as number) - start;
    const r = ((frame.radius[side] as number[])[digit] as number) || 0.007;
    const across = frame.across[v] as number;
    const bow = NAIL_BOW * (1 - (across / (NAIL_HALF_WIDTH * r)) ** 2);
    const u = ((frame.along[v] as number) - start) / len + bow;
    const layout = NAIL_LAYOUT[digit - 1] as (typeof NAIL_LAYOUT)[number];
    if (u < layout.fold - 0.1) continue;
    const width =
      1 - smoothstep(NAIL_HALF_WIDTH * r, (NAIL_HALF_WIDTH + NAIL_EDGE) * r, Math.abs(across));
    // The nail faces the back of the hand; at the tip it curls over toward the front.
    const facing = smoothstep(-0.25, 0.25, -(frame.volar[v] as number));
    const sharp = NAIL_SHARP / len;
    const m = width * facing * smoothstep(layout.fold - 0.08, layout.fold, u);
    mask[v] = m;
    coord[v] = nailCoordinate(u, layout, sharp);
    gloss[v] = m * smoothstep(layout.cuticle - sharp, layout.cuticle + sharp, u);
  }
  const fields = { colour: { mask, coord }, gloss };
  nailCache.set(assets, fields);
  return fields;
}

/** The nails: fold, lunula, bed and free edge along each nail (`nailColours`). */
export const NAIL_LAYER: ColourLayer = {
  id: "nails",
  blend: "mix",
  targets: [],
  fields: (assets) => nailFields(assets).colour,
  paint: ({ tone }) => {
    const c = nailColours(tone);
    return {
      strength: 1,
      stops: [c.fold, c.fold, c.lunula, c.lunula, c.bed, c.bed, c.freeEdge, c.freeEdge],
    };
  },
};

/**
 * The nail plate's gloss: hard, smooth keratin over the bed. Roughness and
 * specular changes are CHOICES (no gloss of nails was found measured;
 * SKIN-STATES.md C5), tuned on the contact sheets.
 */
export const NAIL_ROUGHNESS = -0.28;
export const NAIL_SPECULAR = 0.35;

export const NAIL_GLOSS_LAYER: SurfaceLayer = {
  id: "nail-gloss",
  kind: "surface",
  targets: [],
  fields: (assets) => ({ mask: nailFields(assets).gloss, coord: null }),
  paint: () => ({ strength: 1, roughness: NAIL_ROUGHNESS, specular: NAIL_SPECULAR }),
};

/**
 * The hands' layers in stack order: the palm's colour first, then the crease
 * lines over it, the knuckles and the nails, then relief and gloss.
 */
export const HAND_SKIN_LAYERS = [
  PALM_LAYER,
  PALM_CREASE_LINE_LAYER,
  KNUCKLE_LAYER,
  NAIL_LAYER,
  PALM_CREASE_LAYER,
  KNUCKLE_WRINKLE_LAYER,
  NAIL_GLOSS_LAYER,
] as const;
