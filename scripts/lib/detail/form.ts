/**
 * A shape drawn out of a reservoir, seen along its own centreline, so it can be
 * resized, and blended with another sculpt of the same organ, without losing its
 * form (docs/research/ADULT-SCULPT-PLAN.md, section 6d, step 5).
 *
 * The centreline runs through the loop's centre and each ring's centroid. Each
 * segment keeps its direction and length. Frames ride along it without twist,
 * starting with the reference direction (dorsal for a shaft) across the first
 * tangent. Every ring vertex keeps its offset in its ring's frame, and every cap
 * vertex keeps its offset in the last ring's frame. Sweeping the form back with
 * nothing changed returns the shape exactly.
 *
 * A pose rescales the segments' lengths and the offsets, fading in from the first
 * ring over `blend` metres of arclength, so the loop and the first ring (the skin
 * line, on the skin) stay where they are and the root keeps its shape. It never turns the centreline: a form's directions are its
 * sculpt's, or a blend of two sculpts' (`blendForms`).
 */
import type { Vec3 } from "./disc.ts";
import { capSurface, nearestOnSurface, type ReservoirRoot, type RootShape } from "./root.ts";
import { smooth } from "./tube.ts";

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** `v` turned by the rotation that takes unit `from` to unit `to` (the shortest one). */
function carry(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const axis = cross(from, to);
  const s = Math.hypot(axis[0], axis[1], axis[2]);
  const c = dot(from, to);
  if (s < 1e-12) return v;
  const k = scale(axis, 1 / s);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** `a` turned toward `b` by share `t` of the angle between them (unit vectors). */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const c = Math.min(1, Math.max(-1, dot(a, b)));
  const angle = Math.acos(c);
  if (angle < 1e-9) return a;
  const s = Math.sin(angle);
  return norm(add(scale(a, Math.sin((1 - t) * angle) / s), scale(b, Math.sin(t * angle) / s)));
}

export interface Form {
  root: ReservoirRoot;
  /** Each segment's unit direction: segment k runs from centre k - 1 to centre k (k = 1..rings). */
  directions: Vec3[];
  /** Each segment's length, metres. */
  lengths: number[];
  /** The reference direction across the root's tangent that starts the frames. */
  reference: Vec3;
  /** Ring k's vertices' offsets (across, up, along) in its frame; index k - 1. */
  rings: Vec3[][];
  /**
   * The first ring where it is: the skin line the sculpt is attached at
   * (`transfer.ts`, `skinLine`), which no pose or blend moves. Its offsets are kept in
   * a frame turned by the second segment, which differs between two sculpts of one
   * organ, so a blend of the offsets would lift it off the skin.
   */
  line: Vec3[];
  /** The cap's vertices' offsets in the last ring's frame. */
  cap: Vec3[];
}

/** A frame: tangent, and the two directions across it (`across` from the reference, `up` = tangent x across). */
interface Frame {
  t: Vec3;
  a: Vec3;
  u: Vec3;
}

/** The frames at the loop's centre and each ring's centroid, carried along the segments without twist. */
function frames(directions: readonly Vec3[], reference: Vec3): Frame[] {
  const R = directions.length;
  const tangent = (k: number): Vec3 =>
    k === 0
      ? (directions[0] as Vec3)
      : k === R
        ? (directions[R - 1] as Vec3)
        : norm(add(directions[k - 1] as Vec3, directions[k] as Vec3));
  const t0 = tangent(0);
  const a0 = norm(sub(reference, scale(t0, dot(reference, t0))));
  const out: Frame[] = [{ t: t0, a: a0, u: cross(t0, a0) }];
  for (let k = 1; k <= R; k++) {
    const prev = out[k - 1] as Frame;
    const t = tangent(k);
    const a = norm(carry(prev.a, prev.t, t));
    out.push({ t, a, u: cross(t, a) });
  }
  return out;
}

/** The centreline points of a form's segments, from the loop's centre. */
function centres(
  root: ReservoirRoot,
  directions: readonly Vec3[],
  lengths: readonly number[],
): Vec3[] {
  const out: Vec3[] = [root.centre];
  directions.forEach((d, k) => {
    out.push(add(out[k] as Vec3, scale(d, lengths[k] as number)));
  });
  return out;
}

/** The form of a shape of this root (`RootShape` order: cap, then rings). */
export function formOf(root: ReservoirRoot, shape: RootShape, reference: Vec3): Form {
  const n = root.loop.length;
  const R = root.rings;
  const capCount = root.cap.length;
  const ring = (k: number) => shape.slice(capCount + (k - 1) * n, capCount + k * n) as Vec3[];
  const points: Vec3[] = [root.centre];
  for (let k = 1; k <= R; k++) {
    const r = ring(k);
    points.push(
      r.reduce<Vec3>((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]),
    );
  }
  const directions: Vec3[] = [];
  const lengths: number[] = [];
  for (let k = 1; k <= R; k++) {
    const d = sub(points[k] as Vec3, points[k - 1] as Vec3);
    const l = Math.hypot(d[0], d[1], d[2]);
    // A ring that has not left its loop has no direction of its own: it takes the root's normal.
    directions.push(l > 1e-9 ? scale(d, 1 / l) : (directions[k - 2] ?? root.normal));
    lengths.push(l);
  }
  const f = frames(directions, reference);
  const local = (p: Vec3, frame: Frame, at: Vec3): Vec3 => {
    const o = sub(p, at);
    return [dot(o, frame.a), dot(o, frame.u), dot(o, frame.t)];
  };
  const last = f[R] as Frame;
  return {
    root,
    directions,
    lengths,
    reference,
    rings: Array.from({ length: R }, (_, j) =>
      ring(j + 1).map((p) => local(p, f[j + 1] as Frame, points[j + 1] as Vec3)),
    ),
    line: ring(1),
    cap: shape.slice(0, capCount).map((p) => local(p, last, points[R] as Vec3)),
  };
}

/**
 * The form share `t` of the way from `a` to `b`, two forms of one root drawn from
 * the same reference (two sculpts of one organ, flaccid and erect): each segment's
 * direction turns along the great circle between the two, its length and every
 * offset in its frame move in a straight line. At 0 and 1 it is the sculpts
 * exactly; between them the centreline swings rather than cutting across, so the
 * organ does not shorten on the way.
 */
export function blendForms(a: Form, b: Form, t: number): Form {
  if (
    a.root !== b.root ||
    a.directions.length !== b.directions.length ||
    a.cap.length !== b.cap.length
  )
    throw new Error("blendForms: the forms are not of one root");
  if (t <= 0) return a;
  if (t >= 1) return b;
  const lerp = (p: Vec3, q: Vec3): Vec3 => [
    p[0] + (q[0] - p[0]) * t,
    p[1] + (q[1] - p[1]) * t,
    p[2] + (q[2] - p[2]) * t,
  ];
  return {
    root: a.root,
    reference: a.reference,
    directions: a.directions.map((d, k) => slerp(d, b.directions[k] as Vec3, t)),
    lengths: a.lengths.map((l, k) => l + ((b.lengths[k] as number) - l) * t),
    rings: a.rings.map((ring, j) => ring.map((o, i) => lerp(o, (b.rings[j] as Vec3[])[i] as Vec3))),
    line: a.line.map((p, i) => lerp(p, b.line[i] as Vec3)),
    cap: a.cap.map((o, i) => lerp(o, b.cap[i] as Vec3)),
  };
}

/** How a form is resized and posed. Every factor is 1 at the first ring and reaches its value over `blend`. */
export interface Pose {
  /** Arclength over which the pose fades in from the loop, metres. */
  blend: number;
  /** Factor on the segments' lengths. */
  length?: number;
  /** Factors on the offsets across (the reference's side) and up; an offset along takes `length`. */
  across?: number;
  up?: number;
  /**
   * The root follows a factor under 1: the factors across, up and along hold from the
   * first ring on, and the first ring (the skin line) draws in toward its centre over
   * the skin, the band from the loop to it widening as skin. Held at the loop's size,
   * a thin shaft rose from a flange the width of a full-sized one's root, and a short
   * one could not be drawn as short as its label, its root band never shortening. A
   * factor over 1 still fades in from the first ring, which cannot pass the loop.
   */
  rootFollows?: boolean;
}

/** The shape of a posed form. */
export function sweep(form: Form, pose: Pose): RootShape {
  const R = form.directions.length;
  const total = form.lengths.reduce((s, l) => s + l, 0);
  // The pose fades in from the first ring, the skin line the sculpt is attached at
  // (`transfer.ts`, `skinLine`), which stays on the skin with the loop.
  const start = form.lengths[0] as number;
  const fade = (s: number) => smooth(Math.max(0, s - start) / pose.blend);
  // The factors the root takes (`Pose.rootFollows`), and what fades in on top.
  const atRoot = (factor = 1) => (pose.rootFollows ? Math.min(1, factor) : 1);
  const ra = atRoot(pose.across);
  const ru = atRoot(pose.up);
  const rt = atRoot(pose.length);
  const lengths: number[] = [];
  let s = 0;
  for (let k = 0; k < R; k++) {
    const l = form.lengths[k] as number;
    // The first segment runs from the loop's centre to the skin line, over the skin.
    lengths.push(k === 0 ? l : l * (rt + ((pose.length ?? 1) - rt) * fade(s + l / 2)));
    s += l;
  }
  const f = frames(form.directions, form.reference);
  const c = centres(form.root, form.directions, lengths);
  // An offset across is scaled by the girth factors, one along by the length factor:
  // the form is stretched along its own centreline, the glans and the dome with it.
  const place = (o: Vec3, k: number, arc: number): Vec3 => {
    const w = fade(arc);
    const ka = ra + ((pose.across ?? 1) - ra) * w;
    const ku = ru + ((pose.up ?? 1) - ru) * w;
    const kt = rt + ((pose.length ?? 1) - rt) * w;
    const frame = f[k] as Frame;
    return add(
      c[k] as Vec3,
      add(add(scale(frame.a, o[0] * ka), scale(frame.u, o[1] * ku)), scale(frame.t, o[2] * kt)),
    );
  };
  const arcs: number[] = [0];
  form.lengths.forEach((l, k) => {
    arcs.push((arcs[k] as number) + l);
  });
  const out: Vec3[] = [];
  for (const o of form.cap) out.push(place(o, R, total));
  out.push(...(ra < 1 || ru < 1 ? drawnIn(form, f[1] as Frame, ra, ru) : form.line));
  form.rings.forEach((ring, j) => {
    if (j > 0) for (const o of ring) out.push(place(o, j + 1, arcs[j + 1] as number));
  });
  return out;
}

/**
 * The factor at which `measure`, increasing in it, reaches `want`: regula falsi
 * (Illinois) inside a bracket grown from `guess`, to a relative 1e-7. Sizing a
 * form is finding such factors, one measured quantity at a time.
 */
export function solveFactor(measure: (f: number) => number, want: number, guess: number): number {
  let lo = guess / 1.5;
  let hi = guess * 1.5;
  let flo = measure(lo) - want;
  let fhi = measure(hi) - want;
  for (let grow = 0; flo > 0 && grow < 40; grow++) {
    hi = lo;
    fhi = flo;
    lo /= 1.5;
    flo = measure(lo) - want;
  }
  for (let grow = 0; fhi < 0 && grow < 40; grow++) {
    lo = hi;
    flo = fhi;
    hi *= 1.5;
    fhi = measure(hi) - want;
  }
  if (flo > 0 || fhi < 0) throw new Error(`no factor reaches ${want}`);
  // Which end the last step replaced: -1 the low, 1 the high (Illinois halves the other's value).
  let side = 0;
  for (let it = 0; it < 60; it++) {
    const x = (lo * fhi - hi * flo) / (fhi - flo);
    const fx = measure(x) - want;
    if (Math.abs(fx) <= 1e-7 * Math.abs(want) || hi - lo < 1e-9 * hi) return x;
    if (fx < 0) {
      lo = x;
      flo = fx;
      if (side === -1) fhi /= 2;
      side = -1;
    } else {
      hi = x;
      fhi = fx;
      if (side === 1) flo /= 2;
      side = 1;
    }
  }
  return (lo + hi) / 2;
}

/**
 * A form's skin line drawn in toward its centre by `across` and `up` in the first
 * ring's frame, and put back on the skin the cap covers at rest.
 */
function drawnIn(form: Form, frame: Frame, across: number, up: number): Vec3[] {
  const n = form.line.length;
  const m = form.line.reduce<Vec3>(
    (s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n],
    [0, 0, 0],
  );
  const skin = capSurface(form.root);
  return form.line.map((p) => {
    const o = sub(p, m);
    const q = add(
      m,
      add(
        add(scale(frame.a, dot(o, frame.a) * across), scale(frame.u, dot(o, frame.u) * up)),
        scale(frame.t, dot(o, frame.t)),
      ),
    );
    return nearestOnSurface(skin, q, form.root.normal).point;
  });
}

/** The centreline of a posed form: the loop's centre, then each ring's centroid. */
export function posedCentres(form: Form, shape: RootShape): Vec3[] {
  const n = form.root.loop.length;
  const capCount = form.root.cap.length;
  const out: Vec3[] = [form.root.centre];
  for (let k = 1; k <= form.rings.length; k++) {
    const r = shape.slice(capCount + (k - 1) * n, capCount + k * n);
    out.push(
      r.reduce<Vec3>((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]),
    );
  }
  return out;
}

/**
 * The length round a shape's wall where a plane cuts it: the plane through `point`
 * across `normal`, over the strips between rings `from` and `to` (0 is the loop),
 * counting only what lies within `reach` of the point, so the wall elsewhere is not
 * counted where it crosses the same plane.
 */
export function sectionPerimeter(
  root: ReservoirRoot,
  shape: RootShape,
  point: Vec3,
  normal: Vec3,
  from: number,
  to: number,
  reach: number,
): number {
  const n = root.loop.length;
  const vertex = (k: number, i: number): Vec3 =>
    k === 0 ? (root.loop[i] as Vec3) : (shape[root.cap.length + (k - 1) * n + i] as Vec3);
  const side = (p: Vec3) => dot(sub(p, point), normal);
  let sum = 0;
  const cutTriangle = (a: Vec3, b: Vec3, c: Vec3) => {
    const ends: Vec3[] = [];
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const sp = side(p);
      const sq = side(q);
      if (sp < 0 === sq < 0) continue;
      const t = sp / (sp - sq);
      ends.push(add(p, scale(sub(q, p), t)));
    }
    if (ends.length !== 2) return;
    const [e0, e1] = ends as [Vec3, Vec3];
    const mid = scale(add(e0, e1), 0.5);
    if (Math.hypot(...sub(mid, point)) > reach) return;
    sum += Math.hypot(...sub(e1, e0));
  };
  for (let k = Math.max(0, from); k < Math.min(root.rings, to); k++)
    for (let i = 0; i < n; i++) {
      const a = vertex(k, i);
      const b = vertex(k, (i + 1) % n);
      const c = vertex(k + 1, (i + 1) % n);
      const d = vertex(k + 1, i);
      cutTriangle(a, b, c);
      cutTriangle(a, c, d);
    }
  return sum;
}

/** The perimeter of ring k (1-based) of a shape. */
export function ringPerimeter(root: ReservoirRoot, shape: RootShape, k: number): number {
  const n = root.loop.length;
  const base = root.cap.length + (k - 1) * n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = shape[base + i] as Vec3;
    const b = shape[base + ((i + 1) % n)] as Vec3;
    sum += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return sum;
}
