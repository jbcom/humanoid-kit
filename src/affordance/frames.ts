/**
 * Affordances framed on a posed body (docs/ARCHITECTURE.md, "Affordances: the
 * registry"): evaluated from that body's landmarks, never stored, so an
 * affordance is never out of step with the skin it belongs to.
 *
 * Each kind's frame means one thing. An aperture's normal points out of the
 * opening (its channel runs the other way); a mount's and a contact's leave the
 * skin; a grip's leaves the gripping surface, its tangent runs along the hand
 * toward the fingers, and its bitangent is the axis of what it closes round.
 *
 * Frames come from landmark frames, however they were found: a `PosedBody`'s
 * (`landmarks`), or the figure as the renderer draws it, a landmark at a time
 * (`landmarkFrameInto`), which is what `affordanceFrameInto` reads through.
 */
import {
  type FrameOut,
  frameOut,
  type LandmarkFrame,
  type LandmarkId,
  landmarks,
  type Vec3,
} from "../foundation/landmarks.ts";
import type { PosedBody } from "../foundation/posed.ts";
import type { HumanoidModel } from "../model/humanoidModel.ts";
import { ADULT_EAR_SPAN, type Channel, channelOf } from "./channel.ts";
import type { Affordance, FigureAffordances } from "./registry.ts";
import type { AffordanceStates } from "./state.ts";

/** Every landmark's frame on one posed figure (`landmarks`, `landmarkFrames`). */
export type LandmarkFrames = Readonly<Record<LandmarkId, LandmarkFrame>>;

/** Writes landmark `id`'s frame into `out` and returns it. */
export type LandmarkReader = (id: LandmarkId, out: FrameOut) => FrameOut;

/** A reader over frames already found. */
export const readLandmarks =
  (marks: LandmarkFrames): LandmarkReader =>
  (id, out) => {
    const f = marks[id];
    for (let k = 0; k < 3; k++) {
      out.position[k] = f.position[k] as number;
      out.normal[k] = f.normal[k] as number;
      out.tangent[k] = f.tangent[k] as number;
      out.bitangent[k] = f.bitangent[k] as number;
    }
    return out;
  };

/** The landmarks an affordance's frame is read from, held while it is worked out. */
const first = frameOut();
const second = frameOut();

/**
 * One affordance's frame, from its landmarks as `mark` reads them, written into
 * `out`. Allocates nothing beyond what `mark` does.
 */
export function affordanceFrameInto(a: Affordance, mark: LandmarkReader, out: FrameOut): FrameOut {
  if ("between" in a.at) {
    // An opening between two landmarks (the lips) lies across the line from one to the
    // other: the tangent runs along that line, from the second to the first, and the
    // normal is the two skins' facing made square to it.
    const p = mark(a.at.between[0], first);
    const q = mark(a.at.between[1], second);
    const sx = p.position[0] - q.position[0];
    const sy = p.position[1] - q.position[1];
    const sz = p.position[2] - q.position[2];
    const sl = Math.hypot(sx, sy, sz);
    const t0 = sx / sl;
    const t1 = sy / sl;
    const t2 = sz / sl;
    const fx = p.normal[0] + q.normal[0];
    const fy = p.normal[1] + q.normal[1];
    const fz = p.normal[2] + q.normal[2];
    const d = fx * t0 + fy * t1 + fz * t2;
    const nx = fx - t0 * d;
    const ny = fy - t1 * d;
    const nz = fz - t2 * d;
    const nl = Math.hypot(nx, ny, nz);
    const n0 = nx / nl;
    const n1 = ny / nl;
    const n2 = nz / nl;
    out.position[0] = (p.position[0] + q.position[0]) / 2;
    out.position[1] = (p.position[1] + q.position[1]) / 2;
    out.position[2] = (p.position[2] + q.position[2]) / 2;
    return orthonormal(out, n0, n1, n2, t0, t1, t2);
  }
  if (a.kind === "grip") {
    // Along the hand: from the wrist the palm's landmark sits on toward the fingers.
    const wrist = mark(a.at.landmark.endsWith(".R") ? "wrist.R" : "wrist.L", second);
    const wx = wrist.position[0];
    const wy = wrist.position[1];
    const wz = wrist.position[2];
    const at = mark(a.at.landmark, first);
    const nl = Math.hypot(at.normal[0], at.normal[1], at.normal[2]);
    const n0 = at.normal[0] / nl;
    const n1 = at.normal[1] / nl;
    const n2 = at.normal[2] / nl;
    const ax = at.position[0] - wx;
    const ay = at.position[1] - wy;
    const az = at.position[2] - wz;
    const d = ax * n0 + ay * n1 + az * n2;
    const sx = ax - n0 * d;
    const sy = ay - n1 * d;
    const sz = az - n2 * d;
    const tl = Math.hypot(sx, sy, sz);
    out.position[0] = at.position[0];
    out.position[1] = at.position[1];
    out.position[2] = at.position[2];
    return orthonormal(out, n0, n1, n2, sx / tl, sy / tl, sz / tl);
  }
  return mark(a.at.landmark, out);
}

/** Writes a unit normal and tangent square to it into `out`, with the bitangent normal × tangent. */
function orthonormal(
  out: FrameOut,
  n0: number,
  n1: number,
  n2: number,
  t0: number,
  t1: number,
  t2: number,
): FrameOut {
  out.normal[0] = n0;
  out.normal[1] = n1;
  out.normal[2] = n2;
  out.tangent[0] = t0;
  out.tangent[1] = t1;
  out.tangent[2] = t2;
  out.bitangent[0] = n1 * t2 - n2 * t1;
  out.bitangent[1] = n2 * t0 - n0 * t2;
  out.bitangent[2] = n0 * t1 - n1 * t0;
  return out;
}

/**
 * Each of a figure's own affordances (`affordances(recipe)`) framed on its
 * posed figure's landmarks; or, given a model and a posed body
 * (`posedSurface`), on that body's.
 */
export function affordanceFrames(
  marks: LandmarkFrames,
  own: FigureAffordances,
): Readonly<Record<string, LandmarkFrame>>;
export function affordanceFrames(
  model: HumanoidModel,
  body: PosedBody,
  own: FigureAffordances,
): Readonly<Record<string, LandmarkFrame>>;
export function affordanceFrames(
  ...args: [LandmarkFrames, FigureAffordances] | [HumanoidModel, PosedBody, FigureAffordances]
): Readonly<Record<string, LandmarkFrame>> {
  const [marks, own] = args.length === 3 ? [landmarks(args[0], args[1]), args[2]] : args;
  const read = readLandmarks(marks);
  const out: Record<string, LandmarkFrame> = {};
  for (const a of own) out[a.id] = affordanceFrameInto(a, read, frameOut());
  return out;
}

/**
 * An aperture's channel (`channel.ts`) on a posed figure, from its landmarks as
 * `mark` reads them: sized to its head (its ear canals' span) and, for the
 * mouth, to its own mouth (between its corners) and how open it is.
 */
export function affordanceChannel(
  a: Affordance,
  mark: LandmarkReader,
  opening: number,
): Channel | null {
  if (!a.channel) return null;
  const rim = affordanceFrameInto(a, mark, frameOut());
  const l = mark("ear-canal.L", frameOut()).position;
  const r = mark("ear-canal.R", frameOut()).position;
  const ml = mark("mouth-corner.L", frameOut()).position;
  const mr = mark("mouth-corner.R", frameOut()).position;
  const span = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const head: Vec3 = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];
  return channelOf(a.channel, rim, span(l, r) / ADULT_EAR_SPAN, head, opening, span(ml, mr));
}

/**
 * Each of a figure's own apertures' channels on its posed figure's landmarks,
 * opened as `states` say (the mouth by its `opening`); or, given a model and a
 * posed body (`posedSurface`), on that body's.
 */
export function affordanceChannels(
  marks: LandmarkFrames,
  own: FigureAffordances,
  states: AffordanceStates,
): Readonly<Record<string, Channel>>;
export function affordanceChannels(
  model: HumanoidModel,
  body: PosedBody,
  own: FigureAffordances,
  states: AffordanceStates,
): Readonly<Record<string, Channel>>;
export function affordanceChannels(
  ...args:
    | [LandmarkFrames, FigureAffordances, AffordanceStates]
    | [HumanoidModel, PosedBody, FigureAffordances, AffordanceStates]
): Readonly<Record<string, Channel>> {
  const [marks, own, states] =
    args.length === 4 ? [landmarks(args[0], args[1]), args[2], args[3]] : args;
  const read = readLandmarks(marks);
  const out: Record<string, Channel> = {};
  for (const a of own) {
    if (!a.channel) continue;
    const state = states.get(a.id);
    out[a.id] = affordanceChannel(
      a,
      read,
      state.kind === "aperture" ? state.opening : 0,
    ) as Channel;
  }
  return out;
}
