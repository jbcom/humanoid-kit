/**
 * Playing clips on one figure: time, speed, crossfades and the root motion that
 * follows from them. Pure and allocation-free once running: `update` writes
 * into buffers the animator owns, so a caller can call it every frame.
 *
 * Face units and any other pose are laid over the result by the caller
 * (`composeRotations`); the animator knows only the body.
 */
import type { BoneRotations, RestBones } from "../rig/bones.ts";
import { type AnimationClip, blendRotations, clipTime, sampleClip, setIdentity } from "./clip.ts";
import { FootLock } from "./footlock.ts";
import { planRootMotion, type RootMotionPlan, rootDisplacement } from "./locomotion.ts";

export interface PlayOptions {
  /** Seconds the new clip takes to replace the old one; default `DEFAULT_FADE`, and none for the first clip. */
  fade?: number;
  /** Playback speed, 1 being as authored; default 1. */
  speed?: number;
  /** Where in the clip to start, seconds; default 0. */
  time?: number;
}

/** The crossfade between one clip and the next unless told otherwise, seconds. */
export const DEFAULT_FADE = 0.25;

interface Track {
  clip: AnimationClip;
  /** The clip's own time, seconds (not wrapped: `sampleClip` wraps it). */
  time: number;
  speed: number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export class Animator {
  /** The body's local rotations at the current time: `bones * 4`. */
  readonly rotations: BoneRotations;
  /**
   * How far the figure has been carried since the animator was made or `resetRoot`
   * was called, metres in the figure's axes (x across, z forward), for the
   * clips that carry it (`AnimationClip.rootMotion`).
   */
  readonly root: [number, number] = [0, 0];
  private rest: RestBones | null;
  private ground: number;
  private lock: FootLock | null = null;
  private current: Track | null = null;
  private previous: Track | null = null;
  private fade = { elapsed: 0, duration: 0 };
  private readonly a: BoneRotations;
  private readonly b: BoneRotations;
  private readonly plans = new Map<AnimationClip, RootMotionPlan>();
  private readonly step: [number, number] = [0, 0];

  /**
   * `bones` is the rig's bone count; `rest` is the figure's skeleton and `ground`
   * the height of the ground under it at rest, which a clip that carries the
   * figure needs to find out where its feet are (without `rest`, a clip does not
   * move `root`).
   */
  constructor(bones: number, rest: RestBones | null = null, ground = 0) {
    this.rest = rest;
    this.ground = ground;
    this.lock = rest ? new FootLock(rest, ground) : null;
    this.rotations = setIdentity(new Float32Array(bones * 4));
    this.a = new Float32Array(bones * 4);
    this.b = new Float32Array(bones * 4);
  }

  /** Replaces the skeleton the root motion is planned for (the figure's shape changed). */
  setRest(rest: RestBones | null, ground = 0): void {
    this.rest = rest;
    this.ground = ground;
    this.lock = rest ? new FootLock(rest, ground) : null;
    this.plans.clear();
  }

  /** The clip playing, and the time into it. */
  get playing(): { clip: AnimationClip; time: number } | null {
    return this.current && { clip: this.current.clip, time: this.current.time };
  }

  /** Whether one clip is still fading into another. */
  get fading(): boolean {
    return this.previous !== null;
  }

  /** Starts `clip`, fading from the one playing (none for the first). */
  play(clip: AnimationClip, options: PlayOptions = {}): void {
    const fade = this.current ? (options.fade ?? DEFAULT_FADE) : 0;
    const next: Track = { clip, time: options.time ?? 0, speed: options.speed ?? 1 };
    if (fade > 0 && this.current) {
      this.previous = this.current;
      this.fade = { elapsed: 0, duration: fade };
    } else {
      this.previous = null;
    }
    this.current = next;
    this.write();
  }

  /** Sets the playing clip's speed, or does nothing if none plays. */
  setSpeed(speed: number): void {
    if (this.current) this.current.speed = speed;
  }

  /** Moves the playing clip to `time` seconds into it, without moving the figure. */
  seek(time: number): void {
    if (this.current) this.current.time = time;
    this.previous = null;
    this.lock?.reset();
    this.write();
  }

  /** Forgets how far the figure has been carried. */
  resetRoot(): void {
    this.root[0] = 0;
    this.root[1] = 0;
    this.lock?.reset();
  }

  /**
   * Advances every clip by `dt` seconds (times its speed), carries the figure by
   * what the clips that carry it do over that time (weighted as they are in the
   * blend), and writes the blended pose to `rotations`.
   */
  update(dt: number): BoneRotations {
    if (!this.current) return this.rotations;
    let w = 1;
    if (this.previous) {
      this.fade.elapsed += dt;
      w = smooth(Math.min(1, this.fade.elapsed / this.fade.duration));
    }
    if (this.previous) this.carry(this.previous, dt, 1 - w);
    this.carry(this.current, dt, w);
    if (this.previous && w >= 1) this.previous = null;
    this.write();
    return this.rotations;
  }

  private carry(track: Track, dt: number, weight: number): void {
    const plan = this.planOf(track.clip);
    if (plan && weight > 0) {
      rootDisplacement(plan, track.time, dt * track.speed, this.step);
      this.root[0] += this.step[0] * weight;
      this.root[1] += this.step[1] * weight;
    }
    track.time += dt * track.speed;
    // A clip that does not loop stops on its last frame.
    if (!track.clip.loop) track.time = clipTime(track.clip, track.time);
  }

  private planOf(clip: AnimationClip): RootMotionPlan | null {
    if (!clip.rootMotion || !this.rest) return null;
    let plan = this.plans.get(clip);
    if (!plan) {
      plan = planRootMotion(this.rest, clip, this.ground);
      this.plans.set(clip, plan);
    }
    return plan;
  }

  private write(): void {
    const cur = this.current;
    if (!cur) return;
    if (!this.previous) {
      sampleClip(cur.clip, cur.time, this.rotations);
      if (cur.clip.grounded) this.lock?.apply(this.rotations, this.root);
      return;
    }
    const w = smooth(Math.min(1, this.fade.elapsed / this.fade.duration));
    sampleClip(this.previous.clip, this.previous.time, this.a);
    sampleClip(cur.clip, cur.time, this.b);
    blendRotations(this.a, this.b, w, this.rotations);
    if (cur.clip.grounded || this.previous.clip.grounded)
      this.lock?.apply(this.rotations, this.root);
  }
}
