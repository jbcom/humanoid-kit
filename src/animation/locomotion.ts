/**
 * Where a clip carries a figure: root motion derived from the figure's own feet.
 *
 * A walk cycle's BVH keeps its root in place, and a root translation authored
 * for one skeleton would slide the feet of any other: a child's legs are
 * shorter, an adult's longer, and a stride that suits one skates on the other.
 * Instead, for a figure and a clip, whichever points of its feet are on the
 * ground move the figure backwards by exactly what they move forwards in the
 * pose, frame to frame, so the stride is the one the body's own legs make on any
 * body, never one authored for another. A hand-keyed clip's feet do not agree
 * with their body's pace to the centimetre, so `FootLock` (footlock.ts) then holds
 * the planted feet to it.
 *
 * "On the ground" is soft: each of a foot's three contact points (on the sole
 * under the ankle, and under the ball's two toe joints, carried by the bone that
 * holds the joint) is weighted by `exp(-height / CONTACT_SOFTNESS)`, its height
 * above where it stands at rest, relative to the lowest of all six.
 * A heel that has left the ground, then a flat foot, then the toes, is one
 * continuous hand-over, with no contact state to flicker.
 */
import { type BoneRotations, posedBones, type RestBones } from "../rig/bones.ts";
import { rotate } from "../rig/quat.ts";
import { type AnimationClip, sampleClip } from "./clip.ts";

/** How far above the lowest contact point a point may be and still carry the figure, metres (the e-folding height of its weight). */
export const CONTACT_SOFTNESS = 0.005;

/** The bones whose heads are contact points: per foot, the ankle and the ball's two toe joints. */
export const CONTACT_BONES = [
  "foot.L",
  "toe1-1.L",
  "toe5-1.L",
  "foot.R",
  "toe1-1.R",
  "toe5-1.R",
] as const;

/** How a clip carries a figure: its planar displacement over each interval between frames. */
export interface RootMotionPlan {
  fps: number;
  frames: number;
  loop: boolean;
  /**
   * The figure's displacement from frame `f` to the next (the first, for a loop's
   * last), metres in the figure's axes: x then z, `intervals * 2`.
   */
  step: Float32Array;
  /** The displacement of one whole pass (a loop's cycle), x then z. */
  cycle: [number, number];
}

/** The rig bone index of each contact bone, or an error naming the bone a rig lacks. */
export function contactBones(rest: Pick<RestBones, "names">): Int16Array {
  return Int16Array.from(CONTACT_BONES, (name) => {
    const i = rest.names.indexOf(name);
    if (i < 0) throw new Error(`the rig has no bone ${name}`);
    return i;
  });
}

/**
 * Where the contact points are in `rotations`' pose, written to `out` from `o`
 * as x, height above where the point stands at rest (on the ground), z, per
 * contact bone (`CONTACT_BONES`). A point is on the sole directly below its joint
 * at rest (`ground` is the height of the ground there) and turns with the bone
 * that holds the joint, so a heel, then a flat foot, then the toes are each on the
 * ground in turn.
 */
export function contactPoints(
  rest: RestBones,
  rotations: BoneRotations,
  ground: number,
  out: Float32Array,
  o = 0,
  bones: Int16Array = contactBones(rest),
): void {
  const { world, heads } = posedBones(rest, rotations);
  bones.forEach((b, k) => {
    const down = ground - (rest.heads[b * 3 + 1] as number);
    const sole = rotate(
      [
        world[b * 4] as number,
        world[b * 4 + 1] as number,
        world[b * 4 + 2] as number,
        world[b * 4 + 3] as number,
      ],
      0,
      down,
      0,
    );
    out[o + k * 3] = (heads[b * 3] as number) + sole[0];
    out[o + k * 3 + 1] = (heads[b * 3 + 1] as number) + sole[1] - ground;
    out[o + k * 3 + 2] = (heads[b * 3 + 2] as number) + sole[2];
  });
}

/**
 * The root motion of `clip` for a figure whose skeleton at rest is `rest`: for
 * every interval between frames, the planar displacement that keeps the figure's
 * contact points still on the ground (see the module's comment).
 */
export function planRootMotion(
  rest: RestBones,
  clip: AnimationClip,
  /** Height of the ground under the figure at rest (its lowest point's), metres: how far below each joint the sole is. */
  ground = 0,
): RootMotionPlan {
  const bones = contactBones(rest);
  const pose = new Float32Array(rest.names.length * 4);
  const points = clip.frames;
  /** Per frame, per contact point: x, height above its height at rest, z. */
  const at = new Float32Array(points * bones.length * 3);
  for (let f = 0; f < points; f++) {
    sampleClip(clip, f / clip.fps, pose);
    contactPoints(rest, pose, ground, at, f * bones.length * 3);
  }
  const weights = (f: number): Float64Array => {
    let low = Number.POSITIVE_INFINITY;
    for (let k = 0; k < bones.length; k++)
      low = Math.min(low, at[(f * bones.length + k) * 3 + 1] as number);
    return Float64Array.from({ length: bones.length }, (_, k) =>
      Math.exp(-((at[(f * bones.length + k) * 3 + 1] as number) - low) / CONTACT_SOFTNESS),
    );
  };
  const intervals = clip.loop ? points : points - 1;
  const step = new Float32Array(intervals * 2);
  const cycle: [number, number] = [0, 0];
  const raw = new Float64Array(intervals * 2);
  for (let f = 0; f < intervals; f++) {
    const g = (f + 1) % points;
    const wf = weights(f);
    const wg = weights(g);
    let sx = 0;
    let sz = 0;
    let sw = 0;
    for (let k = 0; k < bones.length; k++) {
      const w = 0.5 * ((wf[k] as number) + (wg[k] as number));
      sx +=
        w *
        ((at[(g * bones.length + k) * 3] as number) - (at[(f * bones.length + k) * 3] as number));
      sz +=
        w *
        ((at[(g * bones.length + k) * 3 + 2] as number) -
          (at[(f * bones.length + k) * 3 + 2] as number));
      sw += w;
    }
    // The ground moves under the planted points, so the figure moves the other way.
    raw[f * 2] = -sx / sw;
    raw[f * 2 + 1] = -sz / sw;
    cycle[0] += -sx / sw;
    cycle[1] += -sz / sw;
  }
  step.set(raw);
  return { fps: clip.fps, frames: clip.frames, loop: clip.loop, step, cycle };
}

/**
 * The displacement over `dt` seconds of the clip's own time from `time`,
 * summed over the intervals it crosses and written to `out` (x, z). A negative
 * `dt` is the same stretch run backwards, so the displacement negated. Past a
 * non-looping clip's end it is zero.
 */
export function rootDisplacement(
  plan: RootMotionPlan,
  time: number,
  dt: number,
  out: [number, number] = [0, 0],
): [number, number] {
  out[0] = 0;
  out[1] = 0;
  if (dt === 0) return out;
  const sign = dt < 0 ? -1 : 1;
  const intervals = plan.step.length / 2;
  const span = plan.loop ? plan.frames : plan.frames - 1;
  // Frame units, forward from the start of the stretch.
  let f = (dt < 0 ? time + dt : time) * plan.fps;
  let remaining = Math.abs(dt) * plan.fps;
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 100000) {
    if (plan.loop) f = ((f % span) + span) % span;
    else if (f < 0 || f >= span) break;
    const i = Math.min(intervals - 1, Math.floor(f));
    const used = Math.min(remaining, i + 1 - f);
    out[0] += sign * (plan.step[i * 2] as number) * used;
    out[1] += sign * (plan.step[i * 2 + 1] as number) * used;
    f += used;
    remaining -= used;
  }
  return out;
}
