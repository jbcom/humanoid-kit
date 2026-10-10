/**
 * Ropes of hair as card geometry: a tube of quads along a centreline that leaves the scalp, lifts
 * a little, then falls under gravity and lies over whatever it meets (the head, the neck, a
 * shoulder). Braids, twists, locs and cornrows are all this shape with a different radius, length,
 * stiffness and texture: the plait, the twist, the loc is the strand map, which a tube carries
 * round it the way a real braid's strands carry round the plait.
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

export interface RopeSpec {
  /** Where the rope leaves the scalp. */
  root: ScalpPoint;
  /** Metres of rope, from the scalp to the tip. */
  length: number;
  /** Radius at the root and at the tip, metres. */
  radius: number;
  tipRadius: number;
  /** Metres along which the rope keeps going out along the scalp normal before gravity takes it. */
  lift: number;
  /** A steer (world axes, in units of gravity) that fades out over the rope's first nine centimetres: a braid swept clear of the face. */
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
/** Metres of rope over which its drift acts before gravity alone decides. */
const DRIFT_LENGTH = 0.09;
/** How far a rope's centre stays from the body, in rope radii. */
const CLEARANCE = 1.15;

/** The centreline of a rope: `segments + 1` points, with the radius at each. */
export function ropePath(
  spec: RopeSpec,
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
    const out = Math.max(0, 1 - s / Math.max(spec.lift, 1e-6)) ** 2;
    const want = new Vector3()
      .addScaledVector(root.normal, out)
      .addScaledVector(GRAVITY, 1 - out)
      // A drift steers the rope clear of something (the face) near its root, then lets it hang.
      .addScaledVector(spec.drift ?? new Vector3(), (1 - out) * Math.max(0, 1 - s / DRIFT_LENGTH))
      .normalize();
    dir.lerp(want, 0.55).normalize();
    const p = (points[i - 1] as Vector3).clone().addScaledVector(dir, step);
    // Lie over the body instead of through it.
    const probe = body.probe(p);
    const clear = radius * CLEARANCE;
    if (probe.distance < clear) p.addScaledVector(probe.normal, clear - probe.distance);
    dir.subVectors(p, points[i - 1] as Vector3).normalize();
    points.push(p);
    radii.push(radius);
  }
  return { points, radii };
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
