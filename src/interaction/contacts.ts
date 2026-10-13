/**
 * The hand-to-hand contact solve (docs/INTERACTIONS.md, "Alignment on bodies of
 * any size"): where two figures' hands meet, fitted to both bodies' measures.
 * Pure functions of two presences, framework-free, and allocation-free: each
 * writes into the `out` it is given.
 */
import type { FigureMeasures, FigurePresence, Vec3 } from "../presence/presence.ts";

/** Where in the span from hip to shoulder a body's hand rests, 0 at the hip, 1 at the shoulder. */
const COMFORT = 0.5;

/** The height (world metres) a body's hand rests at when it is not reaching. */
const comfortHeight = (floor: number, m: FigureMeasures) =>
  floor + m.hipHeight + COMFORT * (m.shoulderHeight - m.hipHeight);

/**
 * The point where `a`'s and `b`'s hands meet, written into `out`.
 *
 * Along the ground it lies on the line between the two figures, split in
 * proportion to their reach, so each arm stretches the same fraction of its
 * length: figures standing back from a midpoint by the same fraction of their
 * own reach (a handshake's slots) meet exactly there, a tall and a short one
 * each at their own distance. Its height is the mean of the two bodies' resting
 * hand heights, held between the higher hip and the lower shoulder so neither
 * hand is below its own hip or above its own shoulder.
 */
export function gripMeeting(a: FigurePresence, b: FigurePresence, out: Vec3): Vec3 {
  const ra = a.measures.reach;
  const rb = b.measures.reach;
  const t = ra + rb > 0 ? ra / (ra + rb) : 0.5;
  out[0] = a.position[0] + (b.position[0] - a.position[0]) * t;
  out[2] = a.position[2] + (b.position[2] - a.position[2]) * t;
  const aFloor = a.position[1];
  const bFloor = b.position[1];
  let h = (comfortHeight(aFloor, a.measures) + comfortHeight(bFloor, b.measures)) / 2;
  const lo = Math.max(aFloor + a.measures.hipHeight, bFloor + b.measures.hipHeight);
  const hi = Math.min(aFloor + a.measures.shoulderHeight, bFloor + b.measures.shoulderHeight);
  if (lo <= hi) h = Math.min(hi, Math.max(lo, h));
  out[1] = h;
  return out;
}

/**
 * How far `point` stretches `presence`'s arm, as a fraction of its reach: the
 * distance from its shoulder (straight above where it stands) to the point,
 * over `reach`. At most 1 is within reach. Infinite for a figure with no reach.
 */
export function armStretch(presence: FigurePresence, point: Vec3): number {
  const dx = point[0] - presence.position[0];
  const dy = point[1] - (presence.position[1] + presence.measures.shoulderHeight);
  const dz = point[2] - presence.position[2];
  const reach = presence.measures.reach;
  return reach > 0 ? Math.hypot(dx, dy, dz) / reach : Number.POSITIVE_INFINITY;
}
