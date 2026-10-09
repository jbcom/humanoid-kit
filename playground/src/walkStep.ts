/**
 * How the walk scene (`?scene=walk`) advances its figures each frame.
 *
 * The presence registry measures velocity as displacement over the clock's own
 * step, so the figures must move by speed × that step, however long the frame
 * was. Two things look natural and break that on a slow page:
 *
 * - Clamping the step (to avoid a jump after a hitch) makes the figures move
 *   less than the clock says, so the measured velocity reads low: a 300 ms
 *   frame capped at 100 ms measures a third of the pace.
 * - Wrapping the track on every overshoot: a frame of 3 s at 0.9 m/s is 2.7 m,
 *   more than the 1.8 m track, so every frame ends past the end, wraps to the
 *   start, and the figures measure as standing still for as long as frames stay
 *   that long.
 *
 * So the step is the clock's, and the track wraps only on a frame of ordinary
 * length; after a hitch the figures have simply walked on, and the next
 * ordinary frame brings them back.
 */

/** Metres per second toward the camera, and where the walk wraps. */
export const SPEED = 0.9;
export const Z_RANGE: readonly [number, number] = [-1.2, 0.6];

/** A frame this long or longer never wraps the track, seconds. */
export const MAX_WRAP_STEP = 0.5;

/** The walk's position along z after a frame of `delta` seconds. */
export function stepWalk(z: number, delta: number, walking: boolean): number {
  if (!walking) return z;
  const next = z + SPEED * delta;
  return next > Z_RANGE[1] && delta < MAX_WRAP_STEP ? Z_RANGE[0] : next;
}
