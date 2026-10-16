/**
 * Playing clips on one figure: time, speed, crossfades and the root motion that
 * follows from them. The core is framework-free; `update` writes the final pose
 * into buffers the animator owns after chronological contact checkpoints.
 *
 * Face units and any other pose are laid over the result by the caller
 * (`composeRotations`); the animator knows only the body.
 */
import type { BoneRotations, RestBones } from "../rig/bones.ts";
import { type AnimationClip, blendRotations, clipTime, sampleClip, setIdentity } from "./clip.ts";
import { FootLock } from "./footlock.ts";
import { planRootMotion, type RootMotionPlan, rootDisplacement } from "./locomotion.ts";
import { SupportConstraint, type SupportFigure, type SupportReport } from "./supportConstraint.ts";
import { type AnimationTrack, animationTimeline } from "./timeline.ts";

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

const finite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) throw new RangeError(`animation: ${name} must be finite`);
};

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
  private current: AnimationTrack | null = null;
  private previous: AnimationTrack | null = null;
  private fade = { elapsed: 0, duration: 0 };
  private readonly a: BoneRotations;
  private readonly b: BoneRotations;
  private readonly plans = new Map<AnimationClip, RootMotionPlan>();
  private readonly step: [number, number] = [0, 0];
  private readonly supported: BoneRotations;
  private support: SupportConstraint | null = null;
  private supportFigure: SupportFigure | null = null;
  private poseDirty = false;
  /** Last internal authored-support result; an unavailable or unreachable key leaves the sampled pose unchanged. */
  readonly supportReport: SupportReport = {
    state: "idle",
    clip: null,
    time: 0,
    residual: Number.NaN,
    tolerance: null,
  };

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
    this.supported = new Float32Array(bones * 4);
  }

  /** Replaces the skeleton the root motion is planned for (the figure's shape changed). */
  setRest(rest: RestBones | null, ground = 0): void {
    this.rest = rest;
    this.ground = ground;
    this.lock = rest ? new FootLock(rest, ground) : null;
    this.plans.clear();
    this.poseDirty = true;
    this.setSupportFigure(null);
  }

  /** Supplies the evaluated renderer-equivalent surface for private authored support tracks. */
  setSupportFigure(figure: SupportFigure | null): boolean {
    if (
      this.supportFigure?.generation === figure?.generation &&
      this.supportFigure?.anchors === figure?.anchors &&
      this.supportFigure?.folds === figure?.folds
    )
      return false;
    this.poseDirty = true;
    this.supportFigure = figure;
    this.support = figure ? new SupportConstraint(figure) : null;
    return true;
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
    const duration = options.fade ?? DEFAULT_FADE;
    const time = options.time ?? 0;
    const speed = options.speed ?? 1;
    finite(duration, "fade");
    finite(time, "time");
    finite(speed, "speed");
    if (duration < 0) throw new RangeError("animation: fade must be nonnegative");
    const fade = this.current ? duration : 0;
    const next: AnimationTrack = { clip, time, speed };
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
    if (!this.current) return;
    finite(speed, "speed");
    this.current.speed = speed;
  }

  /** Moves the playing clip to `time` seconds into it, without moving the figure. */
  seek(time: number): void {
    if (!this.current) return;
    finite(time, "time");
    this.current.time = time;
    this.previous = null;
    this.lock?.reset();
    this.write();
  }

  /** Forgets how far the figure has been carried. */
  resetRoot(): void {
    this.root[0] = 0;
    this.root[1] = 0;
    this.lock?.reset();
    this.poseDirty = true;
  }

  /** The real foot-contact owner and its hold (left then right); an owner can be fading out. */
  get contactOwnership(): readonly [
    { index: number; hold: number },
    { index: number; hold: number },
  ] {
    return (
      this.lock?.contactOwnership() ?? [
        { index: -1, hold: 0 },
        { index: -1, hold: 0 },
      ]
    );
  }

  /**
   * Advances every clip by `dt` seconds (times its speed), carries the figure by
   * what the clips that carry it do over that time (weighted as they are in the
   * blend), and writes the blended pose to `rotations`.
   */
  update(dt: number): BoneRotations {
    if (!this.current) return this.rotations;
    finite(dt, "dt");
    if (dt < 0)
      throw new RangeError("animation: dt must be nonnegative; reverse with a negative speed");
    if (dt === 0) return this.rotations;
    // Preflight the same pure metadata schedule before changing clocks, root,
    // fades or contact state. An unrepresentable checkpoint must fail atomically.
    for (const _interval of animationTimeline(
      this.current,
      this.previous,
      this.fade,
      dt,
      this.rest !== null,
    )) {
      /* preflight */
    }
    for (const interval of animationTimeline(
      this.current,
      this.previous,
      this.fade,
      dt,
      this.rest !== null,
    )) {
      const cur = this.current;
      const prev = this.previous;
      const changed =
        cur.time !== interval.currentEnd ||
        (prev !== null && interval.previousEnd !== prev.time) ||
        interval.fadeElapsed !== this.fade.elapsed;
      if (prev && interval.previousStart !== null && interval.previousEnd !== null) {
        this.carry(prev, interval.previousStart, interval.previousEnd, interval.previousWeight);
        prev.time = interval.previousEnd;
      }
      this.carry(cur, interval.currentStart, interval.currentEnd, interval.currentWeight);
      cur.time = interval.currentEnd;
      this.fade.elapsed = interval.fadeElapsed;
      if (interval.fadeComplete) this.previous = null;
      if (interval.write && (changed || this.poseDirty))
        this.write(this.poseDirty && !changed ? undefined : interval.supportKey);
    }
    return this.rotations;
  }

  private carry(track: AnimationTrack, from: number, to: number, weight: number): void {
    const plan = this.planOf(track.clip);
    if (plan && weight > 0 && from !== to) {
      rootDisplacement(plan, from, to - from, this.step);
      this.root[0] += this.step[0] * weight;
      this.root[1] += this.step[1] * weight;
    }
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

  private write(supportKey?: number | null): void {
    const cur = this.current;
    if (!cur) return;
    this.poseDirty = false;
    if (!this.previous) {
      sampleClip(cur.clip, cur.time, this.rotations);
      this.alignSupport(
        cur.clip,
        supportKey === undefined ? cur.time : supportKey,
        supportKey !== null,
        supportKey !== undefined,
      );
      if (cur.clip.grounded) this.plant();
      // An airborne clip must not publish the last grounded clip's ownership.
      else this.lock?.reset();
      return;
    }
    const w = smooth(Math.min(1, this.fade.elapsed / this.fade.duration));
    sampleClip(this.previous.clip, this.previous.time, this.a);
    sampleClip(cur.clip, cur.time, this.b);
    blendRotations(this.a, this.b, w, this.rotations);
    this.alignSupport(
      cur.clip,
      supportKey === undefined ? cur.time : supportKey,
      supportKey !== null,
      supportKey !== undefined,
    );
    if (cur.clip.grounded || this.previous.clip.grounded) this.plant();
    // Once the fade has reached two airborne clips, no old sole may remain owned.
    else this.lock?.reset();
  }

  /** Aligns exact authored support keys before FootLock takes its contact snapshots. */
  private alignSupport(
    clip: AnimationClip,
    time: number | null,
    enabled = true,
    exact = false,
  ): void {
    const phase = time === null ? null : clipTime(clip, time);
    const keys = clip.supportTracks?.flatMap((track) => track.times);
    // Internal crossings carry the original authored identity (including a
    // duration seam key). Lifecycle refresh retains approximate phase matching.
    const key =
      enabled && time !== null
        ? exact || keys?.includes(time)
          ? time
          : keys?.find((key) => Math.abs(clipTime(clip, key) - (phase as number)) <= 1e-6)
        : undefined;
    const active = key !== undefined;
    if (!active) {
      Object.assign(this.supportReport, {
        state: "idle",
        clip: null,
        time: time ?? this.current?.time ?? 0,
        residual: Number.NaN,
        tolerance: null,
      });
      return;
    }
    if (!this.support) {
      Object.assign(this.supportReport, {
        state: "unavailable",
        clip: clip.id,
        time: time ?? this.current?.time ?? 0,
        residual: Number.NaN,
        tolerance:
          clip.supportTracks?.find((track) => track.times.includes(key))?.quality
            .contactTolerance ?? null,
      });
      return;
    }
    const report = this.support.apply(clip, key, this.rotations, this.supported);
    this.rotations.set(this.supported);
    Object.assign(this.supportReport, report);
  }

  /** Holds the planted feet, and has the figure give way to one its leg could not reach (`FootLock.correction`). */
  private plant(): void {
    const lock = this.lock;
    if (!lock) return;
    lock.apply(this.rotations, this.root);
    this.root[0] += lock.correction[0] as number;
    this.root[1] += lock.correction[1] as number;
  }
}
