/**
 * A bounded source-rig solve for one skinned finger pad.
 *
 * The caller supplies both the actual rendered pad sampler and the fixed
 * surface it is approaching.  This module owns no presentation pose, capsule,
 * or partner geometry: it changes only declared MakeHuman BVH channels on one
 * existing finger chain and reports the measured result.
 */
import { assertDisjointViews, type BoneRotations, type RestBones } from "./bones.ts";
import { jointChannelRotations, type RigData, type RotationChannel } from "./pose.ts";

export type FingerSide = "L" | "R";

/** A pad frame measured from the skinned surface the renderer draws. */
export interface FingerSurfaceFrame {
  position: [number, number, number];
  normal: [number, number, number];
}

/** A fixed partner or object surface sampled against the current pad frame. */
export interface FingerSurfaceContact {
  /** Nearest permitted point on the caller's fixed surface, in figure coordinates. */
  position: readonly [number, number, number];
  /**
   * Outward normal of the contacted partner surface. The solver reverses it:
   * a pad contacting that surface must face into it.
   */
  surfaceNormal?: readonly [number, number, number];
  /**
   * Explicit desired facing for the pad. Use this only when the target is not
   * an outward surface; it cannot be combined with `surfaceNormal`.
   */
  desiredPadNormal?: readonly [number, number, number];
}

/** One channel of the source BVH finger chain, with an explicit anatomical range. */
export interface FingerChannelLimit {
  /** A source finger joint, for example `finger2-1.R`. */
  joint: string;
  /** A rotation channel present on that joint in the body pack's `tpose` layout. */
  channel: RotationChannel;
  /** The authored source-channel value in degrees, before this solve. */
  sourceDegrees: number;
  /** Inclusive anatomical/action lower bound in source-channel degrees. */
  minDegrees: number;
  /** Inclusive anatomical/action upper bound in source-channel degrees. */
  maxDegrees: number;
}

export type FingerTargetStatus = "reached" | "unreached";
export type FingerTargetReason = "reached" | "limits" | "iteration-budget";

export interface FingerSurfaceTargetInput {
  rest: RestBones;
  /** The rig data that defines the source BVH channel order and axis mapping. */
  rig: RigData;
  /** Authored full-body source pose. It is never mutated. */
  rotations: BoneRotations;
  side: FingerSide;
  digit: 1 | 2 | 3 | 4 | 5;
  /** Every source rotation channel on this digit's three existing joints. */
  channels: readonly FingerChannelLimit[];
  /** Reads the named pad from the actual skinned surface into `out`. */
  sample: (rotations: BoneRotations, out: FingerSurfaceFrame) => FingerSurfaceFrame;
  /** Resolves the caller-owned capsule or partner surface for a sampled pad. */
  target: (pad: Readonly<FingerSurfaceFrame>) => FingerSurfaceContact;
  /** Metres allowed between the measured pad and target surface. */
  tolerance?: number;
  /** Optional minimum dot product between pad and target normals. */
  minimumNormalAlignment?: number;
  /** Metres-equivalent weight applied to an explicitly requested pad-facing error. */
  normalWeight?: number;
  /** Bounded deterministic DLS iterations. */
  iterations?: number;
  /** DLS diagonal damping in square metres per square degree. */
  damping?: number;
  /** Finite-difference probe and maximum accepted channel step, in degrees. */
  probeDegrees?: number;
  maxStepDegrees?: number;
  /** Reused full-pose output. It must not overlap `rotations` or the rest rig. */
  out?: BoneRotations;
}

export interface FingerSurfaceTargetResult {
  readonly rotations: BoneRotations;
  readonly status: FingerTargetStatus;
  readonly reason: FingerTargetReason;
  /** Actual skinned pad frame after the final accepted channel values. */
  readonly pad: FingerSurfaceFrame;
  /** Actual caller-surface point paired with the final pad frame. */
  readonly contact: FingerSurfaceContact;
  /** Euclidean pad-to-surface distance in metres. */
  readonly distance: number;
  /** Dot product of the pad and its requested facing, or null without a facing request. */
  readonly normalAlignment: number | null;
  /** Final source-channel values, by declared channel order. */
  readonly degrees: readonly number[];
  /** Actual CPU skinned-pad samples consumed; this solver performs no GPU work. */
  readonly surfaceSamples: number;
  /** Synchronous CPU wall time for this solve, measured without GPU work. */
  readonly wallMilliseconds: number;
  readonly iterations: number;
}

const LAYOUT = "tpose";
const CHANNELS: readonly RotationChannel[] = ["Xrotation", "Yrotation", "Zrotation"];
type MutableJointChannels = Record<string, Partial<Record<RotationChannel, number>>>;
const frame = (): FingerSurfaceFrame => ({ position: [0, 0, 0], normal: [0, 0, 0] });

const fingerJointNames = (digit: number, side: FingerSide) =>
  [1, 2, 3].map((joint) => `finger${digit}-${joint}.${side}`);

/**
 * Declares every rotation channel the packed source layout exposes for one
 * digit.  The source is a zero-channel pose; callers with an authored clip
 * replace `sourceDegrees` before solving.
 */
export function fingerChannelLimits(
  rig: RigData,
  digit: 1 | 2 | 3 | 4 | 5,
  side: FingerSide,
  minDegrees: number,
  maxDegrees: number,
): FingerChannelLimit[] {
  if (!Number.isFinite(minDegrees) || !Number.isFinite(maxDegrees) || minDegrees > maxDegrees)
    throw new RangeError("finger target: channel bounds must be finite and ordered");
  const layout = layoutOf(rig);
  const wanted = new Set(fingerJointNames(digit, side));
  const out: FingerChannelLimit[] = [];
  for (const joint of layout.joints) {
    if (!wanted.has(joint.name)) continue;
    for (const channel of joint.channels) {
      if (CHANNELS.includes(channel as RotationChannel))
        out.push({
          joint: joint.name,
          channel: channel as RotationChannel,
          sourceDegrees: 0,
          minDegrees,
          maxDegrees,
        });
    }
  }
  if (out.length === 0)
    throw new RangeError("finger target: source layout has no finger rotation channels");
  return out;
}

/**
 * Solves only the requested source finger's declared BVH channels.  Position
 * samples are finite-differenced through the caller's real skinned pad reader;
 * no segment is scaled and no synthetic joint or mesh is made.
 */
export function solveFingerSurfaceTarget(
  input: FingerSurfaceTargetInput,
): FingerSurfaceTargetResult {
  const {
    rest,
    rig,
    rotations,
    side,
    digit,
    channels,
    sample,
    target,
    tolerance = 0.002,
    minimumNormalAlignment,
    normalWeight = 0.02,
    iterations = 20,
    damping = 1e-6,
    probeDegrees = 0.25,
    maxStepDegrees = 8,
  } = input;
  if (rotations.length !== rest.names.length * 4)
    throw new RangeError("finger target: rotations do not match the rest rig");
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new RangeError("finger target: tolerance must be finite and non-negative");
  if (
    minimumNormalAlignment !== undefined &&
    (!Number.isFinite(minimumNormalAlignment) ||
      minimumNormalAlignment < -1 ||
      minimumNormalAlignment > 1)
  )
    throw new RangeError("finger target: minimumNormalAlignment must be from -1 to 1");
  if (!Number.isInteger(iterations) || iterations < 1)
    throw new RangeError("finger target: iterations must be a positive integer");
  if (!(damping > 0) || !Number.isFinite(damping))
    throw new RangeError("finger target: damping must be finite and positive");
  if (!(probeDegrees > 0) || !Number.isFinite(probeDegrees))
    throw new RangeError("finger target: probeDegrees must be finite and positive");
  if (!(maxStepDegrees > 0) || !Number.isFinite(maxStepDegrees))
    throw new RangeError("finger target: maxStepDegrees must be finite and positive");
  if (!(normalWeight > 0) || !Number.isFinite(normalWeight))
    throw new RangeError("finger target: normalWeight must be finite and positive");

  validateChannels(rest, rig, digit, side, channels);
  const out = input.out ?? new Float32Array(rotations.length);
  if (out.length !== rotations.length)
    throw new RangeError("finger target: out must exactly match the rotation buffer");
  assertDisjointViews("finger target", out, [rotations, rest.heads, rest.parents, rest.order]);
  const startedAt = performance.now();

  const degrees = channels.map((limit) => limit.sourceDegrees);
  const values = degrees.slice();
  const accepted = values.slice();
  const current = frame();
  const probed = frame();
  let surfaceSamples = 0;
  const measured = (pose: BoneRotations, destination: FingerSurfaceFrame) => {
    surfaceSamples++;
    return sample(pose, destination);
  };
  let state = evaluate(out, rotations, rig, channels, values, measured, target, current);
  const residualDimensions = state.desiredPadNormal ? 6 : 3;
  const stateResidual = new Float64Array(residualDimensions);
  const probedResidual = new Float64Array(residualDimensions);
  const jacobian = new Float64Array(channels.length * residualDimensions);
  const normalMatrix = new Float64Array(channels.length * channels.length);
  const normalRight = new Float64Array(channels.length);
  let used = 0;
  let stoppedAtLimits = allPinned(values, channels);

  for (; used < iterations && !satisfies(state, tolerance, minimumNormalAlignment); used++) {
    writeResidual(state, normalWeight, stateResidual);
    jacobian.fill(0);
    let movable = false;
    for (let i = 0; i < channels.length; i++) {
      const limit = channels[i] as FingerChannelLimit;
      const here = values[i] as number;
      const plus = Math.min(limit.maxDegrees, here + probeDegrees);
      const minus = Math.max(limit.minDegrees, here - probeDegrees);
      const next = plus !== here ? plus : minus;
      if (next === here) continue;
      movable = true;
      values[i] = next;
      const after = evaluate(out, rotations, rig, channels, values, measured, target, probed);
      const divisor = next - here;
      writeResidual(after, normalWeight, probedResidual);
      for (let row = 0; row < residualDimensions; row++)
        jacobian[i * residualDimensions + row] =
          ((probedResidual[row] as number) - (stateResidual[row] as number)) / divisor;
      values[i] = here;
    }
    if (!movable) {
      stoppedAtLimits = true;
      break;
    }
    const step = dlsStep(
      jacobian,
      channels.length,
      stateResidual,
      damping,
      normalMatrix,
      normalRight,
    );
    let changed = false;
    for (let i = 0; i < channels.length; i++) {
      const limit = channels[i] as FingerChannelLimit;
      const delta = Math.max(-maxStepDegrees, Math.min(maxStepDegrees, step[i] as number));
      const next = Math.max(
        limit.minDegrees,
        Math.min(limit.maxDegrees, (values[i] as number) + delta),
      );
      changed ||= next !== values[i];
      values[i] = next;
    }
    const proposed = changed
      ? evaluate(out, rotations, rig, channels, values, measured, target, current)
      : state;
    if (objective(proposed, normalWeight) + 1e-12 < objective(state, normalWeight)) {
      state = proposed;
      accepted.splice(0, accepted.length, ...values);
    } else {
      values.splice(0, values.length, ...accepted);
      // A finger pad's skinned response is not linear over a broad curl. Keep
      // DLS as the primary step, then make one deterministic bounded coordinate
      // sweep so a valid one-channel source motion is not discarded merely
      // because the local finite-difference approximation crossed a curled segment.
      let best = state;
      const bestValues = accepted.slice();
      for (let i = 0; i < channels.length; i++) {
        const limit = channels[i] as FingerChannelLimit;
        for (const signed of [-1, 1]) {
          values.splice(0, values.length, ...accepted);
          const next = Math.max(
            limit.minDegrees,
            Math.min(limit.maxDegrees, (accepted[i] as number) + signed * maxStepDegrees),
          );
          if (next === accepted[i]) continue;
          values[i] = next;
          const candidate = evaluate(
            out,
            rotations,
            rig,
            channels,
            values,
            measured,
            target,
            probed,
          );
          if (objective(candidate, normalWeight) + 1e-12 < objective(best, normalWeight)) {
            best = candidate;
            bestValues.splice(0, bestValues.length, ...values);
          }
        }
      }
      if (best === state) break;
      state = best;
      accepted.splice(0, accepted.length, ...bestValues);
    }
  }

  // The loop keeps its accepted pose in `state`; build it once more from the
  // retained values when it terminated normally.  A rejected first step remains
  // honestly unreached at the source pose.
  values.splice(0, values.length, ...accepted);
  state = evaluate(out, rotations, rig, channels, values, measured, target, current);
  stoppedAtLimits ||= allPinned(values, channels);
  const status: FingerTargetStatus = satisfies(state, tolerance, minimumNormalAlignment)
    ? "reached"
    : "unreached";
  return {
    rotations: out,
    status,
    reason: status === "reached" ? "reached" : stoppedAtLimits ? "limits" : "iteration-budget",
    pad: copyFrame(state.pad),
    contact: copyContact(state.contact),
    distance: state.distance,
    normalAlignment: state.normalAlignment,
    degrees: values,
    surfaceSamples,
    wallMilliseconds: performance.now() - startedAt,
    iterations: used,
  };
}

interface EvaluationState {
  readonly pad: FingerSurfaceFrame;
  readonly contact: FingerSurfaceContact;
  readonly distance: number;
  readonly normalAlignment: number | null;
  readonly desiredPadNormal: readonly [number, number, number] | null;
}

function evaluate(
  out: BoneRotations,
  source: BoneRotations,
  rig: RigData,
  limits: readonly FingerChannelLimit[],
  degrees: readonly number[],
  sample: FingerSurfaceTargetInput["sample"],
  target: FingerSurfaceTargetInput["target"],
  pad: FingerSurfaceFrame,
): EvaluationState {
  out.set(source);
  let k = 0;
  const values: MutableJointChannels = {};
  for (const limit of limits) {
    let joint = values[limit.joint];
    if (!joint) {
      joint = {};
      values[limit.joint] = joint;
    }
    joint[limit.channel] = degrees[k++] as number;
  }
  jointChannelRotations(rig, values, out);
  const measured = sample(out, pad);
  assertFrame("finger target: sample", measured);
  const contact = target(measured);
  assertContact(contact);
  const desiredPadNormal = desiredNormal(contact);
  const distance = Math.hypot(
    contact.position[0] - measured.position[0],
    contact.position[1] - measured.position[1],
    contact.position[2] - measured.position[2],
  );
  return {
    pad: copyFrame(measured),
    contact: copyContact(contact),
    distance,
    normalAlignment: desiredPadNormal ? dotUnit(measured.normal, desiredPadNormal) : null,
    desiredPadNormal,
  };
}

function validateChannels(
  rest: RestBones,
  rig: RigData,
  digit: number,
  side: FingerSide,
  channels: readonly FingerChannelLimit[],
): void {
  const layout = layoutOf(rig);
  const wanted = fingerJointNames(digit, side);
  const expected = new Map<string, Set<RotationChannel>>();
  for (const name of wanted) {
    if (rest.names.indexOf(name) < 0 || rig.bones.indexOf(name) < 0)
      throw new RangeError(`finger target: rig lacks ${name}`);
    const joint = layout.joints.find((entry) => entry.name === name);
    if (!joint) throw new RangeError(`finger target: source layout lacks ${name}`);
    expected.set(
      name,
      new Set(
        joint.channels.filter((channel): channel is RotationChannel =>
          CHANNELS.includes(channel as RotationChannel),
        ),
      ),
    );
  }
  const out: MutableJointChannels = {};
  for (const limit of channels) {
    const expectedChannels = expected.get(limit.joint);
    if (!expectedChannels?.has(limit.channel))
      throw new RangeError(
        `finger target: ${limit.joint}.${limit.channel} is not a source finger channel`,
      );
    if (
      !Number.isFinite(limit.sourceDegrees) ||
      !Number.isFinite(limit.minDegrees) ||
      !Number.isFinite(limit.maxDegrees) ||
      limit.minDegrees > limit.maxDegrees ||
      limit.sourceDegrees < limit.minDegrees ||
      limit.sourceDegrees > limit.maxDegrees
    )
      throw new RangeError(
        "finger target: source channel values must be finite and inside their bounds",
      );
    let joint = out[limit.joint];
    if (!joint) {
      joint = {};
      out[limit.joint] = joint;
    }
    if (joint[limit.channel] !== undefined)
      throw new RangeError(
        `finger target: duplicate source channel ${limit.joint}.${limit.channel}`,
      );
    joint[limit.channel] = limit.sourceDegrees;
  }
  for (const [joint, expectedChannels] of expected) {
    const found = out[joint];
    if (!found || [...expectedChannels].some((channel) => found[channel] === undefined))
      throw new RangeError(
        "finger target: declare every source rotation channel for the solved finger",
      );
  }
}

const layoutOf = (rig: RigData) => {
  const layout = rig.poses.find((pose) => pose.name === LAYOUT);
  if (!layout) throw new RangeError(`finger target: pack has no ${LAYOUT} source layout`);
  return layout;
};

function dlsStep(
  jacobian: Float64Array,
  channels: number,
  residual: Float64Array,
  damping: number,
  matrix: Float64Array,
  right: Float64Array,
): Float64Array {
  const dimensions = residual.length;
  matrix.fill(0);
  right.fill(0);
  for (let i = 0; i < channels; i++) {
    for (let row = 0; row < dimensions; row++)
      right[i] =
        (right[i] as number) +
        (jacobian[i * dimensions + row] as number) * -(residual[row] as number);
    for (let j = 0; j < channels; j++) {
      let value = 0;
      for (let row = 0; row < dimensions; row++)
        value +=
          (jacobian[i * dimensions + row] as number) * (jacobian[j * dimensions + row] as number);
      matrix[i * channels + j] = value;
    }
    matrix[i * channels + i] = (matrix[i * channels + i] as number) + damping;
  }
  return solveLinearSystem(matrix, right, channels) ?? right.fill(0);
}

function solveLinearSystem(
  matrix: Float64Array,
  right: Float64Array,
  size: number,
): Float64Array | null {
  for (let pivot = 0; pivot < size; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row++)
      if (
        Math.abs(matrix[row * size + pivot] as number) >
        Math.abs(matrix[best * size + pivot] as number)
      )
        best = row;
    const pivotValue = matrix[best * size + pivot] as number;
    if (Math.abs(pivotValue) < 1e-16) return null;
    if (best !== pivot) {
      for (let column = pivot; column < size; column++) {
        const index = pivot * size + column;
        const other = best * size + column;
        const temporary = matrix[index] as number;
        matrix[index] = matrix[other] as number;
        matrix[other] = temporary;
      }
      const temporary = right[pivot] as number;
      right[pivot] = right[best] as number;
      right[best] = temporary;
    }
    for (let row = pivot + 1; row < size; row++) {
      const factor = (matrix[row * size + pivot] as number) / pivotValue;
      if (factor === 0) continue;
      for (let column = pivot; column < size; column++)
        matrix[row * size + column] =
          (matrix[row * size + column] as number) -
          factor * (matrix[pivot * size + column] as number);
      right[row] = (right[row] as number) - factor * (right[pivot] as number);
    }
  }
  for (let row = size - 1; row >= 0; row--) {
    let total = right[row] as number;
    for (let column = row + 1; column < size; column++)
      total -= (matrix[row * size + column] as number) * (right[column] as number);
    right[row] = total / (matrix[row * size + row] as number);
  }
  return right;
}

const allPinned = (values: readonly number[], channels: readonly FingerChannelLimit[]) =>
  values.every(
    (value, i) =>
      value === (channels[i] as FingerChannelLimit).minDegrees ||
      value === (channels[i] as FingerChannelLimit).maxDegrees,
  );

const satisfies = (state: EvaluationState, tolerance: number, normal: number | undefined) =>
  state.distance <= tolerance && (normal === undefined || (state.normalAlignment ?? -1) >= normal);

function writeResidual(state: EvaluationState, normalWeight: number, out: Float64Array): void {
  out[0] = state.contact.position[0] - state.pad.position[0];
  out[1] = state.contact.position[1] - state.pad.position[1];
  out[2] = state.contact.position[2] - state.pad.position[2];
  if (out.length === 3) {
    if (state.desiredPadNormal)
      throw new RangeError("finger target: target facing changed during solve");
    return;
  }
  if (!state.desiredPadNormal)
    throw new RangeError("finger target: target facing changed during solve");
  out[3] = normalWeight * (state.desiredPadNormal[0] - state.pad.normal[0]);
  out[4] = normalWeight * (state.desiredPadNormal[1] - state.pad.normal[1]);
  out[5] = normalWeight * (state.desiredPadNormal[2] - state.pad.normal[2]);
}

function objective(state: EvaluationState, normalWeight: number): number {
  const error = state.distance ** 2;
  if (!state.desiredPadNormal) return error;
  const x = normalWeight * (state.desiredPadNormal[0] - state.pad.normal[0]);
  const y = normalWeight * (state.desiredPadNormal[1] - state.pad.normal[1]);
  const z = normalWeight * (state.desiredPadNormal[2] - state.pad.normal[2]);
  return error + x * x + y * y + z * z;
}

function assertFrame(name: string, value: FingerSurfaceFrame): void {
  if (![...value.position, ...value.normal].every(Number.isFinite))
    throw new RangeError(`${name} returned a non-finite frame`);
}

function assertContact(value: FingerSurfaceContact): void {
  if (
    ![...value.position, ...(value.surfaceNormal ?? []), ...(value.desiredPadNormal ?? [])].every(
      Number.isFinite,
    )
  )
    throw new RangeError("finger target: target returned a non-finite contact");
  if (value.surfaceNormal && value.desiredPadNormal)
    throw new RangeError(
      "finger target: target cannot provide both surfaceNormal and desiredPadNormal",
    );
  if (
    (value.surfaceNormal && Math.hypot(...value.surfaceNormal) === 0) ||
    (value.desiredPadNormal && Math.hypot(...value.desiredPadNormal) === 0)
  )
    throw new RangeError("finger target: target returned a zero-length facing normal");
}

function desiredNormal(contact: FingerSurfaceContact): readonly [number, number, number] | null {
  if (contact.desiredPadNormal) return [...contact.desiredPadNormal] as [number, number, number];
  if (contact.surfaceNormal)
    return [-contact.surfaceNormal[0], -contact.surfaceNormal[1], -contact.surfaceNormal[2]];
  return null;
}

const dotUnit = (a: readonly number[], b: readonly number[]) => {
  const length =
    Math.hypot(a[0] as number, a[1] as number, a[2] as number) *
    Math.hypot(b[0] as number, b[1] as number, b[2] as number);
  return length > 0
    ? ((a[0] as number) * (b[0] as number) +
        (a[1] as number) * (b[1] as number) +
        (a[2] as number) * (b[2] as number)) /
        length
    : -1;
};

const copyFrame = (value: FingerSurfaceFrame): FingerSurfaceFrame => ({
  position: [...value.position] as [number, number, number],
  normal: [...value.normal] as [number, number, number],
});

const copyContact = (value: FingerSurfaceContact): FingerSurfaceContact => ({
  position: [...value.position] as [number, number, number],
  ...(value.surfaceNormal && {
    surfaceNormal: [...value.surfaceNormal] as [number, number, number],
  }),
  ...(value.desiredPadNormal && {
    desiredPadNormal: [...value.desiredPadNormal] as [number, number, number],
  }),
});
