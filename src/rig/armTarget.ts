/**
 * A framework-free target constraint for an already-authored arm pose.
 *
 * Every point in this module is in the figure's coordinates: +Y is up, +Z is
 * forward and +X is left. `BoneRotations` remain local to each bone's parent,
 * exactly as `posedBones` and the renderer use them.  The solver rotates an
 * existing pose; it never translates joints or scales segments.  A caller is
 * responsible for choosing an interaction target and for applying the returned
 * rotations to a renderer.
 */
import { assertDisjointViews, type BoneRotations, posedBones, type RestBones } from "./bones.ts";
import { between, conjugate, mul, type Quat, rotate } from "./quat.ts";

/** Whether the measured final effector satisfies every requested tolerance. */
export type ArmTargetStatus = "reached" | "unreached";

/**
 * Why a solve did not reach its target. `tolerance-not-reached` deliberately
 * does not claim whether the iteration budget or a source-angle budget caused
 * the miss: this primitive does not yet model anatomical joint limits.
 */
export type ArmTargetReason =
  | "reached"
  | "geometrically-unreachable"
  | "orientation-unavailable"
  | "partial-weight"
  | "tolerance-not-reached";

export interface ArmTargetFrame {
  /** The desired final contact point in figure coordinates. */
  position: readonly [number, number, number];
  /** Optional desired final effector orientation in figure coordinates. */
  orientation?: Quat;
}

/** The end effector's fixed transform in the final chain bone's local coordinates. */
export interface ArmTip {
  position: readonly [number, number, number];
  /** The effector orientation relative to the final chain bone, when constrained. */
  orientation?: Quat;
}

/** A point in figure coordinates that selects the elbow's stable bend side. */
export type ArmPole = readonly [number, number, number];

/**
 * A spherical local angular allowance from the authored source pose. This is a
 * convergence budget, not an anatomical shoulder, elbow, twist, or wrist
 * constraint. A product can tighten it per action; it cannot ask this
 * primitive to stretch a limb.
 */
export interface ArmJointLimit {
  /** Maximum angular change from the source local rotation, in radians. */
  maxRadians: number;
}

export interface ArmTargetInput {
  rest: RestBones;
  /** The sampled authored pose, normally a clip plus any face/body layers. */
  rotations: BoneRotations;
  /** Connected shoulder-to-wrist bone indices; the final bone owns `tip`. */
  chain: readonly number[];
  tip: ArmTip;
  /**
   * Optional final-effector sampler. Use this for a skinned landmark such as
   * `hand.R`: it makes the solver close on the rendered frame rather than a
   * guessed wrist point. It receives the current local rotations and returns
   * its frame in the same figure coordinates as `target`.
   */
  effector?: (rotations: BoneRotations) => ArmTargetFrame;
  target: ArmTargetFrame;
  /** Optional elbow-side selector in the same figure coordinate frame as `target`. */
  pole?: ArmPole;
  /** One limit per chain bone, or defaults appropriate to MakeHuman's split arm chain. */
  limits?: readonly ArmJointLimit[];
  /** 0 preserves the sampled pose; 1 applies the full solve. */
  weight?: number;
  /** Iteration budget for the deterministic CCD solve. */
  iterations?: number;
  /** Metres allowed between the final effector and target. */
  tolerance?: number;
  /** Radians allowed between final effector and target orientations. */
  orientationTolerance?: number;
  /** Reused rotation buffer. It must not alias `rotations`. */
  out?: BoneRotations;
}

export interface ArmTargetResult {
  readonly rotations: BoneRotations;
  readonly status: ArmTargetStatus;
  /** The measured outcome; never infer anatomical legality from this reason. */
  readonly reason: ArmTargetReason;
  /** True only when the target lies inside the unchanged segment-length annulus. */
  readonly geometricallyReachable: boolean;
  /** Final Euclidean target error in metres. */
  readonly distance: number;
  /** Final orientation error in radians, or null when orientation was not requested. */
  readonly orientationError: number | null;
  /** Segment lengths from shoulder through wrist and fixed tip, never rescaled. */
  readonly segmentLengths: readonly number[];
}

interface SampledArmEnd extends ArmTargetFrame {
  /** True when `orientation` came from the measured effector rather than `tip`. */
  readonly measuredOrientation: boolean;
}

/**
 * Temporary source-angle budgets for the split MakeHuman chain. They are not
 * biomechanical limits: a CCD step may still use a twist carrier as a bend.
 */
const DEFAULT_SOURCE_ANGLE_BUDGETS: readonly ArmJointLimit[] = [
  { maxRadians: (130 * Math.PI) / 180 }, // shoulder01
  { maxRadians: (35 * Math.PI) / 180 }, // upperarm01 split
  { maxRadians: (35 * Math.PI) / 180 }, // upperarm02 split
  { maxRadians: (150 * Math.PI) / 180 }, // elbow / lowerarm01
  { maxRadians: (50 * Math.PI) / 180 }, // lowerarm02 split
  { maxRadians: (85 * Math.PI) / 180 }, // wrist
];

const ARM_NAMES = (side: "L" | "R") => [
  `shoulder01.${side}`,
  `upperarm01.${side}`,
  `upperarm02.${side}`,
  `lowerarm01.${side}`,
  `lowerarm02.${side}`,
  `wrist.${side}`,
];

/** The split MakeHuman arm chain, preserving every evaluated segment and twist carrier. */
export function armChain(rest: Pick<RestBones, "names" | "parents">, side: "L" | "R"): number[] {
  const out = ARM_NAMES(side).map((name) => {
    const index = rest.names.indexOf(name);
    if (index < 0) throw new Error(`arm target: rig has no ${name}`);
    return index;
  });
  for (let i = 1; i < out.length; i++)
    if (rest.parents[out[i] as number] !== out[i - 1])
      throw new Error(`arm target: ${rest.names[out[i] as number]} is not the next arm bone`);
  return out;
}

/**
 * Captures an actual rendered/contact point as a rigid offset of the wrist.
 * Supply a final `hand.R` affordance frame here, not a guessed wrist position.
 */
export function armTip(
  rest: RestBones,
  rotations: BoneRotations,
  chain: readonly number[],
  position: readonly [number, number, number],
  orientation?: Quat,
): ArmTip {
  assertChain(rest, chain, rotations);
  assertPoint("armTip position", position);
  if (orientation) assertUnitQuaternion("armTip orientation", orientation);
  const final = chain.at(-1) as number;
  const posed = posedBones(rest, rotations);
  const origin = pointAt(posed.heads, final);
  const world = quatAt(posed.world, final);
  const local = rotate(
    conjugate(world),
    position[0] - origin[0],
    position[1] - origin[1],
    position[2] - origin[2],
  );
  return {
    position: local,
    ...(orientation && { orientation: mul(conjugate(world), orientation) }),
  };
}

/**
 * Solves the arm to the requested target without changing any rest-joint
 * positions or segment lengths. An unreached target returns the closest pose
 * found within source-angle budgets; it never scales the arm. Those budgets do
 * not establish anatomical legality.
 */
export function solveArmTarget(input: ArmTargetInput): ArmTargetResult {
  const {
    rest,
    rotations,
    chain,
    tip,
    target,
    pole,
    weight = 1,
    iterations = 24,
    tolerance = 0.002,
    orientationTolerance = 0.035,
  } = input;
  assertChain(rest, chain, rotations);
  assertPoint("tip.position", tip.position);
  assertPoint("target.position", target.position);
  if (pole) assertPoint("pole", pole);
  if (tip.orientation) assertUnitQuaternion("tip.orientation", tip.orientation);
  if (target.orientation) assertUnitQuaternion("target.orientation", target.orientation);
  if (target.orientation && !tip.orientation && !input.effector)
    throw new RangeError("arm target: orientation needs a tip orientation or an effector sampler");
  if (!(weight >= 0 && weight <= 1)) throw new RangeError("arm target: weight must be from 0 to 1");
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new RangeError("arm target: iterations must be a positive integer");
  if (!(tolerance >= 0 && Number.isFinite(tolerance)))
    throw new RangeError("arm target: tolerance must be finite and non-negative");
  if (!(orientationTolerance >= 0 && Number.isFinite(orientationTolerance)))
    throw new RangeError("arm target: orientationTolerance must be finite and non-negative");
  const limits = input.limits ?? defaultLimits(chain.length);
  if (limits.length !== chain.length)
    throw new RangeError("arm target: limits must have one entry for every chain bone");
  limits.forEach((limit) => {
    if (!(limit.maxRadians >= 0 && Number.isFinite(limit.maxRadians)))
      throw new RangeError("arm target: every joint limit must be finite and non-negative");
  });

  const out = input.out ?? new Float32Array(rotations.length);
  if (out.length !== rotations.length)
    throw new RangeError("arm target: out must exactly match the rotation buffer length");
  assertDisjointViews("arm target", out, [rotations, rest.heads, rest.parents, rest.order]);
  out.set(rotations);
  const source = Float32Array.from(rotations);
  const lengths = segmentLengths(rest, source, chain, tip);
  const root = chain[0] as number;
  const sourcePose = posedBones(rest, source);
  const rootAt = pointAt(sourcePose.heads, root);
  const targetDistance = distance(rootAt, target.position);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const longest = Math.max(...lengths);
  const minimum = Math.max(0, 2 * longest - total);
  const geometricallyReachable =
    targetDistance <= total + tolerance && targetDistance >= minimum - tolerance;

  // Cyclic coordinate descent is deterministic because it starts from the authored
  // pose and always visits wrist-to-shoulder. That preserves authored twist unless
  // a target orientation explicitly asks the wrist to turn.
  refinePosition(
    rest,
    source,
    out,
    chain,
    tip,
    target.position,
    input.effector,
    limits,
    iterations,
    0,
  );

  // A pole is a secondary elbow-plane constraint. Apply it only after positional
  // convergence: applying it in every CCD pass fights the contact target. The
  // remaining joints then restore contact without rotating the shoulder plane away.
  if (pole) {
    biasPole(rest, source, out, chain, target.position, pole, limits[0] as ArmJointLimit);
    refinePosition(
      rest,
      source,
      out,
      chain,
      tip,
      target.position,
      input.effector,
      limits,
      Math.ceil(iterations / 3),
      1,
    );
  }

  if (target.orientation) {
    // A sampler may measure a final frame without exposing a separately-authored
    // tip orientation. In that case correct the measured frame's world delta.
    // Reapply after each ancestor pass because moving an ancestor changes the
    // wrist's world frame after its local correction was calculated.
    const orientationPasses = Math.ceil(iterations / 3);
    for (let pass = 0; pass < orientationPasses; pass++) {
      correctOrientation(rest, source, out, chain, tip, target.orientation, input.effector, limits);
      refinePosition(
        rest,
        source,
        out,
        chain,
        tip,
        target.position,
        input.effector,
        limits,
        1,
        0,
        chain.length - 2,
      );
    }
    correctOrientation(rest, source, out, chain, tip, target.orientation, input.effector, limits);
  }

  if (weight < 1) blendArmInto(source, out, chain, weight);
  const finalPose = posedBones(rest, out);
  const finalEffector = sampledEnd(finalPose, out, chain, tip, input.effector);
  const end = finalEffector.position;
  const finalDistance = distance(end, target.position);
  const finalOrientation = target.orientation
    ? (finalEffector.orientation ??
      (tip.orientation
        ? mul(quatAt(finalPose.world, chain.at(-1) as number), tip.orientation)
        : null))
    : null;
  const orientationError =
    finalOrientation && target.orientation
      ? quaternionAngle(finalOrientation, target.orientation)
      : null;
  // A skinned sample may have a blended palm offset that is not represented by
  // the rigid wrist-local tip used for the annulus diagnostic. Its measured
  // tolerance therefore decides status; the annulus remains useful metadata.
  const reached =
    (input.effector !== undefined || geometricallyReachable) &&
    finalDistance <= tolerance &&
    (!target.orientation ||
      (orientationError !== null && orientationError <= orientationTolerance));
  const status: ArmTargetStatus = reached ? "reached" : "unreached";
  const reason: ArmTargetReason = reached
    ? "reached"
    : !geometricallyReachable
      ? "geometrically-unreachable"
      : target.orientation && orientationError === null
        ? "orientation-unavailable"
        : weight < 1
          ? "partial-weight"
          : "tolerance-not-reached";
  return {
    rotations: out,
    status,
    reason,
    geometricallyReachable,
    distance: finalDistance,
    orientationError,
    segmentLengths: lengths,
  };
}

const IDENTITY: Quat = [0, 0, 0, 1];

function defaultLimits(count: number): readonly ArmJointLimit[] {
  if (count !== DEFAULT_SOURCE_ANGLE_BUDGETS.length)
    return Array.from({ length: count }, () => ({ maxRadians: Math.PI }));
  return DEFAULT_SOURCE_ANGLE_BUDGETS;
}

function assertPoint(name: string, value: readonly number[]): void {
  if (value.length !== 3 || value.some((component) => !Number.isFinite(component)))
    throw new RangeError(`arm target: ${name} must have three finite components`);
}

function assertUnitQuaternion(name: string, value: Quat): void {
  if (value.some((component) => !Number.isFinite(component)))
    throw new RangeError(`arm target: ${name} must have finite components`);
  const magnitude = Math.hypot(value[0], value[1], value[2], value[3]);
  if (Math.abs(magnitude - 1) > 0.001)
    throw new RangeError(`arm target: ${name} must be a unit quaternion`);
}

function assertChain(rest: RestBones, chain: readonly number[], rotations: BoneRotations): void {
  if (chain.length < 2) throw new RangeError("arm target: chain needs at least two bones");
  if (rotations.length !== rest.names.length * 4)
    throw new RangeError("arm target: rotations do not match the rest skeleton");
  chain.forEach((bone, i) => {
    if (!Number.isInteger(bone) || bone < 0 || bone >= rest.names.length)
      throw new RangeError("arm target: chain contains an invalid bone index");
    if (i > 0 && rest.parents[bone] !== chain[i - 1])
      throw new RangeError("arm target: chain must be parent-to-child");
  });
}

function pointAt(values: Float32Array, bone: number): [number, number, number] {
  return [
    values[bone * 3] as number,
    values[bone * 3 + 1] as number,
    values[bone * 3 + 2] as number,
  ];
}

function quatAt(values: Float32Array, bone: number): Quat {
  return [
    values[bone * 4] as number,
    values[bone * 4 + 1] as number,
    values[bone * 4 + 2] as number,
    values[bone * 4 + 3] as number,
  ];
}

function subtract(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  ];
}

function length(v: readonly number[]): number {
  return Math.hypot(v[0] as number, v[1] as number, v[2] as number);
}

function distance(a: readonly number[], b: readonly number[]): number {
  return length(subtract(a, b));
}

function endPoint(
  posed: ReturnType<typeof posedBones>,
  chain: readonly number[],
  tip: ArmTip,
): [number, number, number] {
  const final = chain.at(-1) as number;
  const origin = pointAt(posed.heads, final);
  const offset = rotate(
    quatAt(posed.world, final),
    tip.position[0],
    tip.position[1],
    tip.position[2],
  );
  return [origin[0] + offset[0], origin[1] + offset[1], origin[2] + offset[2]];
}

function segmentLengths(
  rest: RestBones,
  rotations: BoneRotations,
  chain: readonly number[],
  tip: ArmTip,
): number[] {
  const posed = posedBones(rest, rotations);
  const points = chain.map((bone) => pointAt(posed.heads, bone));
  points.push(endPoint(posed, chain, tip));
  return points.slice(1).map((point, i) => distance(point, points[i] as [number, number, number]));
}

function sampledEnd(
  posed: ReturnType<typeof posedBones>,
  rotations: BoneRotations,
  chain: readonly number[],
  tip: ArmTip,
  effector: ArmTargetInput["effector"],
): SampledArmEnd {
  const final = chain.at(-1) as number;
  if (effector) {
    const frame = effector(rotations);
    assertPoint("effector.position", frame.position);
    if (frame.orientation) assertUnitQuaternion("effector.orientation", frame.orientation);
    if (frame.orientation) return { ...frame, measuredOrientation: true };
    if (tip.orientation)
      return {
        position: frame.position,
        orientation: mul(quatAt(posed.world, final), tip.orientation),
        measuredOrientation: false,
      };
    return { position: frame.position, measuredOrientation: false };
  }
  const position = endPoint(posed, chain, tip);
  if (!tip.orientation) return { position, measuredOrientation: false };
  return {
    position,
    orientation: mul(quatAt(posed.world, final), tip.orientation),
    measuredOrientation: false,
  };
}

function refinePosition(
  rest: RestBones,
  source: BoneRotations,
  out: BoneRotations,
  chain: readonly number[],
  tip: ArmTip,
  target: readonly [number, number, number],
  effector: ArmTargetInput["effector"],
  limits: readonly ArmJointLimit[],
  passes: number,
  firstJoint: number,
  lastJoint = chain.length - 1,
): void {
  for (let pass = 0; pass < passes; pass++)
    for (let offset = lastJoint; offset >= firstJoint; offset--) {
      const joint = chain[offset] as number;
      const posed = posedBones(rest, out);
      const from = pointAt(posed.heads, joint);
      const end = sampledEnd(posed, out, chain, tip, effector).position;
      const toEnd = subtract(end, from);
      const toTarget = subtract(target, from);
      if (length(toEnd) < 1e-9 || length(toTarget) < 1e-9) continue;
      applyWorldDelta(
        rest,
        source,
        out,
        joint,
        between(toEnd, toTarget),
        limits[offset] as ArmJointLimit,
      );
    }
}

/** Correct the final local bone from either its fixed tip or a measured frame. */
function correctOrientation(
  rest: RestBones,
  source: BoneRotations,
  out: BoneRotations,
  chain: readonly number[],
  tip: ArmTip,
  target: Quat,
  effector: ArmTargetInput["effector"],
  limits: readonly ArmJointLimit[],
): void {
  const final = chain.at(-1) as number;
  const posed = posedBones(rest, out);
  const frame = sampledEnd(posed, out, chain, tip, effector);
  if (!frame.orientation) return;
  const parent = rest.parents[final] as number;
  const parentWorld = parent < 0 ? IDENTITY : quatAt(posed.world, parent);
  const finalWorld = quatAt(posed.world, final);
  const desiredWorld = frame.measuredOrientation
    ? mul(mul(target, conjugate(frame.orientation)), finalWorld)
    : mul(target, conjugate(tip.orientation as Quat));
  const desiredLocal = mul(conjugate(parentWorld), desiredWorld);
  setLimitedLocal(source, out, final, desiredLocal, limits.at(-1) as ArmJointLimit);
}

function applyWorldDelta(
  rest: RestBones,
  source: BoneRotations,
  out: BoneRotations,
  bone: number,
  deltaWorld: Quat,
  limit: ArmJointLimit,
): void {
  const posed = posedBones(rest, out);
  const parent = rest.parents[bone] as number;
  const parentWorld = parent < 0 ? IDENTITY : quatAt(posed.world, parent);
  const localDelta = mul(conjugate(parentWorld), mul(deltaWorld, parentWorld));
  const current = quatAt(out, bone);
  setLimitedLocal(source, out, bone, mul(localDelta, current), limit);
}

function setLimitedLocal(
  source: BoneRotations,
  out: BoneRotations,
  bone: number,
  candidate: Quat,
  limit: ArmJointLimit,
): void {
  // `posedBones` and `rotate` assume unit rotations, and the slerp clamp below
  // amplifies any norm error, so a drifted candidate would scale every child
  // offset and the solver would steer a stretched rigid arm, not the skinned one.
  const base = normalizeQuat(quatAt(source, bone));
  const unit = normalizeQuat(candidate);
  const delta = mul(unit, conjugate(base));
  const angle = quaternionAngle(delta, IDENTITY);
  const allowed = angle <= limit.maxRadians ? unit : slerp(base, unit, limit.maxRadians / angle);
  out.set(normalizeQuat(allowed), bone * 4);
}

function quaternionAngle(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
}

function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const end: Quat = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  dot = Math.abs(dot);
  if (dot > 0.9995) {
    const q: Quat = [
      a[0] + (end[0] - a[0]) * t,
      a[1] + (end[1] - a[1]) * t,
      a[2] + (end[2] - a[2]) * t,
      a[3] + (end[3] - a[3]) * t,
    ];
    return normalizeQuat(q);
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  const sin = Math.sin(theta);
  return [
    (Math.sin((1 - t) * theta) * a[0] + Math.sin(t * theta) * end[0]) / sin,
    (Math.sin((1 - t) * theta) * a[1] + Math.sin(t * theta) * end[1]) / sin,
    (Math.sin((1 - t) * theta) * a[2] + Math.sin(t * theta) * end[2]) / sin,
    (Math.sin((1 - t) * theta) * a[3] + Math.sin(t * theta) * end[3]) / sin,
  ];
}

function normalizeQuat(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

function blendArmInto(
  source: BoneRotations,
  out: BoneRotations,
  chain: readonly number[],
  weight: number,
): void {
  for (const bone of chain)
    out.set(slerp(quatAt(source, bone), quatAt(out, bone), weight), bone * 4);
}

/** Rotate the whole arm about shoulder→target toward the declared pole, then CCD refines it. */
function biasPole(
  rest: RestBones,
  source: BoneRotations,
  out: BoneRotations,
  chain: readonly number[],
  target: readonly [number, number, number],
  pole: ArmPole,
  limit: ArmJointLimit,
): void {
  const posed = posedBones(rest, out);
  const root = pointAt(posed.heads, chain[0] as number);
  const elbow = pointAt(posed.heads, chain[Math.max(1, Math.floor(chain.length / 2))] as number);
  const axis = subtract(target, root);
  const axisLength = length(axis);
  if (axisLength < 1e-8) return;
  const project = (point: readonly number[]) => {
    const v = subtract(point, root);
    const along = (v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2]) / (axisLength * axisLength);
    return [v[0] - axis[0] * along, v[1] - axis[1] * along, v[2] - axis[2] * along] as [
      number,
      number,
      number,
    ];
  };
  const current = project(elbow);
  const wanted = project(pole);
  if (length(current) < 1e-8 || length(wanted) < 1e-8) return;
  const currentLength = length(current);
  const wantedLength = length(wanted);
  const alignment =
    (current[0] * wanted[0] + current[1] * wanted[1] + current[2] * wanted[2]) /
    (currentLength * wantedLength);
  const delta =
    alignment < -0.999999
      ? ([axis[0] / axisLength, axis[1] / axisLength, axis[2] / axisLength, 0] as Quat)
      : between(current, wanted);
  applyWorldDelta(rest, source, out, chain[0] as number, delta, limit);
}
