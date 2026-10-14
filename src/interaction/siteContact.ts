/**
 * Site contact (docs/SELF-CONTACT.md, slice 1): a point of a figure's hand, a
 * finger pad, solved onto a named site of the same figure's body, such as the
 * nose tip or the navel. Framework-free and headless. It works in figure space,
 * on the surface as the renderer skins it, so the touch lands on that figure's
 * own nose whatever its build, and the measured gap is the drawn one.
 *
 * A solve shapes the hand first (`handShapeRotations`: the fingers belong to the
 * shape, the arm to the solver). It then places the shaped hand for an approach
 * that keeps it out of the rest of the body (`placeHand`), and closes the arm's
 * six bones onto the site with `solveArmTarget`, sampling the skinned effector
 * through `createArmSkinnedFrameSampler`. The site is on the same body, and its skin may
 * be weighted to the arm's own bones (the sternum notch to the clavicles), so it
 * is measured again under each solved pose and the solve repeats until it holds
 * still (R4). No joint is translated and no segment is scaled: a site out of
 * reach is reported with its measured gap, and the arm keeps the closest pose
 * it found (R5).
 */
import {
  type ArmSkinnedFrameSampler,
  createArmSkinnedFrameSampler,
} from "../affordance/armSkinnedFrameSampler.ts";
import { SELF_CONTACT_SITES } from "../affordance/registry.ts";
import { SKIN_INFLUENCES } from "../format/assetFormat.ts";
import {
  type FrameOut,
  frameOut,
  LANDMARK_IDS,
  type LandmarkAnchors,
  type LandmarkId,
} from "../foundation/landmarks.ts";
import {
  type ArmPole,
  type ArmTargetReason,
  type ArmTip,
  armChain,
  armTip,
  seedArmTwoBone,
  solveArmTarget,
} from "../rig/armTarget.ts";
import {
  type BoneRotations,
  type PosedBonesScratch,
  posedBonesInto,
  posedBonesScratch,
  type RestBones,
} from "../rig/bones.ts";
import type { SkinFold } from "../rig/dual.ts";
import { type RigData, skinNormals, skinPositions } from "../rig/pose.ts";
import { conjugate, mul, type Quat, quaternionAngle, rotate, slerp } from "../rig/quat.ts";
import { armLength, frameQuat, type HandSide } from "./handContact.ts";

export { SELF_CONTACT_SITES };

/** The figure as the constraint reads it, in its own space: evaluated surface, weights, skeleton, landmarks. */
export interface SiteContactFigure {
  /** Identity of the evaluated geometry below; a new evaluation is a new identity. */
  generation: object;
  restBones: RestBones;
  /** The evaluated render surface at rest, with its normals and skin weights. */
  rest: Float32Array;
  restNormals: Float32Array;
  skinIndex: Uint8Array | Uint16Array;
  skinWeight: Float32Array;
  /** Where the landmarks are held on that surface (`landmarkAnchors`). */
  anchors: LandmarkAnchors;
  /** The source pose's joint folds, when the drawn skin shows them. */
  folds?: readonly SkinFold[];
}

/**
 * A hand shape: the finger bones' local rotations, as rotation vectors in
 * degrees (axis times angle) about the rig's rest axes, for the figure's right
 * hand (+x is the figure's left, +y up, +z forward). The left hand's are its
 * mirror image. A finger the shape leaves out is held straight.
 */
export type HandShapeJoints = Readonly<Record<string, readonly [number, number, number]>>;

/**
 * The curl that folds a finger into the palm: the rig's fingers flex about +x at
 * all three joints, on either hand (measured on the rest skeleton: +x brings each
 * pad toward the palm, the other axes swing it aside).
 */
const curled = (digit: number, knuckle: number, middle: number, tip: number) => ({
  [`finger${digit}-1`]: [knuckle, 0, 0] as const,
  [`finger${digit}-2`]: [middle, 0, 0] as const,
  [`finger${digit}-3`]: [tip, 0, 0] as const,
});

/**
 * The hand shapes a contact may name (docs/SELF-CONTACT.md, R6). Slice 1 has
 * `point`; the others (`pinch`, `flat`, `cup`, `claw`, `fist`) are slice 2's.
 */
export const HAND_SHAPES = {
  /**
   * The index finger straight, the other three curled into the palm and the
   * thumb tucked over them, so the index pad leads and nothing else of the hand
   * reaches as far.
   * CHOICE: 75°, 95° and 55° at the knuckle, middle and end joints of fingers 3
   * to 5 (a loose fist; the little finger a touch tighter), and the thumb turned
   * in toward the palm by 25° to 35° per joint about a mixed +x/+y axis, which
   * the rest-skeleton probe showed carries its pad to the palm side.
   */
  point: {
    "finger1-1": [15, 20, 0],
    "finger1-2": [20, 20, 0],
    "finger1-3": [25, 15, 0],
    ...curled(3, 75, 95, 55),
    ...curled(4, 75, 95, 55),
    ...curled(5, 80, 95, 55),
  },
} as const satisfies Record<string, HandShapeJoints>;

export type HandShape = keyof typeof HAND_SHAPES;

const FINGER_JOINTS = [1, 2, 3, 4, 5].flatMap((digit) =>
  [1, 2, 3].map((joint) => `finger${digit}-${joint}`),
);

/** The rotation vector `r` (degrees) as a unit quaternion. */
function rotationOf(r: readonly [number, number, number]): Quat {
  const radians = (Math.hypot(r[0], r[1], r[2]) * Math.PI) / 180;
  if (radians < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(radians / 2) / Math.hypot(r[0], r[1], r[2]);
  return [r[0] * s, r[1] * s, r[2] * s, Math.cos(radians / 2)];
}

/**
 * `source` with one hand's fingers in `shape`, written into `out`: only that
 * hand's finger bones (`finger1-1` to `finger5-3`) change, each set outright to
 * the shape's rotation (not composed onto the clip's), so a shape looks the same
 * over any base motion. The left hand takes the right hand's mirror image (a
 * rotation vector reflected across the midline keeps its x and negates y and z).
 */
export function handShapeRotations(
  rig: Pick<RigData, "bones">,
  source: BoneRotations,
  shape: HandShape,
  side: HandSide,
  out: BoneRotations,
): BoneRotations {
  if (out.length !== source.length || source.length !== rig.bones.length * 4)
    throw new RangeError("hand shape: source and out must match the rig");
  if (out !== source) out.set(source);
  const joints: HandShapeJoints = HAND_SHAPES[shape];
  const mirror = side === "L" ? -1 : 1;
  for (const joint of FINGER_JOINTS) {
    const bone = rig.bones.indexOf(`${joint}.${side}`);
    if (bone < 0) throw new RangeError(`hand shape: rig has no ${joint}.${side}`);
    const r = joints[joint] ?? [0, 0, 0];
    out.set(rotationOf([r[0], r[1] * mirror, r[2] * mirror]), bone * 4);
  }
  return out;
}

export interface SiteContactInput {
  figure: SiteContactFigure;
  /** The frame's underlying pose: the clip's (with face units) or the static pose. */
  source: BoneRotations;
  /** The touching point, a landmark of one hand: `finger-pad-2.R` (the right index pad), `palm.L`. */
  effector: string;
  /** The touched surface landmark of the same figure: `nose-tip`, `ear-lobe.L`, `navel`. */
  site: string;
  /** The hand's shape, composed before the arm is solved; default `point`. */
  shape?: HandShape;
  /** Metres the effector is held off the site, along the site's outward normal; default 0.001. */
  standoff?: number;
  /** How much of the solve is applied, 0 to 1; default 1. At 0 `out` is `source` byte for byte. */
  weight?: number;
  /** The arm solve's iteration budget per round; default 32. */
  iterations?: number;
  /** Metres between the effector and its goal that count as contact; default 0.004. */
  tolerance?: number;
  /** Receives the constrained pose. Must not alias `source`. */
  out: BoneRotations;
}

/** Why a site contact did not close. */
export type SiteContactReason = Exclude<ArmTargetReason, "orientation-unavailable">;

export interface SiteContactReport {
  status: "reached" | "unreached";
  /** Why it was not reached; absent when it was. */
  reason?: SiteContactReason;
  /** Metres from the skinned effector to its goal (the site, lifted by the standoff), as `out` is drawn. */
  gap: number;
  /** Radians between the pad and its approach orientation, when the effector is a finger pad. */
  orientationError: number | null;
  /** Site-then-arm rounds the solve took (R4), 1 to 4. */
  rounds: number;
}

/**
 * CHOICE: the pad is held 1 mm off the site. R3 asks for the skins to meet within
 * 5 mm; a hair of standoff keeps the drawn pad from dipping under the site's skin.
 */
const DEFAULT_STANDOFF = 0.001;
/** CHOICE: 4 mm to the goal, so with the standoff the pad is within R3's 5 mm of the site. */
const DEFAULT_TOLERANCE = 0.004;
/** CHOICE: R4's budget of site-then-arm rounds, and how still the site must hold to stop early (0.5 mm). */
const MAX_ROUNDS = 4;
const SITE_SETTLED = 0.0005;
/**
 * CHOICE: the finger meets the skin pitched about 35° into it, its pad facing
 * the site. The pad is the pulp, 60% along the end bone (`PAD_ALONG`): a finger
 * poked straight in along the site's normal would sink the fingertip past the
 * pad into the skin, and a finger laid flat along the skin would sink the curled
 * fingers behind it. Between the two, the fingertip's own roundness and the
 * knuckles' height above the skin keep both out. The pitch is searched from 15°
 * to 55° (`PITCHES`), each 10° away from 35° costing as much as 0.05 radians of
 * wrist bend, so a site whose curve sinks one end of the finger takes another.
 */
const APPROACH_PITCH = (35 * Math.PI) / 180;
const PITCHES = [15, 25, 35, 45, 55].map((degrees) => (degrees * Math.PI) / 180);
const PITCH_PREFERENCE = 0.05 / ((10 * Math.PI) / 180);

/** The shaped hand in its wrist's frame: rigid there once the fingers hold their shape. */
interface HeldHand {
  /** The pad's offset from the wrist's head. */
  offset: V3;
  /** The pad's finger frame (x along the finger, z out of the pad). */
  finger: Quat;
  /** A sample of the hand's skin, xyz from the wrist's head: what must stay out of the body. */
  skin: Float32Array;
  /**
   * How far outside the body each point must stay: `CLEARANCE`, but none at the
   * pad itself, which is held on the skin by the standoff alone.
   */
  clearance: Float32Array;
}

type V3 = [number, number, number];

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [
  (a[0] as number) - (b[0] as number),
  (a[1] as number) - (b[1] as number),
  (a[2] as number) - (b[2] as number),
];
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  (a[0] as number) * (b[0] as number) +
  (a[1] as number) * (b[1] as number) +
  (a[2] as number) * (b[2] as number);
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
};
const distance = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(...sub(a, b));

/** The rotation whose basis is a finger: x along it toward the tip, z out of its pad. */
const fingerQuat = (along: V3, pad: V3): Quat =>
  frameQuat({ position: [0, 0, 0], tangent: along, bitangent: cross(pad, along), normal: pad });

/**
 * Where the finger should lie to touch a site whose approach normal is `n`:
 * heading across the skin the way `along` does, pitched `pitch` into it, its pad
 * facing the site.
 */
function approachQuat(n: V3, along: V3, pitch: number): Quat {
  let across = sub(
    along,
    n.map((c) => c * dot(along, n)),
  );
  if (Math.hypot(...across) < 1e-6) across = cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const t = unit(across);
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  return fingerQuat(
    [t[0] * c - n[0] * s, t[1] * c - n[1] * s, t[2] * c - n[2] * s],
    [-n[0] * c - t[0] * s, -n[1] * c - t[1] * s, -n[2] * c - t[2] * s],
  );
}

const FINGER_PAD = /^finger-pad-([1-5])\.(L|R)$/;
const HAND_SIDE = /\.(L|R)$/;

/**
 * Solves `effector` onto `site` and writes the pose into `out` (docs/SELF-CONTACT.md,
 * slice 1). The report's gap is measured on the skinned surface of `out`, the way
 * it is drawn; `reached` means that gap is within tolerance at full weight.
 */
export function solveSiteContact(input: SiteContactInput): SiteContactReport {
  const { figure, source, effector, site, out } = input;
  const shape = input.shape ?? "point";
  const standoff = input.standoff ?? DEFAULT_STANDOFF;
  const weight = input.weight ?? 1;
  const iterations = input.iterations ?? 32;
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  if (out === source) throw new RangeError("site contact: out must not alias source");
  if (out.length !== source.length)
    throw new RangeError("site contact: out must match the source pose's length");
  if (!Number.isFinite(standoff)) throw new RangeError("site contact: standoff must be finite");
  if (!(weight >= 0 && weight <= 1))
    throw new RangeError("site contact: weight must be from 0 to 1");
  if (!(tolerance >= 0 && Number.isFinite(tolerance)))
    throw new RangeError("site contact: tolerance must be finite and non-negative");
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new RangeError("site contact: iterations must be a positive integer");
  if (!(LANDMARK_IDS as readonly string[]).includes(site))
    throw new RangeError(`site contact: no landmark ${site}`);
  const sideMatch = HAND_SIDE.exec(effector);
  if (!sideMatch) throw new RangeError(`site contact: ${effector} is not a landmark of one hand`);
  const side = sideMatch[1] as HandSide;
  const siteId = site as LandmarkId;

  const rest = figure.restBones;
  const chain = armChain(rest, side);
  const fingerBones = FINGER_JOINTS.map((joint) => rest.names.indexOf(`${joint}.${side}`));
  if (fingerBones.some((bone) => bone < 0))
    throw new RangeError(`site contact: the rig lacks a finger of hand ${side}`);
  const sampler = createArmSkinnedFrameSampler({
    generation: figure.generation,
    rest: figure.rest,
    restNormals: figure.restNormals,
    skinIndex: figure.skinIndex,
    skinWeight: figure.skinWeight,
    anchors: figure.anchors,
    restBones: rest,
    sourceRotations: source,
    armBones: chain,
    side,
    effector,
    fingerBones,
    ...(figure.folds && { folds: figure.folds }),
  });
  const pad = frameOut();
  const at = frameOut();
  const report: SiteContactReport = {
    status: "unreached",
    reason: "partial-weight",
    gap: Number.NaN,
    orientationError: null,
    rounds: 0,
  };
  const measure = (rotations: BoneRotations) => {
    sampler.frames(figure.generation, rotations, pad, siteId, at);
    return distance(pad.position, goalOf(at, standoff));
  };

  if (weight === 0) {
    out.set(source);
    report.gap = measure(out);
    return report;
  }

  const shaped = handShapeRotations(
    { bones: rest.names },
    source,
    shape,
    side,
    new Float32Array(source.length),
  );
  const solved = solveRounds(
    figure,
    sampler,
    shaped,
    chain,
    side,
    siteId,
    FINGER_PAD.exec(effector)?.[1],
    standoff,
    iterations,
    tolerance,
    report,
  );

  // The weight blends from the frame's own pose: the arm and the shaped fingers alike.
  out.set(source);
  for (const bone of [...chain, ...fingerBones]) {
    const k = bone * 4;
    const from: Quat = [
      source[k] as number,
      source[k + 1] as number,
      source[k + 2] as number,
      source[k + 3] as number,
    ];
    const to: Quat = [
      solved[k] as number,
      solved[k + 1] as number,
      solved[k + 2] as number,
      solved[k + 3] as number,
    ];
    out.set(weight >= 1 ? to : slerp(from, to, weight), k);
  }
  report.gap = measure(out);
  const reached = weight >= 1 && report.gap <= tolerance;
  report.status = reached ? "reached" : "unreached";
  if (reached) delete report.reason;
  else if (weight < 1) report.reason = "partial-weight";
  else if (report.reason === "reached" || report.reason === undefined)
    report.reason = "tolerance-not-reached";
  return report;
}

/** The point the effector is solved to: the site, lifted off its skin by the standoff. */
function goalOf(site: FrameOut, standoff: number): V3 {
  return [
    site.position[0] + standoff * site.normal[0],
    site.position[1] + standoff * site.normal[1],
    site.position[2] + standoff * site.normal[2],
  ];
}

/**
 * The elbow's side for a reach to `goal`. Below the shoulder the elbow hangs
 * down, back and out, as for hand contact; at the face and head it lifts out to
 * the side, the way an arm is raised to touch the nose or the crown.
 * CHOICE: the blend between the two runs over the goal's height from a fifth of
 * the arm below the shoulder to a fifth above it; the head pole is half an arm
 * out, a tenth down and a fifth forward.
 */
function poleFor(
  rest: RestBones,
  rotations: BoneRotations,
  chain: readonly number[],
  side: HandSide,
  goal: V3,
  bones: PosedBonesScratch,
): ArmPole {
  const heads = posedBonesInto(rest, rotations, bones).heads;
  const shoulder = (chain[1] as number) * 3;
  const sx = heads[shoulder] as number;
  const sy = heads[shoulder + 1] as number;
  const sz = heads[shoulder + 2] as number;
  const reach = armLength(rest, rotations, chain);
  const outward = side === "L" ? 1 : -1;
  const h = Math.min(1, Math.max(0, (goal[1] - sy + 0.2 * reach) / (0.4 * reach)));
  const low: V3 = [0.35, -0.6, -0.25];
  const high: V3 = [0.5, -0.1, 0.2];
  const mix = (k: 0 | 1 | 2) => (low[k] as number) * (1 - h) + (high[k] as number) * h;
  return [sx + outward * mix(0) * reach, sy + mix(1) * reach, sz + mix(2) * reach];
}

/**
 * The full-weight solve, alternating the site's measurement and the arm's solve
 * (R4) for at most `MAX_ROUNDS` rounds, until the site moves less than
 * `SITE_SETTLED` under the solved arm. Each round places the hand for its
 * approach (`placeHand`), then closes the skinned pad onto the goal by position
 * alone: what is left of the approach orientation after that is only reported.
 * An effector that is not a finger pad has no approach and is seeded on its
 * rigid offset from the wrist instead.
 */
function solveRounds(
  figure: SiteContactFigure,
  sampler: ArmSkinnedFrameSampler,
  shaped: BoneRotations,
  chain: readonly number[],
  side: HandSide,
  site: LandmarkId,
  digit: string | undefined,
  standoff: number,
  iterations: number,
  tolerance: number,
  report: SiteContactReport,
): BoneRotations {
  const rest = figure.restBones;
  const pad = frameOut();
  const at = frameOut();
  const bones = posedBonesScratch(rest);
  const dip = digit === undefined ? -1 : rest.names.indexOf(`finger${digit}-3.${side}`);
  /** The pad's finger frame (x along the finger, z out of the pad), from its end joint to the pad. */
  const fingerOf = (rotations: BoneRotations, frame: FrameOut): Quat => {
    const heads = posedBonesInto(rest, rotations, bones).heads;
    const n = unit([frame.normal[0], frame.normal[1], frame.normal[2]]);
    const out = sub(frame.position, [
      heads[dip * 3] as number,
      heads[dip * 3 + 1] as number,
      heads[dip * 3 + 2] as number,
    ]);
    const along = unit(
      sub(
        out,
        n.map((c) => c * dot(out, n)),
      ),
    );
    return fingerQuat(along, n);
  };
  const effector = (rotations: BoneRotations) => {
    sampler.frames(figure.generation, rotations, pad, site, at);
    return { position: [pad.position[0], pad.position[1], pad.position[2]] as const };
  };

  sampler.frames(figure.generation, shaped, pad, site, at);
  const tip = armTip(rest, shaped, chain, [pad.position[0], pad.position[1], pad.position[2]]);
  let goal = goalOf(at, standoff);
  let siteAt: V3 = [at.position[0], at.position[1], at.position[2]];
  // The hand is rigid on the wrist bone once shaped: the pad's offset and finger
  // frame in the wrist's own frame, measured once on the shaped source.
  const wrist = chain[5] as number;
  const forearm = chain[4] as number;
  let held: HeldHand | null = null;
  if (dip >= 0) {
    const posed = posedBonesInto(rest, shaped, bones);
    const w = conjugate(quatAt(posed.world, wrist));
    const head = pointAt(posed.heads, wrist);
    const offset = rotate(w, ...sub(pad.position, head));
    const skin = handSkin(figure, shaped, side, digit as string, w, head);
    const clearance = new Float32Array(skin.length / 3);
    for (let i = 0; i < clearance.length; i++)
      clearance[i] = distance(skin.subarray(i * 3, i * 3 + 3), offset) < PAD_ZONE ? 0 : CLEARANCE;
    held = { offset, finger: mul(w, fingerOf(shaped, pad)), skin, clearance };
  }
  // The forearm's axis at rest, which is also its axis in its own (rest-aligned) frame.
  const forearmAxis = unit(sub(pointAt(rest.heads, wrist), pointAt(rest.heads, forearm)));
  const body = bodyProbe(figure, shaped, side, site);
  let current: BoneRotations = shaped;
  let reachable = true;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    report.rounds = round;
    const pole = poleFor(rest, shaped, chain, side, goal, bones);
    const start = new Float32Array(shaped.length);
    const n = approachNormal(bodyAxis(rest, current, bones), at);
    const approach = held
      ? placeHand(rest, shaped, chain, held, forearmAxis, body, n, goal, pole, bones, start)
      : null;
    if (!approach) seedArmTwoBone(rest, shaped, chain, tip, goal, pole, start);
    // Close the last millimetres on the skinned pad, position only: contact wins.
    const placed = new Float32Array(shaped.length);
    const result = solveArmTarget({
      rest,
      rotations: start,
      chain,
      tip,
      effector,
      target: { position: goal },
      iterations,
      tolerance,
      out: placed,
    });
    reachable = result.geometricallyReachable;
    current = placed;
    sampler.frames(figure.generation, current, pad, site, at);
    report.orientationError = approach ? quaternionAngle(fingerOf(current, pad), approach) : null;
    const moved = distance(at.position, siteAt);
    siteAt = [at.position[0], at.position[1], at.position[2]];
    goal = goalOf(at, standoff);
    if (moved < SITE_SETTLED) break;
  }
  report.reason = reachable ? "tolerance-not-reached" : "geometrically-unreachable";
  return current;
}

/** CHOICE: the headings across the skin tried for the approach, every 10°. */
const HEADINGS = 36;
/** CHOICE: metres the seeded wrist may miss its place by and still count as in reach. */
const WRIST_MISS = 0.002;
/** A score no heading in reach can reach: bend, twist and sinking together stay far below it. */
const OUT_OF_REACH = 1e9;
/** CHOICE: the forearm's own turn (pronation and supination) taken without cost, either way. */
const FREE_TWIST = Math.PI / 2;
/** CHOICE: the share of the hand's turn about the forearm that the forearm's twist bone carries. */
const FOREARM_TWIST_SHARE = 0.5;
/**
 * CHOICE: the hand's skin is kept 1 mm outside the rest of the body's (the
 * foundation allows 2 mm of skin through skin); each millimetre a sampled point
 * of the hand's skin sinks short of that costs as much as 400 radians of wrist
 * bend, so the heading that sinks the hand least is taken whatever its bend,
 * and bend only chooses among headings that sink it equally (most often, not
 * at all).
 */
const CLEARANCE = 0.001;
const CLEARANCE_WEIGHT = 400 / 0.001;
/** CHOICE: the pad's own patch of skin, 1 cm about it, which touches the site by design. */
const PAD_ZONE = 0.01;
/**
 * CHOICE: one body vertex in 2 away from the site, and about 400 points of the
 * hand's skin (with all of the touching finger's two end bones). Sparser
 * samples were measured to miss a curled knuckle sunk 2.5 mm into a belly a
 * finger's length from the navel.
 */
const BODY_STRIDE = 2;
const HAND_POINTS = 400;
/** Beyond this, metres, a point is in the open whatever the nearest skin's facing. */
const BODY_REACH = 0.06;
/** The body sample's grid cell, metres. */
const CELL = 0.02;
/** CHOICE: within 4 cm of the site (a finger's two end bones) the body's skin is sampled whole. */
const SITE_NEAR = 0.04;

/** The arm's own bones on a side, whose skin is the arm's rather than the body's it touches. */
const ARM_BONE = (side: HandSide) =>
  new RegExp(`^(upperarm0[12]|lowerarm0[12]|wrist|metacarpal[1-4]|finger[1-5]-[1-3])\\.${side}$`);
/** The hand's bones on a side, whose skin moves rigidly with the wrist once shaped. */
const HAND_BONE = (side: HandSide) =>
  new RegExp(`^(wrist|metacarpal[1-4]|finger[1-5]-[1-3])\\.${side}$`);

/** Each vertex's share of weight on the bones `of` names, for the vertices `stride` apart. */
function weightOn(figure: SiteContactFigure, of: RegExp): Float32Array {
  const { skinIndex, skinWeight, restBones } = figure;
  const marked = restBones.names.map((name) => of.test(name));
  const count = skinIndex.length / SKIN_INFLUENCES;
  const share = new Float32Array(count);
  for (let v = 0; v < count; v++)
    for (let k = 0; k < SKIN_INFLUENCES; k++) {
      const at = v * SKIN_INFLUENCES + k;
      if (marked[skinIndex[at] as number])
        share[v] = (share[v] as number) + (skinWeight[at] as number);
    }
  return share;
}

/** The vertices `kept` of the figure skinned by `rotations`, with their normals when asked. */
function skinSome(
  figure: SiteContactFigure,
  rotations: BoneRotations,
  kept: readonly number[],
  withNormals: boolean,
): { positions: Float32Array; normals: Float32Array | null } {
  const { rest, restNormals, skinIndex, skinWeight, restBones } = figure;
  const count = kept.length;
  const p = new Float32Array(count * 3);
  const n = new Float32Array(count * 3);
  const index =
    skinIndex instanceof Uint8Array
      ? new Uint8Array(count * SKIN_INFLUENCES)
      : new Uint16Array(count * SKIN_INFLUENCES);
  const weight = new Float32Array(count * SKIN_INFLUENCES);
  kept.forEach((v, i) => {
    p.set(rest.subarray(v * 3, v * 3 + 3), i * 3);
    n.set(restNormals.subarray(v * 3, v * 3 + 3), i * 3);
    index.set(
      skinIndex.subarray(v * SKIN_INFLUENCES, (v + 1) * SKIN_INFLUENCES),
      i * SKIN_INFLUENCES,
    );
    weight.set(
      skinWeight.subarray(v * SKIN_INFLUENCES, (v + 1) * SKIN_INFLUENCES),
      i * SKIN_INFLUENCES,
    );
  });
  return {
    positions: skinPositions(restBones, rotations, p, index, weight, new Float32Array(count * 3)),
    normals: withNormals
      ? skinNormals(restBones, rotations, n, index, weight, new Float32Array(count * 3))
      : null,
  };
}

/**
 * A sample of the hand's skin in its wrist's frame (`wristInverse` undoes the
 * wrist's posed rotation, `head` is its posed head), skinned in the shaped pose:
 * the hand is rigid on the wrist once its fingers hold their shape.
 */
function handSkin(
  figure: SiteContactFigure,
  shaped: BoneRotations,
  side: HandSide,
  digit: string,
  wristInverse: Quat,
  head: V3,
): Float32Array {
  const share = weightOn(figure, HAND_BONE(side));
  // The touching finger's last two bones, all of them: they come closest to the skin.
  const leading = weightOn(figure, new RegExp(`^finger${digit}-[23]\\.${side}$`));
  const hand: number[] = [];
  share.forEach((s, v) => {
    if (s > 0.5) hand.push(v);
  });
  const stride = Math.max(1, Math.ceil(hand.length / HAND_POINTS));
  const kept = hand.filter((v, i) => i % stride === 0 || (leading[v] as number) > 0.5);
  const { positions } = skinSome(figure, shaped, kept, false);
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3)
    out.set(
      rotate(
        wristInverse,
        (positions[i] as number) - head[0],
        (positions[i + 1] as number) - head[1],
        (positions[i + 2] as number) - head[2],
      ),
      i,
    );
  return out;
}

/**
 * A coarse sample of the body's skin, the touching arm's left out, skinned in
 * the frame's pose and held in a grid: enough to tell whether a point of the
 * hand is inside the body. The arm's shoulder (`shoulder01`) stays in the
 * sample: the arm solve turns it only a little, and the chest skin weighted to
 * it is exactly what a hand at the sternum must not sink into.
 */
interface BodyProbe {
  /** Metres by which `p` is less than `clearance` outside the nearest skin (0 when clear). */
  sunk(p: V3, clearance: number): number;
}

function bodyProbe(
  figure: SiteContactFigure,
  rotations: BoneRotations,
  side: HandSide,
  site: LandmarkId,
): BodyProbe {
  const share = weightOn(figure, ARM_BONE(side));
  const { rest } = figure;
  // Every vertex near the site (measured at rest), one in `BODY_STRIDE` elsewhere: a finger
  // touching a thin or tightly curved site (an ear lobe, a chin) needs all the skin there.
  const anchor = (figure.anchors.vertices as Partial<Record<string, { vertex: number }>>)[site];
  const restSite: V3 = anchor
    ? pointAt(rest, anchor.vertex)
    : [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const near = SITE_NEAR * SITE_NEAR;
  const kept: number[] = [];
  for (let v = 0; v < share.length; v++) {
    if ((share[v] as number) >= 0.5) continue;
    const dx = (rest[v * 3] as number) - restSite[0];
    const dy = (rest[v * 3 + 1] as number) - restSite[1];
    const dz = (rest[v * 3 + 2] as number) - restSite[2];
    if (v % BODY_STRIDE === 0 || dx * dx + dy * dy + dz * dz < near) kept.push(v);
  }
  const { positions, normals } = skinSome(figure, rotations, kept, true);
  const facing = normals as Float32Array;
  const cellOf = (x: number) => Math.floor(x / CELL);
  const key = (x: number, y: number, z: number) =>
    ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < kept.length; i++) {
    const k = key(
      cellOf(positions[i * 3] as number),
      cellOf(positions[i * 3 + 1] as number),
      cellOf(positions[i * 3 + 2] as number),
    );
    const cell = grid.get(k);
    if (cell) cell.push(i);
    else grid.set(k, [i]);
  }
  const span = Math.ceil(BODY_REACH / CELL);
  return {
    sunk(q, clearance) {
      let best = BODY_REACH * BODY_REACH;
      let nearest = -1;
      const cx = cellOf(q[0]);
      const cy = cellOf(q[1]);
      const cz = cellOf(q[2]);
      // Shell by shell outward: once the nearest found is nearer than the next shell can be, stop.
      for (let r = 0; r <= span; r++) {
        for (let x = cx - r; x <= cx + r; x++)
          for (let y = cy - r; y <= cy + r; y++)
            for (let z = cz - r; z <= cz + r; z++) {
              if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== r) continue;
              const cell = grid.get(key(x, y, z));
              if (!cell) continue;
              for (const i of cell) {
                const dx = q[0] - (positions[i * 3] as number);
                const dy = q[1] - (positions[i * 3 + 1] as number);
                const dz = q[2] - (positions[i * 3 + 2] as number);
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < best) {
                  best = d2;
                  nearest = i;
                }
              }
            }
        if (nearest >= 0 && best <= r * CELL * (r * CELL)) break;
      }
      if (nearest < 0) return 0;
      const k = nearest * 3;
      const out =
        (q[0] - (positions[k] as number)) * (facing[k] as number) +
        (q[1] - (positions[k + 1] as number)) * (facing[k + 1] as number) +
        (q[2] - (positions[k + 2] as number)) * (facing[k + 2] as number);
      return Math.max(0, clearance - out);
    },
  };
}

/**
 * Places the hand for an approach: of the headings across the skin, the one
 * whose wrist the arm can reach and whose hand needs the least bend at the
 * wrist. The finger's frame at the goal fixes the hand's (the hand is rigid on
 * the wrist once shaped), which fixes where the wrist must be; the elbow and
 * shoulder are seeded to put it there (`seedArmTwoBone`), and the wrist is
 * turned to the hand, half of its turn about the forearm moved into the
 * forearm's twist bone, as a forearm turns rather than a wrist wrenches.
 * A heading that sinks the hand's joints into the rest of the body costs more,
 * and one whose wrist is out of reach loses to any in reach; with none in reach
 * the nearest is taken and left to the skinned polish to close or report.
 * Writes the pose into `out` and returns the finger's target frame.
 */
function placeHand(
  rest: RestBones,
  shaped: BoneRotations,
  chain: readonly number[],
  held: HeldHand,
  forearmAxis: V3,
  body: BodyProbe,
  n: V3,
  goal: V3,
  pole: ArmPole,
  bones: PosedBonesScratch,
  out: BoneRotations,
): Quat {
  const wrist = chain[5] as number;
  const forearm = chain[4] as number;
  const t = unit(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const b = cross(n, t);
  const wristOnly: ArmTip = { position: [0, 0, 0] };
  const candidate = new Float32Array(shaped.length);
  let best = approachQuat(n, t, APPROACH_PITCH);
  let bestScore = Number.POSITIVE_INFINITY;
  for (const pitch of PITCHES)
    for (let k = 0; k < HEADINGS; k++) {
      const h = (2 * Math.PI * k) / HEADINGS;
      const finger = approachQuat(
        n,
        [
          t[0] * Math.cos(h) + b[0] * Math.sin(h),
          t[1] * Math.cos(h) + b[1] * Math.sin(h),
          t[2] * Math.cos(h) + b[2] * Math.sin(h),
        ],
        pitch,
      );
      const hand = mul(finger, conjugate(held.finger));
      const offset = rotate(hand, ...held.offset);
      const at: V3 = [goal[0] - offset[0], goal[1] - offset[1], goal[2] - offset[2]];
      seedArmTwoBone(rest, shaped, chain, wristOnly, at, pole, candidate);
      const seeded = posedBonesInto(rest, candidate, bones);
      // A wrist the arm cannot put there is out of reach for this heading.
      const miss = distance(pointAt(seeded.heads, wrist), at);
      const local = mul(conjugate(quatAt(seeded.world, forearm)), hand);
      const twist = twistAbout(local, forearmAxis);
      const bend = quaternionAngle(mul(conjugate(twist), local), [0, 0, 0, 1]);
      // Part of the turn about the forearm to its twist bone: the wrist's head stays
      // put, as it lies on that bone's axis, and the hand ends where it was asked to.
      const share = slerp([0, 0, 0, 1], twist, FOREARM_TWIST_SHARE);
      candidate.set(mul(quatAt(candidate, forearm), share), forearm * 4);
      candidate.set(mul(conjugate(share), local), wrist * 4);
      let score =
        (miss > WRIST_MISS ? OUT_OF_REACH + miss / WRIST_MISS : 0) +
        bend +
        Math.max(0, Math.abs(twistAngle(twist, forearmAxis)) - FREE_TWIST) +
        PITCH_PREFERENCE * Math.abs(pitch - APPROACH_PITCH);
      // The hand's skin where this heading puts it (the wrist placed at `at`, turned as
      // `hand`), given up on as soon as it costs more than the best heading so far.
      const skin = held.skin;
      for (let i = 0; i < skin.length && score < bestScore; i += 3) {
        const p = rotate(hand, skin[i] as number, skin[i + 1] as number, skin[i + 2] as number);
        const clearance = held.clearance[i / 3] as number;
        score +=
          CLEARANCE_WEIGHT * body.sunk([at[0] + p[0], at[1] + p[1], at[2] + p[2]], clearance);
      }
      if (score >= bestScore) continue;
      bestScore = score;
      best = finger;
      out.set(candidate);
    }
  return best;
}

/** The body's axis, pelvis to skull, whose nearest point says which way is out from a site. */
const AXIS_BONES = [
  "root",
  "spine05",
  "spine04",
  "spine03",
  "spine02",
  "spine01",
  "neck01",
  "neck02",
  "neck03",
  "head",
];
/**
 * CHOICE: the approach is the skin's normal, plus as much again of the way out
 * from the body's axis, plus as much again of the figure's forward (+z). With
 * less forward, a hand at an ear lobe was measured to settle above its own
 * shoulder, behind the head; with this, it comes in from the cheek's side.
 */
const RADIAL_WEIGHT = 1;
const FORWARD_WEIGHT = 1;

/** The body's axis as posed: the joints of `AXIS_BONES`, in order (the arm moves none of them). */
function bodyAxis(rest: RestBones, rotations: BoneRotations, bones: PosedBonesScratch): V3[] {
  const heads = posedBonesInto(rest, rotations, bones).heads;
  return AXIS_BONES.map((name) => {
    const bone = rest.names.indexOf(name);
    if (bone < 0) throw new RangeError(`site contact: the rig has no ${name}`);
    return pointAt(heads, bone);
  });
}

/** The point of the axis nearest `p`. */
function nearestOnAxis(axis: readonly V3[], p: ArrayLike<number>): V3 {
  let nearest = axis[0] as V3;
  let best = Number.POSITIVE_INFINITY;
  for (let k = 1; k < axis.length; k++) {
    const a = axis[k - 1] as V3;
    const s = sub(axis[k] as V3, a);
    const u = Math.min(1, Math.max(0, dot(sub(p, a), s) / Math.max(dot(s, s), 1e-12)));
    const q: V3 = [a[0] + s[0] * u, a[1] + s[1] * u, a[2] + s[2] * u];
    const d = distance(p, q);
    if (d < best) {
      best = d;
      nearest = q;
    }
  }
  return nearest;
}

/**
 * The direction the finger comes in against: the site's skin normal turned
 * toward the way out from the body's axis. A skin normal alone can face back
 * into the body: under the chin it faces the chest, behind an ear lobe the neck.
 * A hand that arrives along it would sink into what it faces. Out from the axis
 * the hand stays in the open, in front of the face and to the side of the head.
 */
function approachNormal(axis: readonly V3[], site: FrameOut): V3 {
  const out = unit(sub(site.position, nearestOnAxis(axis, site.position)));
  const n = unit([site.normal[0], site.normal[1], site.normal[2]]);
  return unit([
    n[0] + RADIAL_WEIGHT * out[0],
    n[1] + RADIAL_WEIGHT * out[1],
    n[2] + RADIAL_WEIGHT * out[2] + FORWARD_WEIGHT,
  ]);
}

/** The part of `q` that turns about `axis` (unit), as a rotation. */
function twistAbout(q: Quat, axis: V3): Quat {
  const d = q[0] * axis[0] + q[1] * axis[1] + q[2] * axis[2];
  const l = Math.hypot(d, q[3]);
  if (l < 1e-9) return [0, 0, 0, 1];
  return [(axis[0] * d) / l, (axis[1] * d) / l, (axis[2] * d) / l, q[3] / l];
}

/** The signed angle of a twist about `axis`, in (-π, π]. */
function twistAngle(twist: Quat, axis: V3): number {
  const s = twist[0] * axis[0] + twist[1] * axis[1] + twist[2] * axis[2];
  const angle = 2 * Math.atan2(s, twist[3]);
  return angle > Math.PI ? angle - 2 * Math.PI : angle < -Math.PI ? angle + 2 * Math.PI : angle;
}

function pointAt(values: ArrayLike<number>, bone: number): V3 {
  return [
    values[bone * 3] as number,
    values[bone * 3 + 1] as number,
    values[bone * 3 + 2] as number,
  ];
}

function quatAt(values: ArrayLike<number>, bone: number): Quat {
  return [
    values[bone * 4] as number,
    values[bone * 4 + 1] as number,
    values[bone * 4 + 2] as number,
    values[bone * 4 + 3] as number,
  ];
}
