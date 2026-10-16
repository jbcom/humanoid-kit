/**
 * The hand contact constraint (docs/INTERACTIONS.md, "Hand contact
 * constraint"): a running interaction's hand-to-hand contact turned into an
 * arm pose on one figure. Framework-free. Each `update` reads the runtime's
 * shared `contactTarget`, converts it into the figure's lifted space, and
 * solves the contact's arm with `solveArmTarget`, closing on the figure's
 * final skinned hand frame (`createArmSkinnedFrameSampler`). It never moves a
 * joint or scales a segment: a target out of reach is reported.
 */
import { createArmSkinnedFrameSampler } from "../affordance/armSkinnedFrameSampler.ts";
import { type FrameOut, frameOut, type LandmarkAnchors } from "../foundation/landmarks.ts";
import type { Vec3 } from "../presence/presence.ts";
import {
  type ArmTargetReason,
  type ArmTargetStatus,
  armChain,
  armTip,
  seedArmTwoBone,
  solveArmTarget,
} from "../rig/armTarget.ts";
import { type BoneRotations, posedBones, type RestBones } from "../rig/bones.ts";
import type { SkinFold } from "../rig/dual.ts";
import { type Quat, slerp } from "../rig/quat.ts";
import { type InteractionDefinition, type Phase, type RoleName, splitPoint } from "./definition.ts";
import { DEFAULT_PHASE_SECONDS, type Interaction } from "./runtime.ts";

export type HandSide = "L" | "R";

/** Why a binding may not move this figure's arm. */
export type HandContactRefusal =
  | "not-a-participant"
  | "not-claimed"
  | "not-a-hand-contact"
  | "unknown-contact";

/**
 * Where the constraint is: `idle` (the source pose, untouched), `refused` (a
 * binding this figure may not act on), `blending-in`, `holding`, `releasing`
 * (across the release phase) or `fading` (after a graceful cancel).
 */
export type HandContactState =
  | "idle"
  | "refused"
  | "blending-in"
  | "holding"
  | "releasing"
  | "fading";

export interface HandContactOptions {
  /** Seconds of the contact's first active phase over which the hand blends on; default 0.25. */
  blendIn?: number;
  /** Seconds a graceful cancel fades over, on the caller's clock; default 0.3. */
  blendOut?: number;
  /** Metres between the final hand frame and the target that count as contact; default 0.01. */
  tolerance?: number;
  /** Radians between the palm and its handshake orientation that count as met; default 0.35. */
  orientationTolerance?: number;
  /** The arm solve's iteration budget; default 24. */
  iterations?: number;
}

/** Which contact of which running interaction this figure takes, as which role. */
export interface HandContactBinding {
  interaction: Interaction;
  role: RoleName;
  /** The contact's `name`, or its index in the definition. */
  contact: string | number;
}

/** The figure as drawn: its presence id, evaluated surface and lifted group's placement. */
export interface HandContactFigure {
  /** The figure's presence id, checked against `interaction.roles[role]`. */
  participant: string;
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
  /** The drawn skinning path: mixed by default, or linear for a custom material. */
  skinMode?: "mixed" | "linear";
  /** The source pose's joint folds, when the drawn skin shows them. */
  folds?: readonly SkinFold[];
  /**
   * The lifted group's world matrix, column-major (three's `matrixWorld.elements`):
   * figure space, the space the drawn meshes and the hand sampler share, to world.
   */
  figureToWorld: ArrayLike<number>;
}

export interface HandContactInput {
  binding: HandContactBinding | null;
  figure: HandContactFigure;
  /** The frame's underlying pose: the clip's (with face units) or the static pose. */
  source: BoneRotations;
  /** Seconds since the previous update, on the caller's clock (used only to fade after a cancel). */
  dt: number;
  /** Receives the constrained pose; the source byte for byte at weight 0. Must not alias `source`. */
  out: BoneRotations;
}

export interface HandContactReport {
  state: HandContactState;
  /** The contact's hand for this role, once resolved. */
  side: HandSide | null;
  /** How much of the solve is applied, 0 to 1. */
  weight: number;
  /** The final contact result, or null when nothing was solved this update. */
  status: ArmTargetStatus | null;
  reason: ArmTargetReason | HandContactRefusal | null;
  /** Metres from the final rendered hand frame to the target; NaN when nothing was solved. */
  distance: number;
  /** Radians from the palm to its handshake orientation, or null when nothing was solved. */
  orientationError: number | null;
  /** Whether the target lies within the arm's unchanged segment lengths. */
  geometricallyReachable: boolean | null;
  /** The target in world space (the last one, while releasing or fading). */
  target: Vec3;
  /** The final rendered hand frame's position in world space. */
  hand: Vec3;
}

export interface HandContact {
  /** Writes the frame's pose into `input.out` and returns the report (reused: copy what you keep). */
  update(input: HandContactInput): HandContactReport;
  readonly report: Readonly<HandContactReport>;
}

const PHASE_ORDER: readonly Phase[] = ["approach", "align", "act", "release"];

/**
 * The hand a contact asks of `role` (its endpoint `role:hand.L` or `role:hand.R`),
 * or null when the contact is unknown, the role is not one of its two ends, or
 * that end is not a hand.
 */
export function handContactSide(
  definition: InteractionDefinition,
  contact: string | number,
  role: RoleName,
): HandSide | null {
  const c =
    typeof contact === "number"
      ? definition.contacts?.[contact]
      : definition.contacts?.find((k) => k.name === contact);
  if (!c) return null;
  for (const point of [c.a, c.b]) {
    const [who, name] = splitPoint(point);
    if (who !== role) continue;
    if (name === "hand.L") return "L";
    if (name === "hand.R") return "R";
  }
  return null;
}

function contactOf(definition: InteractionDefinition, contact: string | number) {
  return typeof contact === "number"
    ? definition.contacts?.[contact]
    : definition.contacts?.find((k) => k.name === contact);
}

/**
 * The palm's handshake orientation in figure space (+x left, +y up, +z forward),
 * as the hand frame's basis (tangent along the fingers, normal out of the palm):
 * the palm faces the figure's midline and the fingers point forward, so two
 * figures facing each other meet palm to palm.
 */
function palmOrientation(
  rest: RestBones,
  rotations: BoneRotations,
  chain: readonly number[],
  goal: readonly [number, number, number],
  side: HandSide,
): Quat {
  // Fingers continue the forearm (a neutral wrist), the palm turned to the midline.
  const heads = posedBones(rest, rotations).heads;
  const elbow = (chain[3] as number) * 3;
  const tx = goal[0] - (heads[elbow] as number);
  const ty = goal[1] - (heads[elbow + 1] as number);
  const tz = goal[2] - (heads[elbow + 2] as number);
  const tl = Math.hypot(tx, ty, tz) || 1;
  const t: Vec3 = [tx / tl, ty / tl, tz / tl];
  const mx = side === "R" ? 1 : -1;
  const along = mx * t[0];
  let n: Vec3 = [mx - along * t[0], -along * t[1], -along * t[2]];
  const nl = Math.hypot(n[0], n[1], n[2]);
  n = nl > 1e-6 ? [n[0] / nl, n[1] / nl, n[2] / nl] : [0, 1, 0];
  const b: Vec3 = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  return frameQuat({ position: [0, 0, 0], tangent: t, bitangent: b, normal: n });
}

/** The rotation whose basis columns are the frame's tangent, bitangent and normal. */
export function frameQuat(frame: FrameOut): Quat {
  const [m00, m10, m20] = frame.tangent;
  const [m01, m11, m21] = frame.bitangent;
  const [m02, m12, m22] = frame.normal;
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w);
  return [x / n, y / n, z / n, w / n];
}

/** `m` (column-major 4×4) applied to the point. */
function transformInto(m: ArrayLike<number>, p: ArrayLike<number>, out: Vec3): Vec3 {
  const x = p[0] as number;
  const y = p[1] as number;
  const z = p[2] as number;
  out[0] = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
  out[1] = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
  out[2] = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
  return out;
}

/** The inverse of an affine column-major 4×4 applied to the point. */
function inverseTransformInto(m: ArrayLike<number>, p: ArrayLike<number>, out: Vec3): Vec3 {
  const a = m[0] as number;
  const b = m[4] as number;
  const c = m[8] as number;
  const d = m[1] as number;
  const e = m[5] as number;
  const f = m[9] as number;
  const g = m[2] as number;
  const h = m[6] as number;
  const k = m[10] as number;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (!(Math.abs(det) > 1e-12)) throw new RangeError("hand contact: figureToWorld is singular");
  const x = (p[0] as number) - (m[12] as number);
  const y = (p[1] as number) - (m[13] as number);
  const z = (p[2] as number) - (m[14] as number);
  out[0] = ((e * k - f * h) * x + (c * h - b * k) * y + (b * f - c * e) * z) / det;
  out[1] = ((f * g - d * k) * x + (a * k - c * g) * y + (c * d - a * f) * z) / det;
  out[2] = ((d * h - e * g) * x + (b * g - a * h) * y + (a * e - b * d) * z) / det;
  return out;
}

const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

export function createHandContact(options: HandContactOptions = {}): HandContact {
  const blendIn = options.blendIn ?? 0.25;
  const blendOut = options.blendOut ?? 0.3;
  const tolerance = options.tolerance ?? 0.01;
  const orientationTolerance = options.orientationTolerance ?? 0.35;
  const iterations = options.iterations ?? 24;
  for (const [name, value] of [
    ["blendIn", blendIn],
    ["blendOut", blendOut],
    ["tolerance", tolerance],
    ["orientationTolerance", orientationTolerance],
  ] as const)
    if (!(value >= 0 && Number.isFinite(value)))
      throw new RangeError(`hand contact: ${name} must be finite and non-negative`);
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new RangeError("hand contact: iterations must be a positive integer");

  const report: HandContactReport = {
    state: "idle",
    side: null,
    weight: 0,
    status: null,
    reason: null,
    distance: Number.NaN,
    orientationError: null,
    geometricallyReachable: null,
    target: [0, 0, 0],
    hand: [0, 0, 0],
  };
  /** The interaction this constraint last followed, and what it remembers of it. */
  let following: Interaction | null = null;
  let side: HandSide | null = null;
  let hasTarget = false;
  let held = false;
  let releaseFrom = -1;
  let fadeFrom = 0;
  let fadeTime = 0;
  const scratchTarget: Vec3 = [0, 0, 0];
  const local: Vec3 = [0, 0, 0];
  const sampled = frameOut();
  /** The two-bone starting pose and the full-weight solve, sized to the rig on first use. */
  let seed = new Float32Array(0);
  let solved = new Float32Array(0);

  const forget = () => {
    following = null;
    side = null;
    hasTarget = false;
    held = false;
    releaseFrom = -1;
    fadeFrom = 0;
    fadeTime = 0;
  };

  const leave = (
    input: HandContactInput,
    state: HandContactState,
    reason: HandContactRefusal | null,
  ) => {
    input.out.set(input.source);
    report.state = state;
    report.weight = 0;
    report.status = null;
    report.reason = reason;
    report.distance = Number.NaN;
    report.orientationError = null;
    report.geometricallyReachable = null;
    return report;
  };

  /** How far the graceful fade has come, advanced by the caller's step. */
  const fade = (dt: number) => {
    fadeTime += Math.max(0, dt);
    return blendOut > 0 ? fadeFrom * (1 - smooth(fadeTime / blendOut)) : 0;
  };

  const solve = (input: HandContactInput, weight: number, state: HandContactState) => {
    const { figure, source, out } = input;
    const hand = side as HandSide;
    const rest = figure.restBones;
    const chain = armChain(rest, hand);
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
      side: hand,
      ...(figure.skinMode && { skinMode: figure.skinMode }),
      ...(figure.folds && { folds: figure.folds }),
    });
    const sourceHand = sampler.frame(figure.generation, source, sampled);
    const tip = armTip(rest, source, chain, [
      sourceHand.position[0],
      sourceHand.position[1],
      sourceHand.position[2],
    ]);
    inverseTransformInto(figure.figureToWorld, report.target, local);
    const goal: [number, number, number] = [local[0], local[1], local[2]];
    // The elbow bends down, back and out to the arm's own side (+x is the figure's left).
    const heads = posedBones(rest, source).heads;
    const shoulder = chain[1] as number;
    const reach = armLength(rest, source, chain);
    const outward = hand === "L" ? 1 : -1;
    const pole: Vec3 = [
      (heads[shoulder * 3] as number) + outward * 0.35 * reach,
      (heads[shoulder * 3 + 1] as number) - 0.6 * reach,
      (heads[shoulder * 3 + 2] as number) - 0.25 * reach,
    ];
    if (seed.length !== source.length) {
      seed = new Float32Array(source.length);
      solved = new Float32Array(source.length);
    }
    seedArmTwoBone(rest, source, chain, tip, goal, pole, seed);
    const result = solveArmTarget({
      rest,
      rotations: seed,
      chain,
      tip,
      target: { position: goal, orientation: palmOrientation(rest, seed, chain, goal, hand) },
      iterations,
      tolerance,
      orientationTolerance,
      out: solved,
      effector: (rotations) => {
        const frame = sampler.frame(figure.generation, rotations, sampled);
        return {
          position: [frame.position[0], frame.position[1], frame.position[2]],
          orientation: frameQuat(frame),
        };
      },
    });
    // The weight blends from the frame's own pose, not from the seed.
    out.set(source);
    for (const bone of chain) {
      const at = bone * 4;
      const from: Quat = [
        source[at] as number,
        source[at + 1] as number,
        source[at + 2] as number,
        source[at + 3] as number,
      ];
      const to: Quat = [
        solved[at] as number,
        solved[at + 1] as number,
        solved[at + 2] as number,
        solved[at + 3] as number,
      ];
      out.set(weight >= 1 ? to : slerp(from, to, weight), at);
    }
    const final = sampler.frame(figure.generation, out, sampled);
    transformInto(figure.figureToWorld, final.position, report.hand);
    report.state = state;
    report.weight = weight;
    report.distance = Math.hypot(
      report.hand[0] - report.target[0],
      report.hand[1] - report.target[1],
      report.hand[2] - report.target[2],
    );
    // A partly weighted hand is measured where it is drawn; it has not made contact.
    const reached = weight >= 1 && result.status === "reached" && report.distance <= tolerance;
    report.status = reached ? "reached" : "unreached";
    report.reason = reached
      ? "reached"
      : !result.geometricallyReachable
        ? "geometrically-unreachable"
        : weight < 1
          ? "partial-weight"
          : result.reason === "reached"
            ? "tolerance-not-reached"
            : result.reason;
    report.orientationError = weight >= 1 ? result.orientationError : null;
    report.geometricallyReachable = result.geometricallyReachable;
    return report;
  };

  return {
    report,
    update(input) {
      const { binding, figure, source, out, dt } = input;
      if (out === source) throw new RangeError("hand contact: out must not alias source");
      if (out.length !== source.length)
        throw new RangeError("hand contact: out must match the source pose's length");

      if (!binding) {
        // The binding was taken away: fade from the last target as after a cancel.
        if (following && hasTarget && report.weight > 0) {
          if (report.state !== "fading") {
            fadeFrom = report.weight;
            fadeTime = 0;
          }
          const weight = fade(dt);
          if (weight > 0) return solve(input, weight, "fading");
        }
        forget();
        return leave(input, "idle", null);
      }

      const { interaction, role, contact } = binding;
      if (interaction !== following) {
        forget();
        following = interaction;
      }
      const definition = interaction.definition;
      const spec = contactOf(definition, contact);
      if (!spec) return leave(input, "refused", "unknown-contact");
      side = handContactSide(definition, contact, role);
      report.side = side;
      if (!side) return leave(input, "refused", "not-a-hand-contact");
      if (interaction.roles[role] !== figure.participant)
        return leave(input, "refused", "not-a-participant");
      const uses = definition.roles.find((r) => r.name === role)?.uses ?? [];
      if (!uses.includes(`arm.${side}`) || !uses.includes(`hand.${side}`))
        return leave(input, "refused", "not-claimed");

      if (interaction.phase === "ended") {
        // An abort drops at once; a graceful cancel fades from the last target;
        // a normal end has already released on the phase clock.
        if (interaction.endReason === null || interaction.endReason === "age-policy" || !hasTarget)
          return leave(input, "idle", null);
        if (report.state !== "fading") {
          fadeFrom = report.weight;
          fadeTime = 0;
        }
        const weight = fade(dt);
        return weight > 0 ? solve(input, weight, "fading") : leave(input, "idle", null);
      }

      const target = interaction.contactTarget(contact, role, scratchTarget);
      if (target) {
        report.target[0] = target[0];
        report.target[1] = target[1];
        report.target[2] = target[2];
        hasTarget = true;
        releaseFrom = -1;
        let weight = 1;
        if (!held) {
          const first = PHASE_ORDER.find((phase) => spec.during.includes(phase));
          if (interaction.phase === first && blendIn > 0)
            weight = smooth(interaction.time / blendIn);
          if (weight >= 1) held = true;
        }
        if (weight <= 0) return leave(input, "idle", null);
        return solve(input, weight, weight < 1 ? "blending-in" : "holding");
      }

      if (interaction.phase === "release" && hasTarget) {
        if (releaseFrom < 0) releaseFrom = report.weight;
        const seconds = definition.releaseSeconds ?? DEFAULT_PHASE_SECONDS;
        const weight = seconds > 0 ? releaseFrom * (1 - smooth(interaction.time / seconds)) : 0;
        if (weight > 0) return solve(input, weight, "releasing");
      }
      return leave(input, "idle", null);
    },
  };
}

/** The arm's length, shoulder through wrist, as posed (segment lengths do not change with pose). */
export function armLength(
  rest: RestBones,
  rotations: BoneRotations,
  chain: readonly number[],
): number {
  const heads = posedBones(rest, rotations).heads;
  let total = 0;
  for (let k = 1; k < chain.length; k++) {
    const a = (chain[k - 1] as number) * 3;
    const b = (chain[k] as number) * 3;
    total += Math.hypot(
      (heads[b] as number) - (heads[a] as number),
      (heads[b + 1] as number) - (heads[a + 1] as number),
      (heads[b + 2] as number) - (heads[a + 2] as number),
    );
  }
  return total;
}
