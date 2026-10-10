/**
 * Ropes of hair as card geometry: a tube of quads along a centreline that leaves the scalp, lies
 * along it the way hair is combed, then falls under gravity and comes to rest over whatever it
 * meets (the neck, a shoulder, the back). Braids, twists, locs and cornrows are all this shape with
 * a different radius, length, stiffness and texture: the plait, the twist, the loc is the strand
 * map, which a tube carries round it the way a real braid's strands carry round the plait.
 *
 * The geometry is authored here from nothing: no mesh of anyone's is read.
 */
import { Vector3 } from "three";
import type { BodySurface, ScalpPoint } from "./head.ts";

/** Geometry accumulated over a style's ropes, in the arrays a compiled asset holds. */
export interface Cards {
  positions: number[];
  /** Four corners per quad, indices into `positions` (vertex = three numbers). */
  faceVerts: number[];
  /** Four per quad, indices into `uvs` (UV = two numbers). */
  faceUvs: number[];
  uvs: number[];
  /** The vertices the hair grows from: the first ring of every rope. Growth is measured from them. */
  roots: number[];
}

export const newCards = (): Cards => ({
  positions: [],
  faceVerts: [],
  faceUvs: [],
  uvs: [],
  roots: [],
});

/**
 * How a rope finds its shape.
 *
 * - `marched`: out along the root's normal for `lift` metres, then turning down under gravity a
 *   segment at a time, lying over the body where it meets it (a cornrow's tail, which leaves the
 *   row's end along the row).
 * - `combed`: leaves its root `rise` radians off the scalp and lies along it the way hair is combed
 *   (`combAlong`) until the scalp turns under, then hangs and settles under gravity (`relaxRope`),
 *   resisting bending by `stiffness` (0..1, the share of a bend straightened each pass: a twist is
 *   springy, a loc heavy). The ropes of each row lie over the roots of the row behind them, so a
 *   grid of partings is covered instead of fanning into a bare starburst at the crown.
 */
export type RopeHang =
  | { kind: "marched"; lift: number }
  | { kind: "combed"; rise: number; stiffness: number };

export interface RopeSpec {
  /** Where the rope leaves the scalp. */
  root: ScalpPoint;
  hang: RopeHang;
  /** Metres of rope, from the scalp to the tip. */
  length: number;
  /** Radius at the root and at the tip, metres. */
  radius: number;
  tipRadius: number;
  /**
   * A steer (world axes, in units of gravity) over the first nine centimetres of the rope that
   * hangs free: a little variety in how ropes fall.
   */
  drift?: Vector3;
  /** How much wider than `radius` the rope is at its root (a fraction), narrowing to it over three centimetres. */
  collar?: number;
  /** Sides of the tube, and rings along it. */
  sides: number;
  segments: number;
  /** The strand map's tile this rope reads: its U range and the metres of rope per unit of V. */
  tile: { u0: number; u1: number; metresPerV: number; v0?: number };
}

const GRAVITY = new Vector3(0, -1, 0);
const BACK = new Vector3(0, 0, -1);
/** Metres of free-hanging rope over which its drift acts before gravity alone decides. */
const DRIFT_LENGTH = 0.09;
/** How far a rope's centre stays from the body, in rope radii. */
const CLEARANCE = 1.15;
/** Metres of a combed rope's first segment, which leaves the root at its rise. */
const ROOT_SEGMENT = 0.006;
/**
 * A combed rope lies along the scalp while the way it is combed there runs down no steeper than
 * this (its direction's dot with gravity): where the scalp turns vertical (the side of the head
 * above the ear, the back) it hangs from there, rather than being held onto the ear or under the
 * occiput.
 */
const LIES_UNTIL_STEEP = 0.85;
/** How far beyond its clearance (metres) a combed rope may be from the scalp and still be lying on it. */
const LIES_WITHIN = 0.006;

/**
 * The settling of a combed rope's hanging part (`relaxRope`): passes, each moving the free points
 * down by `fall` of a segment and then satisfying the rope's length and the body `projections` times;
 * `friction` is the share of its slide along the body a point in contact loses each pass, so hair
 * stays on a shoulder or the back rather than sliding off it to hang plumb.
 */
export const ROPE_SETTLE = { passes: 60, fall: 0.12, projections: 4, friction: 0.9 } as const;

/**
 * The way hair is combed over a scalp whose outward normal is `normal`: a unit vector along it.
 * Over the top and from the front hairline, toward the back (downhill there points every way out
 * from the crown, and ropes following it fan into a bare starburst); on the sides and the back,
 * downhill.
 */
export function combAlong(normal: Vector3): Vector3 {
  const down = GRAVITY.clone().addScaledVector(normal, -GRAVITY.dot(normal));
  const back = BACK.clone().addScaledVector(normal, -BACK.dot(normal));
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // The back's share: where the scalp faces up, or forward.
  const toBack = Math.max(smooth(0.25, 0.85, normal.y), smooth(0.1, 0.6, normal.z));
  const comb = new Vector3();
  if (down.lengthSq() > 1e-8) comb.addScaledVector(down.normalize(), 1 - toBack);
  if (back.lengthSq() > 1e-8) comb.addScaledVector(back.normalize(), toBack);
  if (comb.lengthSq() < 1e-8) comb.copy(back.lengthSq() > 1e-8 ? back : down);
  return comb.normalize();
}

/** The centreline of a rope: `segments + 1` points, with the radius at each. */
export function ropePath(
  spec: RopeSpec,
  body: BodySurface,
): { points: Vector3[]; radii: number[] } {
  if (spec.hang.kind === "marched") return marchRope(spec, spec.hang.lift, body);
  const combed = combRope(spec, spec.hang.rise, body);
  relaxRope(combed.points, combed.radii, combed.lying, spec, spec.hang.stiffness, body);
  return combed;
}

/**
 * A marched rope: out along the root's normal for `lift` metres, turning toward gravity a little
 * each segment and lying over the body where it meets it.
 */
function marchRope(
  spec: RopeSpec,
  lift: number,
  body: BodySurface,
): { points: Vector3[]; radii: number[] } {
  const { root, length, segments } = spec;
  const step = length / segments;
  const points: Vector3[] = [root.point.clone().addScaledVector(root.normal, -0.002)];
  const radii: number[] = [spec.radius];
  const dir = root.normal.clone();
  for (let i = 1; i <= segments; i++) {
    const s = i * step;
    const radius = ropeRadius(spec, s / length);
    // Out along the normal at the root, down by the end of the lift: smoothly, so the rope bends.
    const out = Math.max(0, 1 - s / Math.max(lift, 1e-6)) ** 2;
    const want = new Vector3()
      .addScaledVector(root.normal, out)
      .addScaledVector(GRAVITY, 1 - out)
      .addScaledVector(spec.drift ?? new Vector3(), (1 - out) * Math.max(0, 1 - s / DRIFT_LENGTH))
      .normalize();
    dir.lerp(want, 0.55).normalize();
    points.push(
      lieOver(body, (points[i - 1] as Vector3).clone().addScaledVector(dir, step), radius),
    );
    dir.subVectors(points[i] as Vector3, points[i - 1] as Vector3).normalize();
    radii.push(radius);
  }
  return { points, radii };
}

/** `p`, moved out of the body to `radius * CLEARANCE` from it where it is nearer. */
function lieOver(body: BodySurface, p: Vector3, radius: number): Vector3 {
  const probe = body.probe(p);
  const clear = radius * CLEARANCE;
  if (probe.distance < clear) p.addScaledVector(probe.normal, clear - probe.distance);
  return p;
}

/**
 * A combed rope before it settles: a short first segment off the root at `rise`, then along the
 * scalp the way it is combed (`combAlong`), held at its clearance, for as long as the scalp under it
 * faces up and stays near; from there it falls straight down. `lying` is how many of its points
 * lie on the scalp (they stay where they are when it settles).
 */
function combRope(
  spec: RopeSpec,
  rise: number,
  body: BodySurface,
): { points: Vector3[]; radii: number[]; lying: number } {
  const { root, length, segments } = spec;
  const first = Math.min(ROOT_SEGMENT, length / segments);
  const step = (length - first) / (segments - 1);
  const points: Vector3[] = [root.point.clone().addScaledVector(root.normal, -0.002)];
  const radii: number[] = [spec.radius];
  const leave = combAlong(root.normal)
    .multiplyScalar(Math.cos(rise))
    .addScaledVector(root.normal, Math.sin(rise))
    .normalize();
  let lying = 1;
  let onScalp = true;
  let free = 0;
  let s = 0;
  const dir = leave.clone();
  for (let i = 1; i <= segments; i++) {
    const segment = i === 1 ? first : step;
    s += segment;
    const radius = ropeRadius(spec, s / length);
    const prev = points[i - 1] as Vector3;
    let p: Vector3;
    if (i === 1) p = prev.clone().addScaledVector(leave, segment);
    else {
      const under = body.probe(prev);
      const comb = combAlong(under.normal);
      onScalp &&=
        comb.dot(GRAVITY) <= LIES_UNTIL_STEEP && under.distance < radius * CLEARANCE + LIES_WITHIN;
      if (onScalp) {
        dir.lerp(comb, 0.7).normalize();
        p = prev.clone().addScaledVector(dir, segment);
        // Held at its clearance from the scalp, pulled in as well as pushed out, and still a
        // segment long (the rope does not stretch to wrap the head).
        const at = body.probe(p);
        p.addScaledVector(at.normal, radius * CLEARANCE - at.distance);
        p.sub(prev).setLength(segment).add(prev);
        lying = i + 1;
      } else {
        free += segment;
        const want = GRAVITY.clone()
          .addScaledVector(spec.drift ?? new Vector3(), Math.max(0, 1 - free / DRIFT_LENGTH))
          .normalize();
        dir.lerp(want, 0.55).normalize();
        p = lieOver(body, prev.clone().addScaledVector(dir, segment), radius);
      }
    }
    dir.subVectors(p, prev).normalize();
    points.push(p);
    radii.push(radius);
  }
  return { points, radii, lying };
}

/**
 * Settles a rope's hanging part under gravity, in place (position-based: no velocities, so it comes
 * to rest). The first `fixed` points (the root and the part lying on the scalp) stay; every pass
 * moves the rest down, straightens a `stiffness` share of each bend, keeps each segment its length
 * and lies each point over the body, losing `ROPE_SETTLE.friction` of its slide where it touches. A
 * rope from the side of the head comes to rest over the shoulder, one from the back down the back.
 */
export function relaxRope(
  points: Vector3[],
  radii: readonly number[],
  fixedCount: number,
  spec: RopeSpec,
  stiffness: number,
  body: BodySurface,
): void {
  const fixed = Math.max(2, Math.min(points.length, fixedCount));
  if (fixed >= points.length) return;
  const lengths = points.map((p, i) => (i === 0 ? 0 : p.distanceTo(points[i - 1] as Vector3)));
  const step = spec.length / spec.segments;
  const before = points.map((p) => p.clone());
  const drift = spec.drift ?? new Vector3();
  const target = new Vector3();
  const toward = new Vector3();
  for (let pass = 0; pass < ROPE_SETTLE.passes; pass++) {
    for (let i = fixed; i < points.length; i++) {
      (before[i] as Vector3).copy(points[i] as Vector3);
      const free = (i - fixed + 1) * step;
      (points[i] as Vector3)
        .addScaledVector(GRAVITY, ROPE_SETTLE.fall * step)
        .addScaledVector(drift, ROPE_SETTLE.fall * step * Math.max(0, 1 - free / DRIFT_LENGTH));
    }
    // Stiffness, once a pass: each point a share of the way back onto the line of the two before it.
    for (let i = fixed; i < points.length; i++) {
      const a = points[i - 2] as Vector3;
      const b = points[i - 1] as Vector3;
      target
        .subVectors(b, a)
        .normalize()
        .multiplyScalar(lengths[i] as number)
        .add(b);
      (points[i] as Vector3).lerp(target, stiffness);
    }
    for (let k = 0; k < ROPE_SETTLE.projections; k++) {
      // Each segment its length, from the root out (follow the leader: a rope does not stretch).
      for (let i = fixed; i < points.length; i++) {
        const a = points[i - 1] as Vector3;
        (points[i] as Vector3)
          .sub(a)
          .setLength(lengths[i] as number)
          .add(a);
      }
      for (let i = fixed; i < points.length; i++)
        lieOver(body, points[i] as Vector3, radii[i] as number);
    }
    // Friction: of a touching point's move this pass, the part along the body is mostly lost.
    for (let i = fixed; i < points.length; i++) {
      const p = points[i] as Vector3;
      const probe = body.probe(p);
      if (probe.distance > (radii[i] as number) * CLEARANCE * 1.05) continue;
      const moved = toward.subVectors(p, before[i] as Vector3);
      const along = moved.addScaledVector(probe.normal, -moved.dot(probe.normal));
      p.addScaledVector(along, -ROPE_SETTLE.friction);
    }
  }
}

/**
 * Radius at a fraction of the length: full along most of it, rounding off to the tip, and wider at the
 * root where a rope gathers the section of hair that grows round it (a rope's `collar`, over its first
 * three centimetres).
 */
export function ropeRadius(spec: RopeSpec, t: number): number {
  const f = Math.min(1, Math.max(0, (t - 0.6) / 0.4));
  const taper = f * f * (3 - 2 * f);
  const metres = t * spec.length;
  const g = Math.min(1, Math.max(0, metres / 0.03));
  const collar = (spec.collar ?? 0) * (1 - g * g * (3 - 2 * g));
  return (spec.radius + (spec.tipRadius - spec.radius) * taper) * (1 + collar);
}

/** Adds a rope's tube to `cards` and returns the index of its first vertex. */
export function addRope(cards: Cards, spec: RopeSpec, body: BodySurface): number {
  const { points, radii } = ropePath(spec, body);
  return addTube(cards, points, radii, spec.sides, spec.tile, spec.root.normal);
}

/**
 * A tube of quads round a centreline, `sides` round and one ring per point, its radius at each
 * point `radii`. A frame is carried along the line so the tube does not twist on its own; its
 * first side is as near `hint` as it can be. UVs run round the tube across `tile`'s U range and
 * along it by distance, the rope's metres over `metresPerV`.
 */
export function addTube(
  cards: Cards,
  points: readonly Vector3[],
  radii: readonly number[],
  sides: number,
  tile: RopeSpec["tile"],
  hint: Vector3,
): number {
  const rings = points.length;
  const first = cards.positions.length / 3;
  const uvFirst = cards.uvs.length / 2;
  const tangent = (i: number) =>
    new Vector3()
      .subVectors(
        points[Math.min(rings - 1, i + 1)] as Vector3,
        points[Math.max(0, i - 1)] as Vector3,
      )
      .normalize();
  let t = tangent(0);
  const side = perpendicular(t, hint);
  let along = 0;
  for (let i = 0; i < rings; i++) {
    const nextT = tangent(i);
    if (i > 0) {
      // Rotate `side` by the turn from the previous tangent to this one.
      const axis = new Vector3().crossVectors(t, nextT);
      const sin = axis.length();
      if (sin > 1e-9) side.applyAxisAngle(axis.normalize(), Math.asin(Math.min(1, sin)));
      side.addScaledVector(nextT, -side.dot(nextT)).normalize();
      along += (points[i] as Vector3).distanceTo(points[i - 1] as Vector3);
    }
    t = nextT;
    const up = new Vector3().crossVectors(t, side).normalize();
    const c = points[i] as Vector3;
    // The last ring closes the tip.
    const r = (radii[i] as number) * (i === rings - 1 ? 0.3 : 1);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      cards.positions.push(
        c.x + r * (Math.cos(a) * side.x + Math.sin(a) * up.x),
        c.y + r * (Math.cos(a) * side.y + Math.sin(a) * up.y),
        c.z + r * (Math.cos(a) * side.z + Math.sin(a) * up.z),
      );
    }
    for (let j = 0; j <= sides; j++)
      cards.uvs.push(
        tile.u0 + ((tile.u1 - tile.u0) * j) / sides,
        (tile.v0 ?? 0) + along / tile.metresPerV,
      );
  }
  for (let j = 0; j < sides; j++) cards.roots.push(first + j);
  for (let i = 0; i < rings - 1; i++)
    for (let j = 0; j < sides; j++) {
      const v = (ring: number, k: number) => first + ring * sides + (k % sides);
      const uv = (ring: number, k: number) => uvFirst + ring * (sides + 1) + k;
      cards.faceVerts.push(v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i + 1, j));
      cards.faceUvs.push(uv(i, j), uv(i, j + 1), uv(i + 1, j + 1), uv(i + 1, j));
    }
  return first;
}

/** A unit vector perpendicular to `t`, as near `hint` as it can be. */
function perpendicular(t: Vector3, hint: Vector3): Vector3 {
  const v = hint.clone().addScaledVector(t, -hint.dot(t));
  if (v.lengthSq() < 1e-8) v.set(1, 0, 0).addScaledVector(t, -t.x);
  return v.normalize();
}
