/**
 * Internal authored-support alignment for poses that must put a skinned body
 * contact and selected soles on the same floor. It deliberately operates on
 * the evaluated figure rather than an authored body: the renderer's eight
 * skin influences, pose-dependent dual shares and active joint folds are the
 * surface being measured.
 */

import { SKIN_INFLUENCES } from "../format/assetFormat.ts";
import type { LandmarkAnchors } from "../foundation/landmarks.ts";
import type { BoneRotations, RestBones } from "../rig/bones.ts";
import {
  type SkinFold,
  skinFolds,
  skinPoseInto,
  skinPoseScratch,
  skinPositionAt,
} from "../rig/dual.ts";
import { type JointFold, renderFold, type SurfaceFold } from "../rig/jointFold.ts";
import { mul, normalizeQuat, type Quat } from "../rig/quat.ts";
import { poseShare, skinDualShare } from "../rig/skinShare.ts";
import type { AnimationClip } from "./clip.ts";
import { contactBones, contactPoints } from "./locomotion.ts";

type SkinIndex = Uint8Array | Uint16Array;
type Track = NonNullable<AnimationClip["supportTracks"]>[number];

/** The immutable evaluated figure sampled by the internal support solver. */
export interface SupportFigure {
  /** Changes whenever the evaluated geometry or its source fold tables change. */
  generation: object;
  restBones: RestBones;
  /** The figure-local floor at rest, the same ground FootLock and frame lift use. */
  ground: number;
  /** Evaluated render vertices before posing, and their renderer skin weights. */
  rest: Float32Array;
  skinIndex: SkinIndex;
  skinWeight: Float32Array;
  anchors: LandmarkAnchors;
  /** The evaluated surface's raw fold tables, before their pose-dependent read. */
  folds?: readonly SurfaceFold[];
}

export type SupportState = "idle" | "satisfied" | "unreachable" | "unavailable";

/** The last internal alignment attempt. `unreachable` always leaves the source pose untouched. */
export interface SupportReport {
  state: SupportState;
  clip: string | null;
  time: number;
  /** Largest grounded support height after the renderer's sole lift, metres. */
  residual: number;
  /** The authored tolerance, metres, or null when no track was active. */
  tolerance: number | null;
}

const KEY_EPSILON = 1e-6;
const DIFFERENCE = 0.004;
const DAMPING = 0.003;
const MAX_STEP = 0.08;

const identityReport = (): SupportReport => ({
  state: "idle",
  clip: null,
  time: 0,
  residual: Number.NaN,
  tolerance: null,
});

const quatAt = (a: ArrayLike<number>, b: number): Quat => [
  a[b * 4] as number,
  a[b * 4 + 1] as number,
  a[b * 4 + 2] as number,
  a[b * 4 + 3] as number,
];

const vectorTurn = (x: number, y: number, z: number): Quat => {
  const radians = Math.hypot(x, y, z);
  if (radians < 1e-12) return [0, 0, 0, 1];
  const scale = Math.sin(radians / 2) / radians;
  return [x * scale, y * scale, z * scale, Math.cos(radians / 2)];
};

function activeTrack(clip: AnimationClip, time: number): Track | null {
  return (
    clip.supportTracks?.find((track) =>
      track.times.some((key) => Math.abs(key - time) <= KEY_EPSILON),
    ) ?? null
  );
}

function solveLinear(a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const m = new Float64Array(n * (n + 1));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) m[r * (n + 1) + c] = a[r * n + c] as number;
    m[r * (n + 1) + n] = b[r] as number;
  }
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r * (n + 1) + c] as number) > Math.abs(m[pivot * (n + 1) + c] as number))
        pivot = r;
    const p = m[pivot * (n + 1) + c] as number;
    if (!(Math.abs(p) > 1e-12)) return null;
    if (pivot !== c)
      for (let k = c; k <= n; k++) {
        const at = c * (n + 1) + k;
        const other = pivot * (n + 1) + k;
        const held = m[at] as number;
        m[at] = m[other] as number;
        m[other] = held;
      }
    for (let k = c; k <= n; k++) m[c * (n + 1) + k] = (m[c * (n + 1) + k] as number) / p;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const scale = m[r * (n + 1) + c] as number;
      if (scale === 0) continue;
      for (let k = c; k <= n; k++)
        m[r * (n + 1) + k] =
          (m[r * (n + 1) + k] as number) - scale * (m[c * (n + 1) + k] as number);
    }
  }
  return Float64Array.from({ length: n }, (_, i) => m[i * (n + 1) + n] as number);
}

/**
 * One evaluated figure's support solver. It is intentionally not a public
 * animation API: `Animator` creates it from React's renderer-equivalent input.
 */
export class SupportConstraint {
  readonly report = identityReport();
  private readonly rest: RestBones;
  private readonly skinIndex: SkinIndex;
  private readonly skinWeight: Float32Array;
  private readonly positions: Float32Array;
  private readonly ground: number;
  private readonly anchors: LandmarkAnchors;
  private readonly renderedFolds: readonly JointFold[];
  private readonly contacts: Int16Array;
  private readonly soles = new Float32Array(18);
  private readonly poseScratch;
  private readonly candidate: BoneRotations;
  private readonly prepared = new WeakMap<object, PreparedSupport[]>();

  constructor(figure: SupportFigure) {
    const { restBones: rest, rest: positions, skinIndex, skinWeight, anchors, ground } = figure;
    if (
      positions.length / 3 !== skinIndex.length / SKIN_INFLUENCES ||
      skinIndex.length !== skinWeight.length
    )
      throw new RangeError("support constraint: evaluated geometry and skin weights do not agree");
    this.rest = rest;
    if (!Number.isFinite(ground)) throw new RangeError("support constraint: ground must be finite");
    this.positions = positions;
    this.ground = ground;
    this.skinIndex = skinIndex;
    this.skinWeight = skinWeight;
    this.anchors = anchors;
    this.renderedFolds = figure.folds?.map(renderFold) ?? [];
    this.contacts = contactBones(rest);
    this.poseScratch = skinPoseScratch(rest, skinDualShare(rest.names));
    this.candidate = new Float32Array(rest.names.length * 4);
  }

  /** Applies the active exact-key support track, or copies `source` unchanged. */
  apply(
    clip: AnimationClip,
    time: number,
    source: BoneRotations,
    out: BoneRotations,
  ): SupportReport {
    const track = activeTrack(clip, time);
    if (!track) {
      out.set(source);
      Object.assign(this.report, { ...identityReport(), time });
      return this.report;
    }
    const fail = (state: SupportState, residual = Number.NaN) => {
      out.set(source);
      Object.assign(this.report, {
        state,
        clip: clip.id,
        time,
        residual,
        tolerance: track.quality.contactTolerance,
      } satisfies SupportReport);
      return this.report;
    };
    if (source.length !== this.candidate.length) return fail("unavailable");
    const chains = track.chains.map((name) => this.rest.names.indexOf(name));
    if (chains.some((bone) => bone < 0)) return fail("unavailable");
    const supports = this.prepared.get(track) ?? this.prepareAndRemember(track, source);
    if (!supports) return fail("unavailable");
    const values = new Float64Array(chains.length * 3);
    let measured = this.measure(source, values, chains, supports);
    if (!measured) return fail("unavailable");
    if (measured.residual <= track.quality.contactTolerance) {
      out.set(source);
      Object.assign(this.report, {
        state: "satisfied",
        clip: clip.id,
        time,
        residual: measured.residual,
        tolerance: track.quality.contactTolerance,
      } satisfies SupportReport);
      return this.report;
    }
    let bestResidual = measured.residual;
    const n = values.length;
    const m = supports.length;
    const jacobian = new Float64Array(m * n);
    for (let iteration = 0; iteration < track.quality.iterations; iteration++) {
      for (let column = 0; column < n; column++) {
        const trial = Float64Array.from(values);
        trial[column] = (trial[column] as number) + DIFFERENCE;
        const sample = this.measure(source, trial, chains, supports);
        if (!sample) return fail("unavailable", measured.residual);
        for (let row = 0; row < m; row++)
          jacobian[row * n + column] =
            ((sample.residuals[row] as number) - (measured.residuals[row] as number)) / DIFFERENCE;
      }
      const normal = new Float64Array(n * n);
      const rhs = new Float64Array(n);
      for (let row = 0; row < m; row++)
        for (let c = 0; c < n; c++) {
          const j = jacobian[row * n + c] as number;
          rhs[c] = (rhs[c] as number) - j * (measured.residuals[row] as number);
          for (let d = 0; d < n; d++)
            normal[c * n + d] =
              (normal[c * n + d] as number) + j * (jacobian[row * n + d] as number);
        }
      for (let c = 0; c < n; c++) normal[c * n + c] = (normal[c * n + c] as number) + DAMPING;
      const step = solveLinear(normal, rhs, n);
      if (!step) return fail("unreachable", measured.residual);
      const largest = Math.max(...step.map((value) => Math.abs(value)));
      const cap = largest > MAX_STEP ? MAX_STEP / largest : 1;
      let accepted: { values: Float64Array; measured: Measurement } | null = null;
      for (let backoff = 0; backoff < 6; backoff++) {
        const trial = Float64Array.from(values);
        const scale = cap * 0.5 ** backoff;
        let changed = false;
        for (let c = 0; c < n; c++) {
          const next = (trial[c] as number) + scale * (step[c] as number);
          changed ||= Math.abs(next - (trial[c] as number)) > 1e-8;
          trial[c] = next;
        }
        for (let bone = 0; bone < chains.length; bone++) {
          const at = bone * 3;
          const length = Math.hypot(
            trial[at] as number,
            trial[at + 1] as number,
            trial[at + 2] as number,
          );
          if (length > track.quality.maxRotationRadians) {
            const fit = track.quality.maxRotationRadians / length;
            trial[at] = (trial[at] as number) * fit;
            trial[at + 1] = (trial[at + 1] as number) * fit;
            trial[at + 2] = (trial[at + 2] as number) * fit;
          }
        }
        if (!changed) break;
        const next = this.measure(source, trial, chains, supports);
        if (next.residual < measured.residual) {
          accepted = { values: trial, measured: next };
          break;
        }
      }
      if (!accepted) break;
      values.set(accepted.values);
      measured = accepted.measured;
      bestResidual = Math.min(bestResidual, measured.residual);
      if (measured.residual <= track.quality.contactTolerance) {
        this.write(source, values, chains, out);
        Object.assign(this.report, {
          state: "satisfied",
          clip: clip.id,
          time,
          residual: measured.residual,
          tolerance: track.quality.contactTolerance,
        } satisfies SupportReport);
        return this.report;
      }
    }
    return fail("unreachable", bestResidual);
  }

  private prepareAndRemember(track: Track, source: BoneRotations): PreparedSupport[] | null {
    const skin = this.skinAll(source);
    const out: PreparedSupport[] = [];
    for (const support of track.supports) {
      if (support.kind === "sole") {
        const index = this.rest.names.indexOf(support.bone);
        const contact = Array.from(this.contacts).indexOf(index);
        if (contact < 0) return null;
        out.push({ kind: "sole", contact });
        continue;
      }
      const joint = this.anchors.joints[support.landmark as keyof typeof this.anchors.joints];
      const surface = this.anchors.vertices[support.landmark as keyof typeof this.anchors.vertices];
      const center: [number, number, number] | null = joint
        ? [
            skin.heads[joint.at * 3] as number,
            skin.heads[joint.at * 3 + 1] as number,
            skin.heads[joint.at * 3 + 2] as number,
          ]
        : surface
          ? [
              skin.positions[surface.vertex * 3] as number,
              skin.positions[surface.vertex * 3 + 1] as number,
              skin.positions[surface.vertex * 3 + 2] as number,
            ]
          : null;
      if (!center) return null;
      const vertices: number[] = [];
      for (let v = 0; v < this.positions.length / 3; v++) {
        const dx = (skin.positions[v * 3] as number) - center[0];
        const dy = (skin.positions[v * 3 + 1] as number) - center[1];
        const dz = (skin.positions[v * 3 + 2] as number) - center[2];
        if (Math.hypot(dx, dy, dz) <= support.radius) vertices.push(v);
      }
      if (vertices.length === 0) return null;
      out.push({ kind: "surface", vertices });
    }
    this.prepared.set(track, out);
    return out;
  }

  private write(
    source: BoneRotations,
    values: Float64Array,
    bones: readonly number[],
    out: BoneRotations,
  ): void {
    out.set(source);
    for (let i = 0; i < bones.length; i++) {
      const at = i * 3;
      const delta = vectorTurn(
        values[at] as number,
        values[at + 1] as number,
        values[at + 2] as number,
      );
      out.set(
        normalizeQuat(mul(delta, quatAt(source, bones[i] as number))),
        (bones[i] as number) * 4,
      );
    }
  }

  /** Poses the exact render skin only while selecting a semantic region. */
  private skinAll(rotations: BoneRotations): { positions: Float32Array; heads: Float32Array } {
    const folds = this.preparePose(rotations);
    const points = new Float32Array(this.positions.length);
    const point = new Float64Array(3);
    for (let v = 0; v < points.length / 3; v++) {
      skinPositionAt(
        this.poseScratch.pose,
        this.skinIndex,
        this.skinWeight,
        v,
        this.positions[v * 3] as number,
        this.positions[v * 3 + 1] as number,
        this.positions[v * 3 + 2] as number,
        point,
        0,
        folds,
      );
      points[v * 3] = point[0] as number;
      points[v * 3 + 1] = point[1] as number;
      points[v * 3 + 2] = point[2] as number;
    }
    return { positions: points, heads: this.poseScratch.skeleton.heads };
  }

  /** Refreshes the candidate's renderer-equivalent bones, shares and fold state. */
  private preparePose(rotations: BoneRotations): readonly SkinFold[] {
    skinPoseInto(
      this.rest,
      rotations,
      poseShare(this.rest, rotations, skinDualShare(this.rest.names)),
      this.poseScratch,
    );
    return skinFolds(this.rest, rotations, this.renderedFolds);
  }

  private measure(
    source: BoneRotations,
    values: Float64Array,
    bones: readonly number[],
    supports: readonly PreparedSupport[],
  ): Measurement {
    this.write(source, values, bones, this.candidate);
    const folds = this.preparePose(this.candidate);
    contactPoints(this.rest, this.candidate, this.ground, this.soles, 0, this.contacts);
    let floor = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 6; k++) floor = Math.min(floor, this.soles[k * 3 + 1] as number);
    const heights = new Float64Array(supports.length);
    const point = new Float64Array(3);
    for (let i = 0; i < supports.length; i++) {
      const support = supports[i] as PreparedSupport;
      if (support.kind === "sole")
        heights[i] = (this.soles[support.contact * 3 + 1] as number) - floor;
      else {
        let low = Number.POSITIVE_INFINITY;
        for (const vertex of support.vertices) {
          skinPositionAt(
            this.poseScratch.pose,
            this.skinIndex,
            this.skinWeight,
            vertex,
            this.positions[vertex * 3] as number,
            this.positions[vertex * 3 + 1] as number,
            this.positions[vertex * 3 + 2] as number,
            point,
            0,
            folds,
          );
          low = Math.min(low, point[1] as number);
        }
        heights[i] = low - this.ground - floor;
      }
    }
    let residual = 0;
    for (const height of heights) residual = Math.max(residual, Math.abs(height));
    return { residual, residuals: heights };
  }
}

type PreparedSupport = { kind: "sole"; contact: number } | { kind: "surface"; vertices: number[] };
type Measurement = { residual: number; residuals: Float64Array };
