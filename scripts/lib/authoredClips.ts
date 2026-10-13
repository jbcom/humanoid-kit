/**
 * Animation clips authored for this package (dedicated to the public domain
 * under CC0 1.0): one JSON file each in `scripts/clips/`, a list of key poses
 * in time, each given as BVH channel values in degrees over the joint layout of
 * a MakeHuman pose (`base`), exactly as an authored pose is (`authoredPoses.ts`).
 *
 * A key states only what changes: every channel it leaves out keeps the value
 * the key before gave it (the first key's are zero, the rest pose). A key may
 * instead start from an earlier key mirrored left for right (`mirror`), which is
 * how a gait's second step is written from its first. Between keys each channel
 * follows a monotone cubic (Fritsch–Carlson), so a motion eases in and out of a
 * held key, never swings past either key it runs between, and a run of keys
 * through a turn stays smooth; a loop's curve runs through its last key back to
 * its first. The packer samples the curves at the clip's frame rate and turns
 * each frame into rotations the same way a BVH frame is (`frameRotations`).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONTACT_BONES } from "../../src/animation/locomotion.ts";
import type { BodyPoseEntry } from "../../src/format/assetFormat.ts";
import { LANDMARK_IDS } from "../../src/foundation/landmarks.ts";
import { frameRotations } from "../../src/rig/pose.ts";
import type { Quat } from "../../src/rig/quat.ts";
import { poseChannels, poseFrame } from "./authoredPoses.ts";

export const AUTHORED_CLIPS_DIR = path.resolve(import.meta.dirname, "../clips");

/** The licence every authored clip's source states. */
export const AUTHORED_LICENCE = "CC0 1.0 Universal (authored for humanoid-kit)";

export interface AuthoredClip {
  id: string;
  title: string;
  description: string;
  tags: string[];
  fps: number;
  /** Frames sampled: `duration × fps` for a loop, one more for a clip that stops on its last. */
  frames: number;
  loop: boolean;
  rootMotion: boolean;
  grounded: boolean;
  /** Optional support metadata preserved in the animation pack manifest. */
  supportTracks?: {
    times: number[];
    supports: (
      | { kind: "sole"; bone: string }
      | { kind: "surface"; landmark: string; radius: number }
    )[];
    chains: string[];
    quality: { contactTolerance: number; maxRotationRadians: number; iterations: number };
  }[];
  /** The file's path from the repository root, and the SHA-256 of its bytes. */
  file: string;
  sha256: string;
  /** Frame `f`'s rotation of each bone it turns, by the bone's index in the skeleton. */
  frame(f: number): Map<number, Quat>;
}

/** Swaps a joint's side: `upperarm01.L` and `upperarm01.R`. */
const otherSide = (joint: string) =>
  joint.endsWith(".L")
    ? `${joint.slice(0, -2)}.R`
    : joint.endsWith(".R")
      ? `${joint.slice(0, -2)}.L`
      : joint;

/**
 * A pose mirrored across the body's midline: each joint's values move to the
 * joint on the other side, the rotation about the axis across the body
 * (`Xrotation`) kept and the two in the midline plane turned the other way.
 */
export function mirrorChannels(values: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, v] of values) {
    const [joint = "", channel = ""] = key.split("/");
    out.set(`${otherSide(joint)}/${channel}`, channel === "Xrotation" ? v : v === 0 ? 0 : -v);
  }
  return out;
}

/**
 * Tangents of the monotone cubic through `(t[i], v[i])` (Fritsch–Butland): zero
 * where the values turn or hold, so the curve never leaves the range of the two
 * keys around it. The ends of an open curve start and stop at rest.
 */
function tangents(t: readonly number[], v: readonly number[], open: boolean): number[] {
  const n = t.length;
  const m = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = (t[i] as number) - (t[i - 1] as number);
    const h1 = (t[i + 1] as number) - (t[i] as number);
    const d0 = ((v[i] as number) - (v[i - 1] as number)) / h0;
    const d1 = ((v[i + 1] as number) - (v[i] as number)) / h1;
    if (d0 * d1 <= 0) continue;
    m[i] = (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
  }
  if (!open) {
    m[0] = 0;
    m[n - 1] = 0;
  }
  return m;
}

/** The cubic Hermite through `(t0, v0)` and `(t1, v1)` with tangents `m0`, `m1`, at `t`. */
function hermite(
  t: number,
  t0: number,
  t1: number,
  v0: number,
  v1: number,
  m0: number,
  m1: number,
) {
  const h = t1 - t0;
  const s = (t - t0) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * v0 +
    (s3 - 2 * s2 + s) * h * m0 +
    (-2 * s3 + 3 * s2) * v1 +
    (s3 - s2) * h * m1
  );
}

/**
 * One channel's curve: its value at each key, sampled at time `t`. A loop's keys
 * are extended by a period on either side, so the curve is smooth across the seam.
 */
export function channelCurve(
  times: readonly number[],
  values: readonly number[],
  loop: number | null,
): (t: number) => number {
  let t = [...times];
  let v = [...values];
  if (loop !== null) {
    const n = times.length;
    t = [(times[n - 1] as number) - loop, ...times, (times[0] as number) + loop];
    v = [values[n - 1] as number, ...values, values[0] as number];
  }
  const m = tangents(t, v, loop !== null);
  return (time) => {
    if (time <= (t[0] as number)) return v[0] as number;
    for (let i = 0; i < t.length - 1; i++) {
      const t1 = t[i + 1] as number;
      if (time <= t1)
        return hermite(
          time,
          t[i] as number,
          t1,
          v[i] as number,
          v[i + 1] as number,
          m[i] as number,
          m[i + 1] as number,
        );
    }
    return v[v.length - 1] as number;
  };
}

const KEYS = new Set([
  "id",
  "title",
  "description",
  "tags",
  "base",
  "fps",
  "duration",
  "loop",
  "rootMotion",
  "grounded",
  "supportTracks",
  "keys",
]);

/** The clip one authored file describes, checked against its base pose and the skeleton. */
export function authoredClip(
  file: string,
  spec: unknown,
  shipped: readonly BodyPoseEntry[],
  bones: readonly string[],
  text = JSON.stringify(spec),
): AuthoredClip {
  const fail = (why: string): never => {
    throw new Error(`clips/${file}: ${why}`);
  };
  if (typeof spec !== "object" || spec === null) return fail("not an object");
  const s = spec as Record<string, unknown>;
  for (const k of Object.keys(s)) if (!KEYS.has(k)) fail(`unknown field ${k}`);
  const { id, title, description, tags, base: baseName, fps, duration, keys } = s;
  if (typeof id !== "string" || `${id}.json` !== file) return fail(`id ${String(id)}`);
  if (!/^[a-z][a-z0-9_]*$/.test(id)) fail(`id ${id} is not snake_case`);
  if (typeof title !== "string" || !title) return fail("needs a title");
  if (typeof description !== "string" || !description) return fail("needs a description");
  if (!Array.isArray(tags) || tags.length === 0 || !tags.every((t) => typeof t === "string"))
    return fail("needs tags");
  const flag = (name: string): boolean => {
    const v = s[name];
    return typeof v === "boolean" ? v : fail(`${name} must be true or false`);
  };
  const loop = flag("loop");
  const rootMotion = flag("rootMotion");
  const grounded = flag("grounded");
  if (fps !== 30) fail("fps must be 30, the frame rate of every packed clip but punkduck's");
  if (typeof duration !== "number" || !(duration > 0)) return fail("needs a positive duration");
  const base = shipped.find((p) => p.name === baseName);
  if (!base) return fail(`unknown base ${String(baseName)}`);
  if (!Array.isArray(keys) || keys.length < 2) return fail("needs at least two keys");

  const times: number[] = [];
  const poses: Map<string, number>[] = [];
  for (const [k, key] of (keys as unknown[]).entries()) {
    const at: (why: string) => never = (why) => fail(`key ${k}: ${why}`);
    if (typeof key !== "object" || key === null) at("not an object");
    const { t, mirror, rotations, ...rest } = key as Record<string, unknown>;
    const extra = Object.keys(rest)[0];
    if (extra !== undefined) at(`unknown field ${extra}`);
    if (typeof t !== "number" || !Number.isFinite(t)) at("needs a time t");
    if (k === 0 && t !== 0) at("the first key is at time 0");
    if (k > 0 && t <= (times[k - 1] as number)) at("keys must be in time order");
    if (loop ? t >= duration : t > duration) at(`time ${t} is past the clip's ${duration} s`);
    if (k === keys.length - 1 && !loop && t !== duration) at("the last key ends the clip");
    let from = poses[k - 1] ?? new Map<string, number>();
    if (mirror !== undefined) {
      if (typeof mirror !== "number" || !Number.isInteger(mirror) || mirror < 0 || mirror >= k)
        at("mirror must name an earlier key");
      from = mirrorChannels(poses[mirror as number] as Map<string, number>);
      // A mirrored key starts from the previous one for what its source leaves at zero.
      for (const [c, v] of poses[k - 1] ?? []) if (!from.has(c)) from.set(c, v);
    }
    const values = new Map(from);
    if (rotations !== undefined)
      for (const [c, v] of poseChannels(rotations, base, bones, at)) values.set(c, v);
    if (k > 0 && mirror === undefined && rotations === undefined) at("changes nothing");
    times.push(t);
    poses.push(values);
  }

  const supportTracks = readSupportTracks(s.supportTracks, times, bones, fail);

  const channels = [...new Set(poses.flatMap((p) => [...p.keys()]))].sort();
  if (!channels.some((c) => poses.some((p) => (p.get(c) ?? 0) !== 0))) fail("rotates nothing");
  const curves = channels.map(
    (c) =>
      [
        c,
        channelCurve(
          times,
          poses.map((p) => p.get(c) ?? 0),
          loop ? duration : null,
        ),
      ] as const,
  );
  const span = Math.round(duration * 30);
  if (Math.abs(span - duration * 30) > 1e-6)
    fail(`duration ${duration} s is not a whole number of frames`);
  const rig = { bones: [...bones] };
  return {
    id,
    title,
    description,
    tags: tags as string[],
    fps: 30,
    frames: loop ? span : span + 1,
    loop,
    rootMotion,
    grounded,
    ...(supportTracks && { supportTracks }),
    file: `scripts/clips/${file}`,
    sha256: createHash("sha256").update(text).digest("hex"),
    frame(f) {
      const time = f / 30;
      const values = new Map(curves.map(([c, curve]) => [c, curve(time)]));
      return frameRotations(rig, base.joints, poseFrame(base, values));
    },
  };
}

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Validates the semantic support declaration before it becomes packed runtime data. */
function readSupportTracks(
  value: unknown,
  keyTimes: readonly number[],
  bones: readonly string[],
  fail: (why: string) => never,
): AuthoredClip["supportTracks"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) fail("supportTracks must be a non-empty array");
  return value.map((track, trackIndex) => {
    if (typeof track !== "object" || track === null)
      fail(`supportTracks ${trackIndex}: not an object`);
    const t = track as Record<string, unknown>;
    const extra = Object.keys(t).find(
      (key) => !["times", "supports", "chains", "quality"].includes(key),
    );
    if (extra) fail(`supportTracks ${trackIndex}: unknown field ${extra}`);
    if (!Array.isArray(t.times) || t.times.length === 0)
      fail(`supportTracks ${trackIndex}: needs times`);
    const times = t.times as unknown[];
    if (
      !times.every(
        (time) => typeof time === "number" && Number.isFinite(time) && keyTimes.includes(time),
      ) ||
      new Set(times).size !== times.length
    )
      fail(`supportTracks ${trackIndex}: times must be distinct authored keys`);
    if (!Array.isArray(t.supports) || t.supports.length === 0)
      fail(`supportTracks ${trackIndex}: needs supports`);
    const supports = t.supports.map((support, supportIndex) => {
      if (typeof support !== "object" || support === null)
        fail(`supportTracks ${trackIndex}: support ${supportIndex} is not an object`);
      const point = support as Record<string, unknown>;
      if (point.kind === "sole") {
        if (
          Object.keys(point).some((key) => key !== "kind" && key !== "bone") ||
          typeof point.bone !== "string" ||
          !CONTACT_BONES.includes(point.bone as (typeof CONTACT_BONES)[number])
        )
          fail(`supportTracks ${trackIndex}: support ${supportIndex} is not a sole contact`);
        return { kind: "sole" as const, bone: point.bone };
      }
      if (point.kind === "surface") {
        if (
          Object.keys(point).some((key) => !["kind", "landmark", "radius"].includes(key)) ||
          typeof point.landmark !== "string" ||
          !LANDMARK_IDS.includes(point.landmark as (typeof LANDMARK_IDS)[number]) ||
          !finitePositive(point.radius)
        )
          fail(`supportTracks ${trackIndex}: support ${supportIndex} is not a surface region`);
        return { kind: "surface" as const, landmark: point.landmark, radius: point.radius };
      }
      return fail(`supportTracks ${trackIndex}: support ${supportIndex} has no known kind`);
    });
    if (
      !Array.isArray(t.chains) ||
      t.chains.length === 0 ||
      !t.chains.every((bone) => typeof bone === "string" && bones.includes(bone)) ||
      !t.chains.every((bone) => /^(upperleg01|lowerleg01|foot)\.[LR]$/.test(bone as string))
    )
      fail(`supportTracks ${trackIndex}: chains must be primary leg bones`);
    if (new Set(t.chains).size !== t.chains.length)
      fail(`supportTracks ${trackIndex}: chains must be distinct`);
    if (typeof t.quality !== "object" || t.quality === null)
      fail(`supportTracks ${trackIndex}: needs quality`);
    const quality = t.quality as Record<string, unknown>;
    if (
      Object.keys(quality).some(
        (key) => !["contactTolerance", "maxRotationRadians", "iterations"].includes(key),
      ) ||
      !finitePositive(quality.contactTolerance) ||
      !finitePositive(quality.maxRotationRadians) ||
      !Number.isInteger(quality.iterations) ||
      (quality.iterations as number) < 1
    )
      fail(`supportTracks ${trackIndex}: quality is invalid`);
    return {
      times: [...(times as number[])],
      supports,
      chains: [...(t.chains as string[])],
      quality: {
        contactTolerance: quality.contactTolerance as number,
        maxRotationRadians: quality.maxRotationRadians as number,
        iterations: quality.iterations as number,
      },
    };
  });
}

/** Every authored clip, in file-name order. */
export function authoredClips(
  shipped: readonly BodyPoseEntry[],
  bones: readonly string[],
  dir = AUTHORED_CLIPS_DIR,
): AuthoredClip[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      return authoredClip(file, JSON.parse(text), shipped, bones, text);
    });
}
