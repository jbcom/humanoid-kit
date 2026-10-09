/**
 * A frame for digits (fingers, toes) measured from the skeleton's joints alone:
 * which digit a vertex lies on, how far along it and how far across. The hands'
 * and the feet's layers are written against it (docs/ARCHITECTURE.md, "Feet").
 *
 * Each digit is a polyline of joints, from a reference point before its base
 * (the wrist; the foot's far end) to its tip. `along` is the distance along the
 * polyline from the digit's base joint (its second point), negative before it.
 * Near a joint the projections onto the segments either side are blended, so
 * `along` and `across` run on smoothly round a bend (the nearest segment's alone
 * jumps by about the radius times the bend at the bisector, which draws a false
 * crease there).
 */

export type Vec3 = [number, number, number];

/** A digit's joints: reference point, base joint, interphalangeal joints, tip. */
export type DigitLine = readonly Vec3[];

export interface DigitFrameInput {
  /** Rest positions, three floats per vertex. */
  positions: Float32Array;
  vertexCount: number;
  /** Whether to measure vertex `v` (the digit's side of the body, near enough). */
  include(v: number): boolean;
  /** The digits' polylines, in digit order (digit 1 first). */
  lines: readonly DigitLine[];
  /** Unit direction of the digits' underside (the palm's facing, the sole's). */
  facing: Vec3;
}

export interface DigitFrame {
  /** The nearest digit, 1-based; 0 for a vertex not measured. */
  digit: Int8Array;
  /** Distance along the digit from its base joint, metres. */
  along: Float32Array;
  /** Signed distance across the digit, metres, along (axis × facing): for an axis of +z and a facing of +y, along −x. */
  across: Float32Array;
  /** The offset from the digit's axis, projected on `facing`: positive on the underside, metres. */
  under: Float32Array;
  /** Per digit (0-based): `along` of its base joint (0), its interphalangeal joints and its tip. */
  joints: readonly (readonly number[])[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: Vec3, b: Vec3, w: number): Vec3 => [
  a[0] + (b[0] - a[0]) * w,
  a[1] + (b[1] - a[1]) * w,
  a[2] + (b[2] - a[2]) * w,
];
const normalise = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

interface Segment {
  digit: number;
  a: Vec3;
  axis: Vec3;
  len: number;
  s0: number;
  prev: Segment | null;
  next: Segment | null;
}

/** The frame of the digits for the vertices `include` picks. */
export function digitFrame(input: DigitFrameInput): DigitFrame {
  const { positions: P, vertexCount: n, include, lines, facing } = input;
  const frame: DigitFrame = {
    digit: new Int8Array(n),
    along: new Float32Array(n),
    across: new Float32Array(n),
    under: new Float32Array(n),
    joints: [],
  };
  const segments: Segment[] = [];
  const joints: number[][] = [];
  lines.forEach((pts, i) => {
    const lens = pts.slice(1).map((p, k) => length(sub(p, pts[k] as Vec3)));
    const s: number[] = [-(lens[0] as number)];
    for (let k = 1; k < pts.length; k++) s.push((s[k - 1] as number) + (lens[k - 1] as number));
    let prev: Segment | null = null;
    for (let k = 0; k < pts.length - 1; k++) {
      const seg: Segment = {
        digit: i + 1,
        a: pts[k] as Vec3,
        axis: normalise(sub(pts[k + 1] as Vec3, pts[k] as Vec3)),
        len: lens[k] as number,
        s0: s[k] as number,
        prev,
        next: null,
      };
      if (prev) prev.next = seg;
      segments.push(seg);
      prev = seg;
    }
    joints.push(s.slice(1));
  });
  (frame as { joints: readonly (readonly number[])[] }).joints = joints;

  for (let v = 0; v < n; v++) {
    if (!include(v)) continue;
    const p: Vec3 = [P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number];
    let best = Number.POSITIVE_INFINITY;
    let pick = segments[0] as Segment;
    let t = 0;
    // The nearest segment (squared distance, no allocation: this runs for every
    // measured vertex against every segment).
    for (const seg of segments) {
      const dx = p[0] - seg.a[0];
      const dy = p[1] - seg.a[1];
      const dz = p[2] - seg.a[2];
      const proj = dx * seg.axis[0] + dy * seg.axis[1] + dz * seg.axis[2];
      const c = clamp(proj, 0, seg.len);
      const ex = dx - seg.axis[0] * c;
      const ey = dy - seg.axis[1] * c;
      const ez = dz - seg.axis[2] * c;
      const dist2 = ex * ex + ey * ey + ez * ez;
      if (dist2 < best) {
        best = dist2;
        pick = seg;
        t = proj;
      }
    }
    // Near a joint, blend the projections onto the segments either side of it.
    const before = t < pick.len / 2 ? pick.prev : pick;
    const after = t < pick.len / 2 ? pick : pick.next;
    let origin = pick.a;
    let along = pick.s0 + t;
    let axis = pick.axis;
    if (before && after) {
      origin = after.a;
      const dj = sub(p, origin);
      const reach = 0.4 * Math.min(before.len, after.len);
      const w = smoothstep(-reach, reach, dot(dj, normalise(lerp3(before.axis, after.axis, 0.5))));
      along = after.s0 + (1 - w) * dot(dj, before.axis) + w * dot(dj, after.axis);
      axis = normalise(lerp3(before.axis, after.axis, w));
    }
    const dj = sub(p, origin);
    const offset = sub(dj, axis.map((c) => c * dot(dj, axis)) as Vec3);
    frame.digit[v] = pick.digit;
    frame.along[v] = along;
    frame.across[v] = dot(offset, normalise(cross(axis, facing)));
    frame.under[v] = dot(offset, facing);
  }
  return frame;
}
