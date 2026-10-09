/**
 * The feet's own skin (docs/ARCHITECTURE.md, "Feet"). Every field is measured
 * from the base mesh alone, as the skin-state zones and the hands are: the
 * skeleton's toe joints and the foot's extent give each foot a frame, and the
 * sole is the foot skin that faces down (`skinZones`). No target or vertex
 * group is added.
 *
 * Every magnitude cites docs/research/SKIN-STATES.md Part C6 or is marked there
 * as a choice.
 */
import type { HumanoidAssets } from "../../format/assetFormat.ts";
import { groupFaces, jointPosition } from "../../format/assetFormat.ts";
import type { DetailLayer, SkinLayer, SkinLayerFields } from "../layers.ts";
import { ridgeOrientationCoordinate } from "../ridges.ts";
import { type DigitFrame, digitFrame, type Vec3 } from "./digitFrame.ts";
import { NAIL_SHARP, nailCoordinate } from "./hands/nails.ts";
import { bodySurface } from "./once.ts";
import { skinZones } from "./skinZones.ts";

/** Where a landmark lies in a foot's frame: `along` (0 heel, 1 second toe's tip) and `across` (metres, positive outward). */
export interface FootPoint {
  along: number;
  across: number;
}

export interface FootLandmarks {
  /** The heel pad's centre. */
  heel: FootPoint;
  /** The heads of the five metatarsals, big toe first: the ball of the foot. */
  metatarsals: readonly FootPoint[];
  /** The pad under the big toe's tip. */
  hallux: FootPoint;
}

/**
 * The feet's frame. Per vertex of a foot (`side` 255 elsewhere): `along` its
 * length, as a fraction of the foot's, from the heel's rearmost point (0) to
 * the second toe's tip (1); `across` metres from the foot's axis, positive toward
 * the outside of the foot (the little toe's side).
 */
export interface FootFrame {
  /** 0 for the left foot (x > 0), 1 for the right, 255 for a vertex that is not on a foot. */
  side: Uint8Array;
  along: Float32Array;
  across: Float32Array;
  /** Per side: the heel-to-second-toe length, metres. */
  length: readonly [number, number];
  /** Per side: the foot's axis (heel to second toe) and its outward direction across it, as unit (x, z) pairs. */
  axis: readonly [readonly [number, number], readonly [number, number]];
  lateral: readonly [readonly [number, number], readonly [number, number]];
  landmarks: readonly [FootLandmarks, FootLandmarks];
}

const frames = new WeakMap<HumanoidAssets, FootFrame>();

/** The heel pad's centre as a fraction of the foot's length from its rear (a choice: the calcaneal pad is a few centimetres in). */
const HEEL_PAD_ALONG = 0.13;
/** How far proximal of a toe's base joint the metatarsal head's pad lies, metres (a choice: the joint is at the toe's base crease). */
const HEAD_PROXIMAL = 0.01;
/** How far proximal of the big toe's tip its pad's centre lies, metres (a choice). */
const HALLUX_PAD_PROXIMAL = 0.008;

/** The feet's frame of a base mesh, measured on first use. */
export function footFrame(assets: HumanoidAssets): FootFrame {
  const known = frames.get(assets);
  if (known) return known;
  const n = assets.manifest.vertexCount;
  const P = assets.positions;
  const foot = skinZones(assets).zone("foot");
  const onBody = bodySurface(assets);
  const side = new Uint8Array(n).fill(255);
  const along = new Float32Array(n);
  const across = new Float32Array(n);
  const length: number[] = [];
  const axes: [number, number][] = [];
  const laterals: [number, number][] = [];
  const landmarks: FootLandmarks[] = [];
  const at = (joint: string): [number, number, number] => {
    const p = new Float32Array(3);
    jointPosition(assets, assets.positions, joint, p, 0);
    return [p[0] as number, p[1] as number, p[2] as number];
  };
  (["L", "R"] as const).forEach((name, s) => {
    const sign = name === "L" ? 1 : -1;
    const mine = (v: number) =>
      onBody[v] === 1 && (foot[v] as number) > 0.5 && Math.sign(P[v * 3] as number) === sign;
    // The heel: the foot's rearmost point, centred on the vertices within a
    // centimetre of it. The axis then runs to the second toe's tip.
    let rear = Number.POSITIVE_INFINITY;
    for (let v = 0; v < n; v++) if (mine(v)) rear = Math.min(rear, P[v * 3 + 2] as number);
    let hx = 0;
    let hc = 0;
    for (let v = 0; v < n; v++)
      if (mine(v) && (P[v * 3 + 2] as number) < rear + 0.01) {
        hx += P[v * 3] as number;
        hc++;
      }
    const heel: [number, number] = [hx / hc, rear];
    const tip = at(`toe2-3.${name}____tail`);
    const dx = tip[0] - heel[0];
    const dz = tip[2] - heel[1];
    const L = Math.hypot(dx, dz);
    const axis: [number, number] = [dx / L, dz / L];
    // Outward: perpendicular to the axis, away from the body's midline.
    let lateral: [number, number] = [axis[1], -axis[0]];
    if (lateral[0] * sign < 0) lateral = [-lateral[0], -lateral[1]];
    const project = (x: number, z: number): FootPoint => {
      const rx = x - heel[0];
      const rz = z - heel[1];
      return {
        along: (rx * axis[0] + rz * axis[1]) / L,
        across: rx * lateral[0] + rz * lateral[1],
      };
    };
    for (let v = 0; v < n; v++) {
      if (!mine(v)) continue;
      const p = project(P[v * 3] as number, P[v * 3 + 2] as number);
      side[v] = s;
      along[v] = p.along;
      across[v] = p.across;
    }
    length.push(L);
    axes.push(axis);
    laterals.push(lateral);
    const proximal = (p: FootPoint, by: number): FootPoint => ({ ...p, along: p.along - by / L });
    const metatarsals = [1, 2, 3, 4, 5].map((t) => {
      const j = at(`toe${t}-1.${name}____head`);
      return proximal(project(j[0], j[2]), HEAD_PROXIMAL);
    });
    const hallucTip = at(`toe1-2.${name}____tail`);
    landmarks.push({
      heel: { along: HEEL_PAD_ALONG, across: 0 },
      metatarsals,
      hallux: proximal(project(hallucTip[0], hallucTip[2]), HALLUX_PAD_PROXIMAL),
    });
  });
  const frame: FootFrame = {
    side,
    along,
    across,
    length: [length[0] as number, length[1] as number],
    axis: [axes[0] as [number, number], axes[1] as [number, number]],
    lateral: [laterals[0] as [number, number], laterals[1] as [number, number]],
    landmarks: [landmarks[0] as FootLandmarks, landmarks[1] as FootLandmarks],
  };
  frames.set(assets, frame);
  return frame;
}

/**
 * The toes' frame (`digitFrame`): per vertex of a toe, its digit (1 the big toe
 * to 5 the little toe; 0 off the toes), `along` from its base joint to its tip,
 * `across`, and `under`, positive on the sole's side. `joints[side][digit - 1]`
 * is `along` of the digit's base joint (0), its joints and its tip.
 */
export interface ToeFrame {
  digit: Int8Array;
  along: Float32Array;
  across: Float32Array;
  under: Float32Array;
  joints: readonly [DigitFrame["joints"], DigitFrame["joints"]];
}

const toeFrames = new WeakMap<HumanoidAssets, ToeFrame>();

/** The toes' frame of a base mesh, measured on first use. */
export function toeFrame(assets: HumanoidAssets): ToeFrame {
  const known = toeFrames.get(assets);
  if (known) return known;
  const n = assets.manifest.vertexCount;
  const P = assets.positions;
  const foot = skinZones(assets).zone("foot");
  const onBody = bodySurface(assets);
  const at = (joint: string): Vec3 => {
    const p = new Float32Array(3);
    jointPosition(assets, assets.positions, joint, p, 0);
    return [p[0] as number, p[1] as number, p[2] as number];
  };
  const out: ToeFrame = {
    digit: new Int8Array(n),
    along: new Float32Array(n),
    across: new Float32Array(n),
    under: new Float32Array(n),
    joints: [[], []],
  };
  const joints: DigitFrame["joints"][] = [];
  (["L", "R"] as const).forEach((name) => {
    const sign = name === "L" ? 1 : -1;
    // A toe's joints: from the foot's far end, the base joint (the ball of the
    // foot), each joint between its bones and the tip. The big toe has two bones.
    const lines = [1, 2, 3, 4, 5].map((t) => {
      const bones = t === 1 ? 2 : 3;
      const pts: Vec3[] = [at(`foot.${name}____tail`)];
      for (let b = 1; b <= bones; b++) pts.push(at(`toe${t}-${b}.${name}____head`));
      pts.push(at(`toe${t}-${bones}.${name}____tail`));
      return pts;
    });
    const frame = digitFrame({
      positions: P,
      vertexCount: n,
      include: (v) =>
        onBody[v] === 1 && (foot[v] as number) > 0.5 && Math.sign(P[v * 3] as number) === sign,
      lines,
      // The sole faces down at rest.
      facing: [0, -1, 0],
    });
    // The skeleton's line runs nearer the top of a thin toe than through its
    // middle (the little toe's lies at its upper surface), so `under` is taken
    // from the middle of the toe's flesh beyond its base joint: positive on the
    // pad's side of it, negative on the nail's.
    const centre = new Float64Array(6);
    const count = new Uint32Array(6);
    for (let v = 0; v < n; v++) {
      const d = frame.digit[v] as number;
      if (d === 0 || (frame.along[v] as number) < 0.004) continue;
      centre[d] = (centre[d] as number) + (frame.under[v] as number);
      count[d] = (count[d] as number) + 1;
    }
    for (let v = 0; v < n; v++) {
      const d = frame.digit[v] as number;
      if (d === 0) continue;
      out.digit[v] = d;
      out.along[v] = frame.along[v] as number;
      out.across[v] = frame.across[v] as number;
      out.under[v] =
        (frame.under[v] as number) - (count[d] ? (centre[d] as number) / (count[d] as number) : 0);
    }
    joints.push(frame.joints);
  });
  (out as { joints: ToeFrame["joints"] }).joints = [
    joints[0] as DigitFrame["joints"],
    joints[1] as DigitFrame["joints"],
  ];
  toeFrames.set(assets, out);
  return out;
}

/* ------------------------------------------------------------------ callus */

/**
 * Where the sole bears the body's weight and callus forms, with how much of the
 * weight each carries (peak plantar pressure is under the heel, the first to
 * third metatarsal heads and the big toe; the lesser toes and the fifth head
 * carry less). A choice of weights from the standard pressure maps, not
 * measured values: docs/research/SKIN-STATES.md C6.
 */
export const CALLUS_SITE_WEIGHT = {
  heel: 1,
  metatarsals: [1, 0.9, 0.75, 0.5, 0.65],
  hallux: 0.8,
} as const;

/** Spread of each site (metres, along and across): the heel pad is broad, a metatarsal head a thumb's width. */
const CALLUS_SPREAD = {
  heel: [0.035, 0.028],
  metatarsal: [0.016, 0.012],
  hallux: [0.014, 0.012],
} as const;

const gauss = (da: number, dc: number, [sa, sc]: readonly [number, number]) =>
  Math.exp(-0.5 * ((da / sa) ** 2 + (dc / sc) ** 2));

/** Callus mask: each pressure site's weight, spread over the sole round it. */
function callusFields(assets: HumanoidAssets): SkinLayerFields {
  const frame = footFrame(assets);
  const sole = skinZones(assets).sole;
  const n = assets.manifest.vertexCount;
  const mask = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const s = frame.side[v] as number;
    if (s === 255 || (sole[v] as number) <= 0) continue;
    const L = frame.length[s as 0 | 1];
    const lm = frame.landmarks[s as 0 | 1];
    const a = frame.along[v] as number;
    const c = frame.across[v] as number;
    const near = (p: FootPoint, spread: readonly [number, number]) =>
      gauss((a - p.along) * L, c - p.across, spread);
    let m = CALLUS_SITE_WEIGHT.heel * near(lm.heel, CALLUS_SPREAD.heel);
    lm.metatarsals.forEach((p, i) => {
      m = Math.max(
        m,
        (CALLUS_SITE_WEIGHT.metatarsals[i] as number) * near(p, CALLUS_SPREAD.metatarsal),
      );
    });
    m = Math.max(m, CALLUS_SITE_WEIGHT.hallux * near(lm.hallux, CALLUS_SPREAD.hallux));
    mask[v] = (sole[v] as number) * m;
  }
  return { mask, coord: null };
}

/**
 * How much callus a figure of this age carries, 0..1: a small child's sole is
 * soft; calluses build with walking, and an older foot's forefoot is harder
 * (the plantar tissue's hardness rises with age across 20 to 82 years). A
 * choice of curve through those facts, docs/research/SKIN-STATES.md C6; a figure
 * with no age counts as thirty.
 */
export function callusAmount(age: number | undefined): number {
  const a = age ?? 30;
  const points: readonly (readonly [number, number])[] = [
    [0, 0.05],
    [6, 0.15],
    [18, 0.4],
    [30, 0.55],
    [50, 0.75],
    [80, 1],
  ];
  const first = points[0] as readonly [number, number];
  const last = points[points.length - 1] as readonly [number, number];
  if (a <= first[0]) return first[1];
  if (a >= last[0]) return last[1];
  let i = 0;
  while ((points[i + 1] as readonly [number, number])[0] < a) i++;
  const p = points[i] as readonly [number, number];
  const q = points[i + 1] as readonly [number, number];
  return p[1] + ((q[1] - p[1]) * (a - p[0])) / (q[0] - p[0]);
}

/**
 * Per vertex, how much callus the sole carries there (0..1, before age): each
 * pressure site's weight spread over the sole round it. The sole's layer
 * (`areas.ts`) paints it as a term of the palmoplantar colour.
 */
export const callusWeights = (assets: HumanoidAssets): Float32Array => callusFields(assets).mask;

/** How much of a figure's callus colour shows over the sole at full age amount (a choice). */
export const CALLUS_OPACITY = 0.85;

/* ------------------------------------------------------- toe joint creases */

const smooth = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * Half the width of the band across a toe at each of its joints, metres: 0.4 of
 * the shorter bone either side of it, within 3 to 7 mm. A choice: the creases'
 * extent along a toe is not measured, and a band wider than a bone would run
 * into the next joint's.
 */
function bandHalfWidth(joints: readonly number[], k: number): number {
  const before =
    k === 0 ? Number.POSITIVE_INFINITY : (joints[k] as number) - (joints[k - 1] as number);
  const after = (joints[k + 1] as number) - (joints[k] as number);
  return Math.min(0.007, Math.max(0.003, 0.4 * Math.min(before, after)));
}

/**
 * A layer's fields from bands across the toes at their joints: the mask is the
 * band's window times the toe's side (`side(under)`), and the coordinate runs
 * 0 to 1 across the band (0.5 at the joint), so the crease layers' folds start
 * and end flat. The tip is not a joint.
 */
function toeBandFields(assets: HumanoidAssets, side: (under: number) => number): SkinLayerFields {
  const frame = toeFrame(assets);
  const P = assets.positions;
  const n = assets.manifest.vertexCount;
  const mask = new Float32Array(n);
  const coord = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const d = frame.digit[v] as number;
    if (d === 0) continue;
    const joints = frame.joints[(P[v * 3] as number) >= 0 ? 0 : 1][d - 1] as readonly number[];
    const along = frame.along[v] as number;
    // The nearest joint that is not the tip.
    let k = 0;
    for (let i = 1; i < joints.length - 1; i++)
      if (Math.abs(along - (joints[i] as number)) < Math.abs(along - (joints[k] as number))) k = i;
    const h = bandHalfWidth(joints, k);
    const off = along - (joints[k] as number);
    if (Math.abs(off) >= h) continue;
    const window = 1 - smooth(0.7, 1, Math.abs(off) / h);
    mask[v] = window * side(frame.under[v] as number);
    coord[v] = Math.min(1, Math.max(1e-4, 0.5 + off / (2 * h)));
  }
  return { mask, coord };
}

/** Depth of the wrinkles over the toes' joints, metres: the hands' knuckle wrinkles' (a choice; none is measured). */
export const TOE_WRINKLE_DEPTH = 0.00012;
/** Wrinkles across a toe joint's band. */
export const TOE_WRINKLE_COUNT = 3;
/** Depth of the creases under the toes' joints, metres: the palm's creases' (a choice). */
export const TOE_CREASE_DEPTH = 0.0003;

/** The fine wrinkles over each joint of each toe, on its top: a mask and a coordinate across the band. */
export const toeWrinkleFields = (assets: HumanoidAssets): SkinLayerFields =>
  toeBandFields(assets, (under) => 1 - smooth(-0.006, -0.002, under));

/** The fold under each joint of each toe: one, where the toe bends. They form before birth. */
export const toeCreaseFields = (assets: HumanoidAssets): SkinLayerFields =>
  toeBandFields(assets, (under) => smooth(0.002, 0.006, under));

/* ---------------------------------------------------------------- toenails */

/**
 * Where a toenail lies on its toe, as fractions of the toe's end (from its last
 * joint to the tip of the flesh): the length of the nail's region, fold
 * included (a lesser toe's distal phalanx is a centimetre or so and its nail
 * most of it; the big toe's is three and its nail a little over half). The base mesh sculpts a faint plate on the big toe and none on the
 * others, so, as the hands' nails are, they are layers on the top of each toe's
 * end. A CHOICE from the proportions of an adult foot (a big toenail is about 19
 * mm long and 15 wide, the lesser toes' about 9 by 7 and the little toe's under
 * 6), as docs/research/SKIN-STATES.md C6 records: no measurement of toenail
 * proportions against the mesh's toes exists.
 */
export const TOENAIL_REGION = [0.82, 0.62, 0.72, 0.78, 0.72] as const;

/** Where the fold, cuticle, lunula and free edge lie along that region (the hands' scheme: `NAIL_LAYOUT`). Only the big toe's lunula shows; a lesser toe's is hidden under the fold (a choice). */
const TOENAIL_LAYOUT = [
  { fold: 0, cuticle: 0.1, lunula: 0.22, freeEdge: 0.95 },
  { fold: 0, cuticle: 0.1, lunula: 0.1, freeEdge: 0.95 },
  { fold: 0, cuticle: 0.1, lunula: 0.1, freeEdge: 0.95 },
  { fold: 0, cuticle: 0.1, lunula: 0.1, freeEdge: 0.95 },
  { fold: 0, cuticle: 0.1, lunula: 0.1, freeEdge: 0.95 },
] as const;

/** The nail's half-width as a fraction of the toe's radius, per toe (a choice: a toenail is broad and flat). */
const TOENAIL_HALF_WIDTH = [0.72, 0.64, 0.62, 0.6, 0.58] as const;
/** The soft edge of the nail's width, as a fraction of the toe's radius. */
const TOENAIL_EDGE = 0.18;
/** How far the free edge and lunula bow toward the tip at the nail's middle, as a fraction of its length (a choice). */
const TOENAIL_BOW = 0.03;

const toenailCache = new WeakMap<
  HumanoidAssets,
  { colour: SkinLayerFields; gloss: Float32Array }
>();

/** The toenails' fields: the colour layer's mask and coordinate, and the plate's gloss mask. */
export function toenailFields(assets: HumanoidAssets): {
  colour: SkinLayerFields;
  gloss: Float32Array;
} {
  const known = toenailCache.get(assets);
  if (known) return known;
  const frame = toeFrame(assets);
  const n = assets.manifest.vertexCount;
  const P = assets.positions;
  const mask = new Float32Array(n);
  const coord = new Float32Array(n);
  const gloss = new Float32Array(n);
  // Per side and toe: where the flesh ends, and the toe's mean radius over its end.
  const tip = new Float32Array(12).fill(Number.NEGATIVE_INFINITY);
  const radius = new Float32Array(12);
  const count = new Uint32Array(12);
  const side = (v: number) => ((P[v * 3] as number) >= 0 ? 0 : 1);
  const slot = (v: number, d: number) => side(v) * 6 + d;
  for (let v = 0; v < n; v++) {
    const d = frame.digit[v] as number;
    if (d === 0) continue;
    const k = slot(v, d);
    tip[k] = Math.max(tip[k] as number, frame.along[v] as number);
  }
  for (let v = 0; v < n; v++) {
    const d = frame.digit[v] as number;
    if (d === 0) continue;
    const k = slot(v, d);
    const joints = frame.joints[side(v)][d - 1] as readonly number[];
    const last = joints[joints.length - 2] as number;
    const a = frame.along[v] as number;
    if (a > last + 0.002 && a < (tip[k] as number) - 0.002) {
      radius[k] =
        (radius[k] as number) + Math.hypot(frame.across[v] as number, frame.under[v] as number);
      count[k] = (count[k] as number) + 1;
    }
  }
  for (let v = 0; v < n; v++) {
    const d = frame.digit[v] as number;
    if (d === 0) continue;
    const k = slot(v, d);
    const joints = frame.joints[side(v)][d - 1] as readonly number[];
    const last = joints[joints.length - 2] as number;
    const end = tip[k] as number;
    const length = (end - last) * (TOENAIL_REGION[d - 1] as number);
    const r = count[k] ? (radius[k] as number) / (count[k] as number) : 0.008;
    const layout = TOENAIL_LAYOUT[d - 1] as (typeof TOENAIL_LAYOUT)[number];
    const across = frame.across[v] as number;
    const half = (TOENAIL_HALF_WIDTH[d - 1] as number) * r;
    const bow = TOENAIL_BOW * (1 - Math.min(1, (across / half) ** 2));
    const u = ((frame.along[v] as number) - (end - length)) / length + bow;
    if (u < layout.fold - 0.1) continue;
    const width = 1 - smooth(half, half + TOENAIL_EDGE * r, Math.abs(across));
    // The nail faces up; at the tip it curls over toward the pad.
    const facing = smooth(-0.25, 0.25, -(frame.under[v] as number) / r);
    const sharp = NAIL_SHARP / length;
    const m = width * facing * smooth(layout.fold - 0.08, layout.fold, u);
    mask[v] = m;
    coord[v] = nailCoordinate(u, layout, sharp);
    gloss[v] = m * smooth(layout.cuticle - sharp, layout.cuticle + sharp, u);
  }
  const fields = { colour: { mask, coord }, gloss };
  toenailCache.set(assets, fields);
  return fields;
}

/* ------------------------------------------------------- friction ridges */

/** The ridges' spacing on a grown foot, metres (a choice inside the 0.4 to 0.6 mm the fingerprint literature gives: C6). */
export const RIDGE_SPACING = 0.00045;
/** The ridges' peak-to-peak relief, metres (a choice: about a fifth of the spacing; C6). */
export const RIDGE_RELIEF = 0.0001;

/**
 * Spacing by age: a child's ridges are finer, in proportion to the growth of
 * the foot between two years and eighteen (a choice: the ridges are laid down
 * before birth, so they widen as the skin grows).
 */
export function ridgeSpacing(age: number | undefined): number {
  const a = age ?? 30;
  const t = Math.min(1, Math.max(0, (a - 2) / 16));
  return RIDGE_SPACING * (0.65 + 0.35 * t);
}

/** Relief by age: ridges flatten as the skin thins (direction from the forensic literature; the curve is a choice). */
export function ridgeRelief(age: number | undefined): number {
  const a = age ?? 30;
  return RIDGE_RELIEF * (1 - 0.5 * smooth(40, 85, a));
}

/** How much the ridges bow round the foot's width: a wave direction turns by this × the offset from the axis, per metre (a choice). */
const FOOT_ARCH = 3;
/** The same round a toe's pad: the loops and arches of a fingertip's pattern, in the toe's own width (a choice). */
const TOE_ARCH = 60;

/**
 * Each vertex's ridge wave direction in 3D (a unit vector across the ridges, in
 * the horizontal plane at rest): along the foot at the heel, the arch and the
 * ball, bowed by the offset from the axis, and over a toe's pad bowed more, so
 * its ridges arch as a fingertip's do.
 */
function waveDirections(assets: HumanoidAssets): Float32Array {
  const frame = footFrame(assets);
  const toes = toeFrame(assets);
  const P = assets.positions;
  const n = assets.manifest.vertexCount;
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const side = frame.side[v] as number;
    if (side === 255) continue;
    const a = frame.axis[side as 0 | 1];
    const l = frame.lateral[side as 0 | 1];
    // Bowed round the foot's width.
    const u = frame.across[v] as number;
    let wx = a[0] - 2 * FOOT_ARCH * u * l[0];
    let wz = a[1] - 2 * FOOT_ARCH * u * l[1];
    const d = toes.digit[v] as number;
    if (d > 0) {
      const t = smooth(-0.004, 0.006, toes.along[v] as number);
      // A toe's `across` runs along (axis × down): +x, so outward on the left foot, inward on the right.
      const c = (toes.across[v] as number) * ((P[v * 3] as number) >= 0 ? 1 : -1);
      const tx = a[0] - 2 * TOE_ARCH * c * l[0];
      const tz = a[1] - 2 * TOE_ARCH * c * l[1];
      wx = (1 - t) * wx + t * tx;
      wz = (1 - t) * wz + t * tz;
    }
    const len = Math.hypot(wx, wz) || 1;
    out[v * 3] = wx / len;
    out[v * 3 + 2] = wz / len;
  }
  return out;
}

/**
The ridge wave directions in the UV plane, as the orientation coordinate: the
 * doubled angle averaged over the faces, then stored (`ridgeOrientationCoordinate`): per face, the wave direction
 * of each corner, taken into the face's plane and carried through the face's UV
 * map, then averaged over the faces round a vertex by their area. The relief is
 * drawn in the UV plane (p = uv × metres per UV), so its orientation has to be
 * measured there.
 */
function ridgeOrientationFields(assets: HumanoidAssets): SkinLayerFields {
  const n = assets.manifest.vertexCount;
  const sole = skinZones(assets).sole;
  const wave = waveDirections(assets);
  const P = assets.positions;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  for (const f of groupFaces(assets, "body")) {
    const q = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
    if (!q.some((v) => (sole[v] as number) > 0)) continue;
    const at = (v: number): [number, number, number] => [
      P[v * 3] as number,
      P[v * 3 + 1] as number,
      P[v * 3 + 2] as number,
    ];
    const uv = [0, 1, 2, 3].map((k) => [
      assets.uvs[(assets.faceUvs[f * 4 + k] as number) * 2] as number,
      assets.uvs[(assets.faceUvs[f * 4 + k] as number) * 2 + 1] as number,
    ]) as [number, number][];
    const p0 = at(q[0] as number);
    const sub3 = (
      a: [number, number, number],
      b: [number, number, number],
    ): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot3 = (a: [number, number, number], b: [number, number, number]) =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const e1 = sub3(at(q[1] as number), p0);
    const e2 = sub3(at(q[3] as number), p0);
    const b1 = [
      (uv[1] as [number, number])[0] - (uv[0] as [number, number])[0],
      (uv[1] as [number, number])[1] - (uv[0] as [number, number])[1],
    ];
    const b2 = [
      (uv[3] as [number, number])[0] - (uv[0] as [number, number])[0],
      (uv[3] as [number, number])[1] - (uv[0] as [number, number])[1],
    ];
    const g11 = dot3(e1, e1);
    const g12 = dot3(e1, e2);
    const g22 = dot3(e2, e2);
    const det = g11 * g22 - g12 * g12;
    if (det < 1e-18) continue;
    const area = Math.sqrt(det);
    for (const v of q) {
      if ((sole[v] as number) <= 0) continue;
      const w: [number, number, number] = [
        wave[v * 3] as number,
        wave[v * 3 + 1] as number,
        wave[v * 3 + 2] as number,
      ];
      // w = alpha e1 + beta e2 (its part in the face's plane), by least squares.
      const r1 = dot3(w, e1);
      const r2 = dot3(w, e2);
      const alpha = (r1 * g22 - r2 * g12) / det;
      const beta = (r2 * g11 - r1 * g12) / det;
      const du = alpha * (b1[0] as number) + beta * (b2[0] as number);
      const dv = alpha * (b1[1] as number) + beta * (b2[1] as number);
      const len = Math.hypot(du, dv);
      if (len < 1e-12) continue;
      // The doubled angle's unit vector, weighted by the face's area.
      const c2 = (du * du - dv * dv) / (len * len);
      const s2 = (2 * du * dv) / (len * len);
      cx[v] = (cx[v] as number) + area * c2;
      cy[v] = (cy[v] as number) + area * s2;
    }
  }
  const mask = new Float32Array(n);
  const coord = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const len = Math.hypot(cx[v] as number, cy[v] as number);
    if ((sole[v] as number) <= 0 || len < 1e-18) continue;
    mask[v] = sole[v] as number;
    coord[v] = ridgeOrientationCoordinate(0.5 * Math.atan2(cy[v] as number, cx[v] as number));
  }
  return { mask, coord };
}

const ridgeCache = new WeakMap<HumanoidAssets, SkinLayerFields>();
const ridgeFieldsOf = (assets: HumanoidAssets): SkinLayerFields => {
  let f = ridgeCache.get(assets);
  if (!f) {
    f = ridgeOrientationFields(assets);
    ridgeCache.set(assets, f);
  }
  return f;
};

/** The sole's friction ridges (`src/surface/ridges.ts`); the coordinate is their orientation. */
export const RIDGE_LAYER: DetailLayer = {
  id: "sole-ridges",
  kind: "detail",
  pattern: "ridges",
  targets: [],
  fields: ridgeFieldsOf,
  paint: ({ age }) => ({ strength: 1, height: ridgeRelief(age), size: ridgeSpacing(age) }),
};

/**
 * The feet's own layers in the stack: the ridges. The rest of the feet's skin
 * (callus, toenails, the toes' wrinkles and creases) is painted by layers the
 * hands share (`areas.ts`), since the atlas has no channels to spare.
 */
export const FOOT_SKIN_LAYERS: readonly SkinLayer[] = [RIDGE_LAYER];
