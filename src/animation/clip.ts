/**
 * Animation clips (docs/ARCHITECTURE.md, "Animation"): a clip is a list of
 * frames, each a local rotation per bone it moves, in the figure's axes and
 * relative to the rest pose (which has no rotation, so a rotation is its own
 * delta). A clip says nothing about a figure's size or shape, so one clip plays
 * on every body, and a bone the clip never moves is not stored.
 *
 * Pure: no three.js, no allocation per sample.
 */
import { AssetFormatError } from "../format/assetFormat.ts";
import type { BoneRotations } from "../rig/bones.ts";

/** Where a clip came from and what proves it may be shipped. */
export interface ClipSource {
  /** The archive the clip was packed from. */
  archive: string;
  /** SHA-256 of that archive. */
  archiveSha256: string;
  /** The clip's file inside it. */
  file: string;
  author: string;
  /** The licence the clip's own file states (a `.meta` beside a MakeHuman BVH). */
  licence: string;
}

/** A clip's manifest entry (`humanoid-kit-animations`'s `manifest.json`). */
export interface ClipEntry {
  /** Id, unique in the pack and the name a playback asks for. */
  id: string;
  title: string;
  description: string;
  tags: string[];
  /** Frames per second the clip was authored at. */
  fps: number;
  frames: number;
  /** Seconds: `frames / fps` for a loop, one frame fewer for a clip that stops on its last. */
  duration: number;
  /** Whether the last frame leads back into the first, so the clip repeats seamlessly. */
  loop: boolean;
  /**
   * Whether the clip carries the figure along (a walk, a run) and so is played
   * with root motion; an idle or a gesture stays where it stands.
   */
  rootMotion: boolean;
  /**
   * Whether the figure stands on the ground in the clip (a walk, an idle), so its
   * planted feet are held in place (`FootLock`); a swim or a fall is not.
   */
  grounded: boolean;
  /** The bones the clip moves, by name; each frame stores one rotation per bone, in this order. */
  bones: string[];
  /** The binary: `frames × bones` rotations, quaternions (x, y, z, w) as little-endian float32, gzipped. */
  file: string;
  sha256: string;
  source: ClipSource;
}

export interface AnimationManifest {
  version: 1;
  clips: ClipEntry[];
}

/** A clip bound to a rig's bones and decoded. */
export interface AnimationClip {
  id: string;
  fps: number;
  frames: number;
  duration: number;
  loop: boolean;
  rootMotion: boolean;
  grounded: boolean;
  /** Rig bone index of each clip bone, or -1 for a bone the rig does not have. */
  boneIndex: Int16Array;
  /** `frames × bones × 4` local rotations (x, y, z, w), sign-continuous from frame to frame. */
  rotations: Float32Array;
}

/** Decodes a clip's binary and binds it to the bones of a rig (`bones`, in the rig's order). */
export function parseClip(
  entry: ClipEntry,
  bones: readonly string[],
  bin: ArrayBuffer,
): AnimationClip {
  const count = entry.frames * entry.bones.length * 4;
  if (bin.byteLength !== count * 4)
    throw new AssetFormatError(
      `clip ${entry.id}: ${bin.byteLength} bytes for ${entry.frames} frames of ${entry.bones.length} bones`,
    );
  const index = new Map(bones.map((name, i) => [name, i]));
  const rotations = new Float32Array(count);
  const view = new DataView(bin);
  for (let i = 0; i < count; i++) rotations[i] = view.getFloat32(i * 4, true);
  return {
    id: entry.id,
    fps: entry.fps,
    frames: entry.frames,
    duration: entry.duration,
    loop: entry.loop,
    rootMotion: entry.rootMotion,
    grounded: entry.grounded,
    boneIndex: Int16Array.from(entry.bones, (name) => index.get(name) ?? -1),
    rotations,
  };
}

/** The clip's time for a playback time: wrapped into the clip if it loops, held at its ends if it does not. */
export function clipTime(clip: Pick<AnimationClip, "duration" | "loop">, time: number): number {
  if (clip.loop) {
    const t = time % clip.duration;
    return t < 0 ? t + clip.duration : t;
  }
  return Math.min(clip.duration, Math.max(0, time));
}

/**
 * Spherical interpolation of `a` and `b` (quaternions at the given offsets) by
 * `t`, by the shortest arc, written to `out` at `o`. The arguments are not
 * assumed to share a hemisphere, nor `out` to be distinct from them.
 */
export function slerpInto(
  out: Float32Array,
  o: number,
  a: ArrayLike<number>,
  ao: number,
  b: ArrayLike<number>,
  bo: number,
  t: number,
): void {
  const ax = a[ao] as number;
  const ay = a[ao + 1] as number;
  const az = a[ao + 2] as number;
  const aw = a[ao + 3] as number;
  let bx = b[bo] as number;
  let by = b[bo + 1] as number;
  let bz = b[bo + 2] as number;
  let bw = b[bo + 3] as number;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka: number;
  let kb: number;
  if (dot > 0.9995) {
    // Nearly parallel: the chord is as good as the arc, and sin(angle) is nearly 0.
    ka = 1 - t;
    kb = t;
  } else {
    const angle = Math.acos(dot);
    const s = Math.sin(angle);
    ka = Math.sin((1 - t) * angle) / s;
    kb = Math.sin(t * angle) / s;
  }
  const x = ka * ax + kb * bx;
  const y = ka * ay + kb * by;
  const z = ka * az + kb * bz;
  const w = ka * aw + kb * bw;
  const n = 1 / Math.hypot(x, y, z, w);
  out[o] = x * n;
  out[o + 1] = y * n;
  out[o + 2] = z * n;
  out[o + 3] = w * n;
}

/** Sets every bone of `out` to no rotation. */
export function setIdentity(out: BoneRotations): BoneRotations {
  out.fill(0);
  for (let i = 3; i < out.length; i += 4) out[i] = 1;
  return out;
}

/**
 * The clip's pose at `time` seconds into it: every bone the clip moves is
 * interpolated between its two nearest frames (the last frame to the first, if
 * the clip loops), and every other bone has no rotation. `out` holds `bones * 4`.
 */
export function sampleClip(clip: AnimationClip, time: number, out: BoneRotations): BoneRotations {
  setIdentity(out);
  const t = clipTime(clip, time) * clip.fps;
  const last = clip.frames - 1;
  let f0 = Math.floor(t);
  let w = t - f0;
  if (f0 >= last) {
    // The last frame: it leads into the first if the clip loops, and is held if it does not.
    f0 = last;
    w = clip.loop ? Math.min(1, t - last) : 0;
  }
  const f1 = clip.loop ? (f0 + 1) % clip.frames : Math.min(last, f0 + 1);
  const n = clip.boneIndex.length;
  for (let k = 0; k < n; k++) {
    const b = clip.boneIndex[k] as number;
    if (b < 0) continue;
    slerpInto(out, b * 4, clip.rotations, (f0 * n + k) * 4, clip.rotations, (f1 * n + k) * 4, w);
  }
  return out;
}

/**
 * `a` blended toward `b` by `weight` (0: `a`, 1: `b`), bone by bone along the
 * shortest arc. `out` may be `a` or `b`.
 */
export function blendRotations(
  a: BoneRotations,
  b: BoneRotations,
  weight: number,
  out: BoneRotations = new Float32Array(a.length),
): BoneRotations {
  if (weight <= 0) {
    if (out !== a) out.set(a);
    return out;
  }
  if (weight >= 1) {
    if (out !== b) out.set(b);
    return out;
  }
  for (let i = 0; i < a.length; i += 4) slerpInto(out, i, a, i, b, i, weight);
  return out;
}
