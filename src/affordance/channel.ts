/**
 * The channel behind an aperture (docs/FOUNDATION.md, "Affordances";
 * docs/ARCHITECTURE.md, "Affordances: curved channels";
 * docs/research/AFFORDANCE-CHANNELS.md): a curved path in from the rim with a
 * size at each depth, so the kit can say what is inside an opening, how far in
 * along the path, and whether a point has passed the rim and is to be hidden
 * (what a figure eats dissolves past its lips).
 *
 * A channel's path runs through a few knots set in the head's own frame
 * (forward, up and toward the midline from the rim), smoothed by a centripetal
 * Catmull-Rom spline and sampled to `CHANNEL_SECTIONS` sections. Each section
 * is a plane (the bisector of its two segments) holding an ellipse: `across`
 * and `up` start as the rim frame's bitangent and tangent made square to the
 * path, and are carried along it without twisting.
 * Every size is an adult's, scaled to the figure by the width of its head (its
 * ear canals' span over the default adult's), so a child's are a child's. The
 * mouth's width is the figure's own (between its corners) and its height is
 * how far it is open.
 */
import type { LandmarkFrame, Vec3 } from "../foundation/landmarks.ts";

export type ChannelId = "auditory" | "nasal" | "oral";

/** A point the path passes through, and the channel's size there. */
export interface ChannelKnot {
  /**
   * Where, metres from the rim's centre in the head's frame (`HeadFrame`):
   * forward, up and toward the midline, an adult's.
   */
  at: readonly [number, number, number];
  /** The cross-section's size there as a share of the rim's: across, up. */
  size: readonly [number, number];
}

export interface ChannelSpec {
  /** Its size at the rim, metres across (the rim's bitangent) and up (its tangent), an adult's. */
  rim: { across: number; up: number };
  /** Its path from the rim (the first, at the origin and the rim's size) to its end. */
  knots: readonly ChannelKnot[];
}

/** An ellipse of `area` (square millimetres), `aspect` times as tall as it is wide: its width and height, metres. */
const ellipse = (area: number, aspect: number) => {
  const half = Math.sqrt(area / Math.PI / aspect) / 1000;
  return { across: 2 * half, up: 2 * half * aspect };
};
/** An ellipse's size as a share of `rim`'s, across and up. */
const share = (
  { across, up }: { across: number; up: number },
  rim: { across: number; up: number },
): readonly [number, number] => [across / rim.across, up / rim.up];

// The ear canal's cross-section is an upright ellipse 7.75 by 6.1 mm at its bony part's
// entry (El-Anwar 2023), and its areas along the canal are Voss 2025's adult means.
const EAR_ASPECT = 7.75 / 6.1;
const EAR_RIM = ellipse(101.5, EAR_ASPECT);
const ear = (area: number) => Math.sqrt(area / 101.5);
// The nostril's rim, measured; its valve (54 mm²) and the passage behind it (100 mm²),
// three times as tall as wide (CHOICE).
const NOSTRIL_RIM = { across: 0.0105, up: 0.015 };
const VALVE = share(ellipse(54, 3), NOSTRIL_RIM);
const PASSAGE = share(ellipse(100, 3), NOSTRIL_RIM);

/** The channels' adult paths and sizes (docs/research/AFFORDANCE-CHANNELS.md: measured unless marked CHOICE there). */
export const CHANNELS: Readonly<Record<ChannelId, ChannelSpec>> = {
  // The ear canal, 30.9 mm from its entrance to the tympanic annulus: its first bend 5.3 mm
  // in, turning 41°; its second (where it becomes bony) 15.1 mm in, turning 26°; the
  // isthmus 4 mm short of the annulus. Its path turns as the adult median axis of Voss
  // 2025's figure 6 does (scripts/research/ear-canal-axis.py).
  auditory: {
    rim: EAR_RIM,
    knots: [
      { at: [0, 0, 0], size: [1, 1] },
      { at: [-0.0003, -0.00163, 0.00506], size: [ear(64.5), ear(64.5)] },
      { at: [-0.00416, 0.0013, 0.01352], size: [ear(49.0), ear(49.0)] },
      { at: [-0.00803, -0.00029, 0.02458], size: [ear(32.4), ear(32.4)] },
      { at: [-0.00934, -0.00083, 0.02833], size: [ear(63.7), ear(63.7)] },
    ],
  },
  // The nostril: up through the vestibule (CHOICE: 10 mm), turning back through the
  // nasal valve about 20 mm in, a right angle in all, and back along the passage to the
  // end of the turbinates, 92 mm in.
  nasal: {
    rim: NOSTRIL_RIM,
    knots: [
      { at: [0, 0, 0], size: [1, 1] },
      { at: [0, 0.01, 0], size: [(1 + VALVE[0]) / 2, (1 + VALVE[1]) / 2] },
      { at: [-0.01, 0.015, 0], size: VALVE },
      { at: [-0.081, 0.015, 0], size: PASSAGE },
    ],
  },
  // The mouth: back over the tongue (CHOICE: 40 mm), turning down a right angle (CHOICE)
  // into the oropharynx, 92 mm in all (CHOICE, on the adult oropharyngeal airways' 80 to
  // 100 mm). Its rim is the figure's own width and opens to 45.7 mm (measured); the
  // throat is 60% of the mouth's width and a little over a third of its opening there.
  oral: {
    rim: { across: 0, up: 0.0457 },
    knots: [
      { at: [0, 0, 0], size: [1, 1] },
      { at: [-0.04, 0, 0], size: [1, 1] },
      { at: [-0.06, -0.02, 0], size: [0.8, 0.6] },
      { at: [-0.06, -0.044, 0], size: [0.6, 0.35] },
    ],
  },
};

/** The default adult's ear canals' span, metres: the head width the channels' dimensions are for. */
export const ADULT_EAR_SPAN = 0.1314;

/**
 * How many sections a channel's path is sampled to: the same number of steps
 * across each span between its knots, so a spec has 2, 3, 4, 5, 7, 9, 13 or 25
 * knots.
 */
export const CHANNEL_SECTIONS = 25;

/** The most knots a spec may have. */
const MOST_KNOTS = CHANNEL_SECTIONS;

/** The head's own directions, unit and square to each other, and its centre. */
export interface HeadFrame {
  /** Midway between the ear canals. */
  centre: Vec3;
  /** The way the face looks. */
  forward: Vec3;
  /** From the ear canals toward the crown. */
  up: Vec3;
  /** From the figure's left ear canal toward its right. */
  right: Vec3;
}

/** One section of a channel: a plane across its path holding an ellipse. */
export interface ChannelSection {
  /** The path's point. */
  centre: Vec3;
  /** The plane's normal, along the path into the body: the bisector of its two segments. */
  normal: Vec3;
  /** The ellipse's axes, unit, in the plane. */
  across: Vec3;
  up: Vec3;
  /** Its half-sizes along them, metres. */
  halfAcross: number;
  halfUp: number;
  /** The path's length from the rim to here, metres. */
  depth: number;
}

/** A channel on a figure: where its rim is, the path it takes, and its size along it. */
export interface Channel {
  /** The rim's centre (the first section's). */
  origin: Vec3;
  /** Into the body at the rim, along the path (the first section's normal). */
  inward: Vec3;
  /** The cross-section's axes at the rim: the rim frame's bitangent and tangent, square to the path. */
  across: Vec3;
  up: Vec3;
  /** How long its path is, metres. */
  depth: number;
  /**
   * Its path and size along it, `CHANNEL_SECTIONS` sections from the rim to its
   * end: what `placeIn` and `halfSize` read and the renderer's clip
   * (`ChannelClip`) uploads.
   */
  sections: readonly ChannelSection[];
  /** Its half-sizes (across, up) at `d` metres along its path, metres; 0 past either end. */
  halfSize(d: number): [number, number];
}

/** Where a point is against a channel: how far in it is, and whether it is inside. */
export interface ChannelPlace {
  /** Metres in from the rim along the channel's path (negative: in front of the rim). */
  depth: number;
  /** Inside the channel: past the rim, short of its end, within its cross-section. */
  inside: boolean;
}

/** The half-sizes (across, up) at `d` metres along `sections`, interpolated; 0 past either end. */
export function sectionHalfSize(sections: readonly ChannelSection[], d: number): [number, number] {
  const last = sections[sections.length - 1] as ChannelSection;
  if (d < 0 || d > last.depth) return [0, 0];
  for (let i = 1; i < sections.length; i++) {
    const s0 = sections[i - 1] as ChannelSection;
    const s1 = sections[i] as ChannelSection;
    if (d <= s1.depth) {
      const t = (d - s0.depth) / (s1.depth - s0.depth || 1);
      return [
        s0.halfAcross + (s1.halfAcross - s0.halfAcross) * t,
        s0.halfUp + (s1.halfUp - s0.halfUp) * t,
      ];
    }
  }
  return [last.halfAcross, last.halfUp];
}

const section = (): ChannelSection => ({
  centre: [0, 0, 0],
  normal: [0, 0, 0],
  across: [0, 0, 0],
  up: [0, 0, 0],
  halfAcross: 0,
  halfUp: 0,
  depth: 0,
});

/** A channel whose fields `channelOf` and `channelThrough` write in place: its vectors and sections are its own, reused. */
export function emptyChannel(): Channel {
  const sections = Array.from({ length: CHANNEL_SECTIONS }, section);
  const c: Channel = {
    origin: [0, 0, 0],
    inward: [0, 0, 0],
    across: [0, 0, 0],
    up: [0, 0, 0],
    depth: 0,
    sections,
    halfSize: (d) => sectionHalfSize(c.sections, d),
  };
  owned.add(c);
  return c;
}

/** The channels made by `emptyChannel`, whose vectors may be written. */
const owned = new WeakSet<Channel>();

/** Sets a vector a channel owns (one of `emptyChannel`'s). */
const put = (v: Vec3, x: number, y: number, z: number) => {
  const m = v as unknown as number[];
  m[0] = x;
  m[1] = y;
  m[2] = z;
};

/** The knots' points and half-sizes, in the figure's space, as `channelThrough` reads them. */
export interface ChannelKnots {
  /** How many knots there are: one more than a whole divisor of `CHANNEL_SECTIONS - 1`. */
  count: number;
  /** Their points, x y z each. */
  points: Float64Array;
  /** Their half-sizes, across and up each. */
  halves: Float64Array;
}

/** Knots to write into, room for as many as a spec may have. */
export const channelKnots = (): ChannelKnots => ({
  count: 0,
  points: new Float64Array(MOST_KNOTS * 3),
  halves: new Float64Array(MOST_KNOTS * 2),
});

/** `channelOf`'s working knots, reused. */
const scratchKnots = channelKnots();

/**
 * A channel along a centripetal Catmull-Rom spline through `knots` (in the
 * figure's space), sampled to `CHANNEL_SECTIONS` sections whose half-sizes
 * run linearly between the knots'. `rimUp` is the way the cross-section's `up`
 * points at the rim (made square to the path there); `across` is `up` ×
 * inward. Written into `out` (from `emptyChannel`), allocating nothing.
 */
export function channelThrough(
  knots: ChannelKnots,
  rimUp: Vec3,
  out: Channel = emptyChannel(),
): Channel {
  if (!owned.has(out)) throw new RangeError("channelThrough: out must be made by emptyChannel");
  const n = knots.count;
  const steps = CHANNEL_SECTIONS - 1;
  if (!(n >= 2 && n <= MOST_KNOTS && steps % (n - 1) === 0))
    throw new RangeError(`a channel has 2, 3, 4, 5, 7, 9, 13 or 25 knots, not ${n}`);
  const P = knots.points;
  for (let k = 1; k < n; k++) {
    const d = Math.hypot(
      (P[k * 3] as number) - (P[k * 3 - 3] as number),
      (P[k * 3 + 1] as number) - (P[k * 3 - 2] as number),
      (P[k * 3 + 2] as number) - (P[k * 3 - 1] as number),
    );
    if (!(d > 0)) throw new RangeError("a channel's knots must be apart");
  }
  const per = steps / (n - 1);
  const S = out.sections;
  for (let i = 0; i <= steps; i++) {
    const span = Math.min(Math.floor(i / per), n - 2);
    const u = (i - span * per) / per;
    const s = S[i] as ChannelSection;
    spline(P, n, span, u, s.centre);
    const H = knots.halves;
    s.halfAcross =
      (H[span * 2] as number) + ((H[span * 2 + 2] as number) - (H[span * 2] as number)) * u;
    s.halfUp =
      (H[span * 2 + 1] as number) + ((H[span * 2 + 3] as number) - (H[span * 2 + 1] as number)) * u;
  }
  // Each plane's normal bisects its two segments; the ends take their one segment's way.
  let depth = 0;
  for (let i = 0; i <= steps; i++) {
    const s = S[i] as ChannelSection;
    const c = s.centre;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    if (i > 0) {
      const p = (S[i - 1] as ChannelSection).centre;
      const l = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
      depth += l;
      nx += (c[0] - p[0]) / l;
      ny += (c[1] - p[1]) / l;
      nz += (c[2] - p[2]) / l;
    }
    if (i < steps) {
      const q = (S[i + 1] as ChannelSection).centre;
      const l = Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]);
      nx += (q[0] - c[0]) / l;
      ny += (q[1] - c[1]) / l;
      nz += (q[2] - c[2]) / l;
    }
    const nl = Math.hypot(nx, ny, nz);
    put(s.normal, nx / nl, ny / nl, nz / nl);
    s.depth = depth;
  }
  // The ellipse's axes: the rim's up made square to the first plane, then carried from
  // each plane to the next (made square to it), so the cross-section does not twist.
  let ux = rimUp[0];
  let uy = rimUp[1];
  let uz = rimUp[2];
  for (let i = 0; i <= steps; i++) {
    const s = S[i] as ChannelSection;
    const [nx, ny, nz] = s.normal;
    const d = ux * nx + uy * ny + uz * nz;
    ux -= nx * d;
    uy -= ny * d;
    uz -= nz * d;
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;
    put(s.up, ux, uy, uz);
    put(s.across, uy * nz - uz * ny, uz * nx - ux * nz, ux * ny - uy * nx);
  }
  const first = S[0] as ChannelSection;
  put(out.origin, first.centre[0], first.centre[1], first.centre[2]);
  put(out.inward, first.normal[0], first.normal[1], first.normal[2]);
  put(out.across, first.across[0], first.across[1], first.across[2]);
  put(out.up, first.up[0], first.up[1], first.up[2]);
  out.depth = depth;
  return out;
}

/**
 * The centripetal Catmull-Rom spline through `n` points at `u` (0 to 1) along
 * the span from point `span` to the next, written into `out`. The ends are
 * continued by reflecting their neighbours, so the path leaves the first point
 * toward the second.
 */
function spline(P: Float64Array, n: number, span: number, u: number, out: Vec3): void {
  const at = (k: number, axis: number): number => {
    if (k < 0) return 2 * (P[axis] as number) - (P[3 + axis] as number);
    if (k >= n) return 2 * (P[(n - 1) * 3 + axis] as number) - (P[(n - 2) * 3 + axis] as number);
    return P[k * 3 + axis] as number;
  };
  const gap = (a: number, b: number) =>
    Math.sqrt(Math.hypot(at(b, 0) - at(a, 0), at(b, 1) - at(a, 1), at(b, 2) - at(a, 2)));
  const t0 = 0;
  const t1 = t0 + gap(span - 1, span);
  const t2 = t1 + gap(span, span + 1);
  const t3 = t2 + gap(span + 1, span + 2);
  const t = t1 + (t2 - t1) * u;
  const m = out as unknown as number[];
  for (let axis = 0; axis < 3; axis++) {
    const p0 = at(span - 1, axis);
    const p1 = at(span, axis);
    const p2 = at(span + 1, axis);
    const p3 = at(span + 2, axis);
    const a1 = ((t1 - t) * p0 + (t - t0) * p1) / (t1 - t0);
    const a2 = ((t2 - t) * p1 + (t - t1) * p2) / (t2 - t1);
    const a3 = ((t3 - t) * p2 + (t - t2) * p3) / (t3 - t2);
    const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
    const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
    m[axis] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
  }
}

/**
 * A channel behind a rim. `scale` is the figure's head width over the adult's
 * (`ADULT_EAR_SPAN`), `head` its frame (`headFrameOf`); `opening` (0 to 1)
 * opens a channel that opens (the mouth), whose rim is `width` across (the
 * figure's own mouth, metres). Given `out` (from `emptyChannel`), it is
 * written there and nothing is allocated, as a renderer needs each frame.
 */
export function channelOf(
  id: ChannelId,
  rim: LandmarkFrame,
  scale: number,
  head: HeadFrame,
  opening = 1,
  width?: number,
  out: Channel = emptyChannel(),
): Channel {
  const spec = CHANNELS[id];
  if (!(scale > 0)) throw new RangeError(`channel ${id}: scale must be positive, not ${scale}`);
  if (!owned.has(out)) throw new RangeError("channelOf: out must be made by emptyChannel");
  const halfAcross = (id === "oral" ? (width ?? 0) : spec.rim.across * scale) / 2;
  const halfUp = (spec.rim.up * scale * (id === "oral" ? opening : 1)) / 2;
  const [px, py, pz] = rim.position;
  // Toward the midline: across the head, away from the rim's side.
  const side =
    (px - head.centre[0]) * head.right[0] +
    (py - head.centre[1]) * head.right[1] +
    (pz - head.centre[2]) * head.right[2];
  const medial = side > 0 ? -scale : scale;
  const k = scratchKnots;
  k.count = spec.knots.length;
  spec.knots.forEach(({ at: [f, u, m], size: [sa, su] }, i) => {
    for (let axis = 0; axis < 3; axis++)
      k.points[i * 3 + axis] =
        (rim.position[axis] as number) +
        (head.forward[axis] as number) * f * scale +
        (head.up[axis] as number) * u * scale +
        (head.right[axis] as number) * m * medial;
    k.halves[i * 2] = halfAcross * sa;
    k.halves[i * 2 + 1] = halfUp * su;
  });
  return channelThrough(k, rim.tangent, out);
}

/**
 * The head's frame from its landmarks: the ear canals (left, right), the crown
 * and the nose's tip, written into `out`. Across runs from the left ear canal
 * to the right, up from their midpoint toward the crown (made square to
 * across), and forward square to both, toward the nose.
 */
export function headFrameOf(
  earL: Vec3,
  earR: Vec3,
  crown: Vec3,
  noseTip: Vec3,
  out: HeadFrame = { centre: [0, 0, 0], forward: [0, 0, 0], up: [0, 0, 0], right: [0, 0, 0] },
): HeadFrame {
  const cx = (earL[0] + earR[0]) / 2;
  const cy = (earL[1] + earR[1]) / 2;
  const cz = (earL[2] + earR[2]) / 2;
  let rx = earR[0] - earL[0];
  let ry = earR[1] - earL[1];
  let rz = earR[2] - earL[2];
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl;
  ry /= rl;
  rz /= rl;
  let ux = crown[0] - cx;
  let uy = crown[1] - cy;
  let uz = crown[2] - cz;
  const d = ux * rx + uy * ry + uz * rz;
  ux -= rx * d;
  uy -= ry * d;
  uz -= rz * d;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  let fx = uy * rz - uz * ry;
  let fy = uz * rx - ux * rz;
  let fz = ux * ry - uy * rx;
  if (fx * (noseTip[0] - cx) + fy * (noseTip[1] - cy) + fz * (noseTip[2] - cz) < 0) {
    fx = -fx;
    fy = -fy;
    fz = -fz;
  }
  put(out.centre, cx, cy, cz);
  put(out.right, rx, ry, rz);
  put(out.up, ux, uy, uz);
  put(out.forward, fx, fy, fz);
  return out;
}

const dot3 = (a: Vec3, b: Vec3, o0: number, o1: number, o2: number) =>
  a[0] * (b[0] - o0) + a[1] * (b[1] - o1) + a[2] * (b[2] - o2);

/**
 * Where `p` is against `channel`: behind the first section's plane, in front
 * of the rim; beyond the last's, past the end; otherwise, for each pair of
 * consecutive sections whose planes it lies between, the ellipse interpolated
 * by how far it is from one plane to the next, inside when it falls within
 * it. The renderer's clip (`ChannelClip`) runs the same test.
 */
export function placeIn(channel: Channel, p: Vec3): ChannelPlace {
  const S = channel.sections;
  const first = S[0] as ChannelSection;
  let f0 = dot3(first.normal, p, first.centre[0], first.centre[1], first.centre[2]);
  if (f0 < 0) return { depth: f0, inside: false };
  let depth = Number.NaN;
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1] as ChannelSection;
    const b = S[i] as ChannelSection;
    const f1 = dot3(b.normal, p, b.centre[0], b.centre[1], b.centre[2]);
    if (f0 >= 0 && f1 <= 0) {
      const t = f0 / (f0 - f1 || 1);
      const d = a.depth + (b.depth - a.depth) * t;
      if (Number.isNaN(depth)) depth = d;
      if (inEllipse(a, b, t, p)) return { depth: d, inside: true };
    }
    f0 = f1;
  }
  if (Number.isNaN(depth)) return { depth: channel.depth + f0, inside: false };
  return { depth, inside: false };
}

/** Whether `p` falls within the ellipse `t` of the way from section `a` to `b`. */
function inEllipse(a: ChannelSection, b: ChannelSection, t: number, p: Vec3): boolean {
  const ha = a.halfAcross + (b.halfAcross - a.halfAcross) * t;
  const hu = a.halfUp + (b.halfUp - a.halfUp) * t;
  if (ha <= 0 || hu <= 0) return false;
  const ox = p[0] - (a.centre[0] + (b.centre[0] - a.centre[0]) * t);
  const oy = p[1] - (a.centre[1] + (b.centre[1] - a.centre[1]) * t);
  const oz = p[2] - (a.centre[2] + (b.centre[2] - a.centre[2]) * t);
  const x = projected(a.across, b.across, t, ox, oy, oz) / ha;
  const y = projected(a.up, b.up, t, ox, oy, oz) / hu;
  return x * x + y * y <= 1;
}

/** `o` along the unit axis `t` of the way from `a` to `b`. */
function projected(a: Vec3, b: Vec3, t: number, ox: number, oy: number, oz: number): number {
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  const z = a[2] + (b[2] - a[2]) * t;
  return (ox * x + oy * y + oz * z) / Math.hypot(x, y, z);
}
