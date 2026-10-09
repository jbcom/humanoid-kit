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
import { jointPosition } from "../../format/assetFormat.ts";
import type { DetailLayer, SkinLayer, SkinLayerFields, SurfaceLayer } from "../layers.ts";
import { type DigitFrame, digitFrame, type Vec3 } from "./digitFrame.ts";
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
  const side = new Uint8Array(n).fill(255);
  const along = new Float32Array(n);
  const across = new Float32Array(n);
  const length: number[] = [];
  const landmarks: FootLandmarks[] = [];
  const at = (joint: string): [number, number, number] => {
    const p = new Float32Array(3);
    jointPosition(assets, assets.positions, joint, p, 0);
    return [p[0] as number, p[1] as number, p[2] as number];
  };
  (["L", "R"] as const).forEach((name, s) => {
    const sign = name === "L" ? 1 : -1;
    const mine = (v: number) => (foot[v] as number) > 0.5 && Math.sign(P[v * 3] as number) === sign;
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
      include: (v) => (foot[v] as number) > 0.5 && Math.sign(P[v * 3] as number) === sign,
      lines,
      // The sole faces down at rest.
      facing: [0, -1, 0],
    });
    for (let v = 0; v < n; v++) {
      if (frame.digit[v] === 0) continue;
      out.digit[v] = frame.digit[v] as number;
      out.along[v] = frame.along[v] as number;
      out.across[v] = frame.across[v] as number;
      out.under[v] = frame.under[v] as number;
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
 * Thickened stratum corneum over the sole's pressure sites: yellower and a
 * little paler where it is thick (the blood under it shows less), and drier, so
 * duller. The tint is a choice; `callusAmount` sets how much.
 */
export const CALLUS_LAYER: SkinLayer = {
  id: "callus",
  blend: "multiply",
  targets: [],
  fields: callusFields,
  paint: ({ age }) => ({ strength: callusAmount(age), stops: [[1.04, 0.97, 0.86]] }),
};

/** How much duller (rougher, less specular) callus is at full strength: dry keratin scatters light, it does not mirror it (a choice). */
export const CALLUS_ROUGHNESS = 0.2;
export const CALLUS_SPECULAR = -0.12;

export const CALLUS_SURFACE_LAYER: SurfaceLayer = {
  id: "callus-matte",
  kind: "surface",
  targets: [],
  fields: callusFields,
  paint: ({ age }) => ({
    strength: callusAmount(age),
    roughness: CALLUS_ROUGHNESS,
    specular: CALLUS_SPECULAR,
  }),
};

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

/** How prominent the skin's fine wrinkles are by age, 0..1: faint in a child, deepening as the skin loses its elasticity (a choice, with the direction well established). */
export function wrinkleAmount(age: number | undefined): number {
  const a = age ?? 30;
  const points: readonly (readonly [number, number])[] = [
    [0, 0.3],
    [12, 0.5],
    [30, 0.7],
    [60, 0.9],
    [85, 1],
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

/** Depth of the wrinkles over the toes' joints, metres: the hands' knuckle wrinkles' (a choice; none is measured). */
export const TOE_WRINKLE_DEPTH = 0.00012;
/** Wrinkles across a toe joint's band. */
export const TOE_WRINKLE_COUNT = 3;
/** Depth of the creases under the toes' joints, metres: the palm's creases' (a choice). */
export const TOE_CREASE_DEPTH = 0.0003;

/** Fine wrinkles over each joint of each toe, on its top. */
export const TOE_WRINKLE_LAYER: DetailLayer = {
  id: "toe-wrinkles",
  kind: "detail",
  pattern: "creases",
  targets: [],
  fields: (assets) => toeBandFields(assets, (under) => 1 - smooth(-0.006, -0.002, under)),
  paint: ({ age }) => ({
    strength: wrinkleAmount(age),
    height: TOE_WRINKLE_DEPTH,
    size: TOE_WRINKLE_COUNT,
  }),
};

/** The fold under each joint of each toe: one, where the toe bends. They form before birth, so no age. */
export const TOE_CREASE_LAYER: DetailLayer = {
  id: "toe-creases",
  kind: "detail",
  pattern: "creases",
  targets: [],
  fields: (assets) => toeBandFields(assets, (under) => smooth(0.002, 0.006, under)),
  paint: () => ({ strength: 1, height: TOE_CREASE_DEPTH, size: 1 }),
};

/** The feet's layers, in the order they are applied. */
export const FOOT_SKIN_LAYERS: readonly SkinLayer[] = [
  CALLUS_LAYER,
  CALLUS_SURFACE_LAYER,
  TOE_WRINKLE_LAYER,
  TOE_CREASE_LAYER,
];
