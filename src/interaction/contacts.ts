/**
 * The hand-to-hand contact solve (docs/INTERACTIONS.md, "Alignment on bodies of
 * any size"): where two figures' hands meet, fitted to both bodies' measures.
 * Framework-free numeric helpers reuse caller outputs and module scratch
 * vectors. Geometry publication and runtime caching have separate costs.
 */
import type { FigureMeasures, FigurePresence, HandWorkspace, Vec3 } from "../presence/presence.ts";

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

/** Envelope membership only: `fitted` does not certify joint limits or collision clearance. */
export type GripWorkspaceStatus = "fitted" | "uncertified" | "outside-workspace";

/** Minimum bend retained by contact planning; the solver still measures its final pose. */
const CONTACT_BEND = Math.PI / 12;

/**
 * Conservative socket-to-grip radius. Subtracting the measured wrist/palm
 * offset reserves room for every palm orientation, instead of counting the
 * palm's full length as available in the target direction.
 */
export function gripWorkspaceRadius(workspace: HandWorkspace): number {
  const { upperLength: a, forearmLength: b, palmOffset } = workspace;
  return Math.max(
    0,
    Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(CONTACT_BEND)) - Math.hypot(...palmOffset),
  );
}

const separation = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Closest point in the intersection of two balls; no iteration or allocation. */
function meetingInBalls(a: Vec3, ra: number, b: Vec3, rb: number, out: Vec3): boolean {
  const d = separation(a, b);
  if (d > ra + rb) return false;
  const da = separation(a, out);
  const db = separation(b, out);
  if (da <= ra && db <= rb) return true;
  // First try either single-boundary projection. Nested balls are handled here.
  const px = out[0],
    py = out[1],
    pz = out[2];
  for (let side = 0; side < 2; side++) {
    const c = side === 0 ? a : b;
    const r = side === 0 ? ra : rb;
    const other = side === 0 ? b : a;
    const otherRadius = side === 0 ? rb : ra;
    const dist = side === 0 ? da : db;
    const scale = dist > r ? r / dist : 1;
    const x = c[0] + (px - c[0]) * scale;
    const y = c[1] + (py - c[1]) * scale;
    const z = c[2] + (pz - c[2]) * scale;
    if (Math.hypot(x - other[0], y - other[1], z - other[2]) <= otherRadius) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return true;
    }
  }
  if (d < 1e-12) return false;
  // Both constraints are active: project onto their intersection circle.
  const nx = (b[0] - a[0]) / d,
    ny = (b[1] - a[1]) / d,
    nz = (b[2] - a[2]) / d;
  const along = (ra * ra - rb * rb + d * d) / (2 * d);
  const cx = a[0] + nx * along,
    cy = a[1] + ny * along,
    cz = a[2] + nz * along;
  const radial = Math.sqrt(Math.max(0, ra * ra - along * along));
  const projection = (px - cx) * nx + (py - cy) * ny + (pz - cz) * nz;
  let vx = px - cx - nx * projection,
    vy = py - cy - ny * projection,
    vz = pz - cz - nz * projection;
  let length = Math.hypot(vx, vy, vz);
  if (length < 1e-12) {
    vx = -nx * ny;
    vy = 1 - ny * ny;
    vz = -nz * ny;
    length = Math.hypot(vx, vy, vz);
    if (length < 1e-12) {
      vx = 1;
      vy = 0;
      vz = 0;
      length = 1;
    }
  }
  out[0] = cx + (vx * radial) / length;
  out[1] = cy + (vy * radial) / length;
  out[2] = cz + (vz * radial) / length;
  return true;
}

/** Legacy presences remain explicitly uncertified; they retain the legacy target. */
export function fitGripMeeting(
  a: FigurePresence,
  b: FigurePresence,
  sideA: "L" | "R",
  sideB: "L" | "R",
  out: Vec3,
): GripWorkspaceStatus {
  gripMeeting(a, b, out);
  const wa = a.handWorkspaces?.[sideA],
    wb = b.handWorkspaces?.[sideB];
  if (!wa || !wb) return "uncertified";
  return meetingInBalls(
    wa.shoulder,
    gripWorkspaceRadius(wa),
    wb.shoulder,
    gripWorkspaceRadius(wb),
    out,
  )
    ? "fitted"
    : "outside-workspace";
}

interface Placement {
  position: Vec3;
  facing: Vec3;
}
const shoulderA: Vec3 = [0, 0, 0],
  shoulderB: Vec3 = [0, 0, 0];
function placedShoulder(
  presence: FigurePresence,
  workspace: HandWorkspace,
  placement: Placement,
  out: Vec3,
): void {
  const oldLength = Math.hypot(presence.facing[0], presence.facing[2]);
  const newLength = Math.hypot(placement.facing[0], placement.facing[2]);
  const cos =
    (presence.facing[0] * placement.facing[0] + presence.facing[2] * placement.facing[2]) /
    (oldLength * newLength);
  const sin =
    (placement.facing[0] * presence.facing[2] - placement.facing[2] * presence.facing[0]) /
    (oldLength * newLength);
  const x = workspace.shoulder[0] - presence.position[0],
    z = workspace.shoulder[2] - presence.position[2];
  out[0] = placement.position[0] + cos * x + sin * z;
  out[1] = placement.position[1] + workspace.shoulder[1] - presence.position[1];
  out[2] = placement.position[2] - sin * x + cos * z;
}

/**
 * Fit a pair's requested within-reach slots together, about their pinned
 * reference. Caller deliberately excludes explicit beyond-reach requests.
 * Returns false if even coincident ground placements have no shared envelope.
 */
export function fitGripSlots(
  a: FigurePresence,
  b: FigurePresence,
  sideA: "L" | "R",
  sideB: "L" | "R",
  slotA: Placement,
  slotB: Placement,
  reference: Vec3,
): boolean {
  const wa = a.handWorkspaces?.[sideA],
    wb = b.handWorkspaces?.[sideB];
  if (!wa || !wb) return false;
  placedShoulder(a, wa, slotA, shoulderA);
  placedShoulder(b, wb, slotB, shoulderB);
  const radius = gripWorkspaceRadius(wa) + gripWorkspaceRadius(wb);
  if (separation(shoulderA, shoulderB) <= radius) return true;
  const ax = slotA.position[0] - reference[0],
    az = slotA.position[2] - reference[2];
  const bx = slotB.position[0] - reference[0],
    bz = slotB.position[2] - reference[2];
  const dx = shoulderB[0] - shoulderA[0] - (bx - ax);
  const dy = shoulderB[1] - shoulderA[1];
  const dz = shoulderB[2] - shoulderA[2] - (bz - az);
  if (Math.hypot(dx, dy, dz) >= radius) return false;
  let low = 0,
    high = 1;
  for (let step = 0; step < 32; step++) {
    const scale = (low + high) / 2;
    if (Math.hypot(dx + (bx - ax) * scale, dy, dz + (bz - az) * scale) < radius) low = scale;
    else high = scale;
  }
  slotA.position[0] = reference[0] + ax * low;
  slotA.position[2] = reference[2] + az * low;
  slotB.position[0] = reference[0] + bx * low;
  slotB.position[2] = reference[2] + bz * low;
  return true;
}
