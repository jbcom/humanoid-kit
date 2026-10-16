/** Internal transactional recovery for an unresolved measured arm orientation. */
import type { ArmJointLimit, ArmTargetFrame } from "./armTarget.ts";
import type { BoneRotations } from "./bones.ts";
import { conjugate, mul, normalizeQuat, type Quat, quaternionAngle } from "./quat.ts";

interface CoupledInput {
  source: BoneRotations;
  out: BoneRotations;
  chain: readonly number[];
  limits: readonly ArmJointLimit[];
  target: ArmTargetFrame & { orientation: Quat };
  before: ArmTargetFrame;
  sample: (pose: BoneRotations) => ArmTargetFrame;
  /** Absent when no pole was requested; null means its projection is undefined. */
  alignment?: (pose: BoneRotations) => number | null;
  iterations: number;
  tolerance: number;
  orientationTolerance: number;
}

const at = (values: readonly number[], index: number) => values[index] as number;
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, index) => sum + value * at(b, index), 0);
const quatAt = (pose: BoneRotations, bone: number): Quat =>
  Array.from(pose.subarray(bone * 4, bone * 4 + 4)) as Quat;

/** Shortest full rotation vector, with a deterministic sign at a half-turn. */
function log(rotation: Quat): number[] {
  let q = normalizeQuat(rotation);
  if (q[3] < 0 || (q[3] === 0 && (q.find((value) => value !== 0) ?? 0) < 0))
    q = q.map((value) => -value) as Quat;
  const length = Math.hypot(q[0], q[1], q[2]);
  const scale = length === 0 ? 2 : (2 * Math.atan2(length, q[3])) / length;
  return [q[0] * scale, q[1] * scale, q[2] * scale];
}

function exp(vector: readonly number[]): Quat {
  const angle = Math.hypot(...vector);
  const scale = angle === 0 ? 0.5 : Math.sin(angle / 2) / angle;
  return [at(vector, 0) * scale, at(vector, 1) * scale, at(vector, 2) * scale, Math.cos(angle / 2)];
}

function sourceAngle(a: Quat, b: Quat): number {
  // Copying a locked local rotation is exactly zero change, including when
  // its Float32 unit representation has a small norm error.
  return a.every((value, index) => value === b[index])
    ? 0
    : quaternionAngle(normalizeQuat(a), normalizeQuat(b));
}

/** Small damped dual system; invalid arithmetic cannot publish a pose. */
function linearSolve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const rows = matrix.map((row, index) => [...row, at(rhs, index)]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (
        Math.abs(at(rows[row] as number[], column)) > Math.abs(at(rows[pivot] as number[], column))
      )
        pivot = row;
    const divisor = at(rows[pivot] as number[], column);
    if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-18) return null;
    [rows[column], rows[pivot]] = [rows[pivot] as number[], rows[column] as number[]];
    const current = rows[column] as number[];
    for (let i = column; i <= n; i++) current[i] = at(current, i) / divisor;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const other = rows[row] as number[];
      const factor = at(other, column);
      for (let i = column; i <= n; i++) other[i] = at(other, i) - factor * at(current, i);
    }
  }
  const result = rows.map((row) => at(row, n));
  return result.every(Number.isFinite) ? result : null;
}

/**
 * At most four updates and six backtracks each. Internal merit may trade
 * position, orientation and pole progress; only a fresh complete success is
 * copied to the caller's incumbent. Failure leaves that buffer byte-identical.
 */
export function correctArmCoupled(input: CoupledInput): void {
  const { source, out, chain, limits, target, alignment, tolerance, orientationTolerance } = input;
  const updates = Math.min(input.iterations, 4);
  const columns = chain.length * 3;
  // Each update can sample every FD column, six trials and one final validation.
  // The incumbent frame is borrowed from the axial pass, not sampled again.
  const maximumSamples = updates * (columns + 6 + 1);
  let samples = 0;
  const sample = (pose: BoneRotations) => {
    if (samples >= maximumSamples) return null;
    samples++;
    return input.sample(pose);
  };
  const baselineAlignment = alignment?.(out) ?? null;
  const bases = chain.map((bone) => normalizeQuat(quatAt(source, bone)));
  const encode = (values: number[]) => {
    const pose = source.slice();
    const x = [...values];
    for (let joint = 0; joint < chain.length; joint++) {
      const bone = chain[joint] as number;
      const radius = (limits[joint] as ArmJointLimit).maxRadians;
      const base = bases[joint] as Quat;
      let vector = x.slice(joint * 3, joint * 3 + 3);
      const length = Math.hypot(...vector);
      if (!Number.isFinite(length)) return null;
      if (length > radius) vector = vector.map((value) => (value * radius) / length);
      let legal = false;
      for (let shrink = 0; shrink <= 16; shrink++) {
        pose.set(
          radius === 0 ? quatAt(source, bone) : normalizeQuat(mul(exp(vector), base)),
          bone * 4,
        );
        if (sourceAngle(quatAt(source, bone), quatAt(pose, bone)) <= radius) {
          legal = true;
          break;
        }
        vector = vector.map((value) => value * (1 - 1e-7));
      }
      if (!legal) return null;
      x.splice(joint * 3, 3, ...vector);
    }
    return { x, pose };
  };
  // Positive merit scales keep literal zero acceptance tolerances meaningful.
  const positionScale = tolerance || 0.002;
  const orientationScale = orientationTolerance || 0.035;
  const measure = (pose: BoneRotations, frame: ArmTargetFrame | null) => {
    if (!frame?.orientation) return null;
    const position = frame.position.map((value, i) => value - at(target.position, i));
    const orientation = log(mul(target.orientation, conjugate(normalizeQuat(frame.orientation))));
    const pole = alignment?.(pose) ?? null;
    const penalty = !alignment ? 0 : pole === null ? 1e6 : Math.max(0, -pole) / 0.05;
    const residual = [
      ...position.map((value) => value / positionScale),
      ...orientation.map((value) => value / orientationScale),
      penalty,
    ];
    if (!residual.every(Number.isFinite)) return null;
    return {
      residual,
      merit: dot(residual, residual),
      distance: Math.hypot(...position),
      orientationError: quaternionAngle(frame.orientation, target.orientation),
      pole,
    };
  };
  const complete = (value: NonNullable<ReturnType<typeof measure>>) =>
    value.distance <= tolerance &&
    value.orientationError <= orientationTolerance &&
    (!alignment ||
      (value.pole !== null &&
        value.pole > 0 &&
        (baselineAlignment === null || value.pole >= baselineAlignment)));
  let current = {
    x: chain.flatMap((bone, index) =>
      log(mul(normalizeQuat(quatAt(out, bone)), conjugate(bases[index] as Quat))),
    ),
    pose: out.slice(),
  };
  const initial = measure(current.pose, input.before);
  if (!initial) return;
  let value = initial;
  let damping = 0.01;
  for (let update = 0; update < updates; update++) {
    const jacobian: number[][] = [];
    for (let column = 0; column < columns; column++) {
      const shifted = [...current.x];
      shifted[column] = at(shifted, column) + 1e-4;
      const candidate = encode(shifted);
      if (!candidate) return;
      const measured = measure(candidate.pose, sample(candidate.pose));
      if (!measured) return;
      jacobian.push(measured.residual.map((entry, i) => (entry - at(value.residual, i)) / 1e-4));
    }
    const dimension = value.residual.length;
    const gram = Array.from({ length: dimension }, (_, i) =>
      Array.from({ length: dimension }, (_, j) =>
        jacobian.reduce(
          (sum, column) => sum + at(column, i) * at(column, j),
          i === j ? damping : 0,
        ),
      ),
    );
    const dual = linearSolve(gram, value.residual);
    if (!dual) return;
    let delta = jacobian.map((column) => -dot(column, dual));
    const norm = Math.hypot(...delta);
    if (!Number.isFinite(norm)) return;
    if (norm > 0.35) delta = delta.map((entry) => (entry * 0.35) / norm);
    let accepted = false;
    for (let backtrack = 0; backtrack < 6; backtrack++) {
      const trial = encode(current.x.map((entry, i) => entry + at(delta, i) * 2 ** -backtrack));
      if (!trial) continue;
      const measured = measure(trial.pose, sample(trial.pose));
      if (!measured) return;
      if (!(measured.merit < value.merit)) continue;
      current = trial;
      value = measured;
      accepted = true;
      break;
    }
    if (accepted && complete(value)) {
      // Re-read the actual Float32 candidate, independently of optimizer merit.
      const verified = measure(current.pose, sample(current.pose));
      const allowed = new Set(chain);
      const sourceBits = new Uint32Array(source.buffer, source.byteOffset, source.length);
      const candidateBits = new Uint32Array(
        current.pose.buffer,
        current.pose.byteOffset,
        current.pose.length,
      );
      const nonchain = sourceBits.every(
        (bits, i) => allowed.has(Math.floor(i / 4)) || candidateBits[i] === bits,
      );
      const legal = chain.every((bone, i) => {
        const q = quatAt(current.pose, bone);
        return (
          q.every(Number.isFinite) &&
          Math.abs(Math.hypot(...q) - 1) <= 2 ** -22 &&
          sourceAngle(quatAt(source, bone), q) <= (limits[i] as ArmJointLimit).maxRadians
        );
      });
      if (verified && complete(verified) && nonchain && legal) out.set(current.pose);
      return;
    }
    damping = accepted ? Math.max(1e-8, damping / 3) : Math.min(1e8, damping * 10);
  }
}
