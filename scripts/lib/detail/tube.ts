/**
 * A tube drawn out of a reservoir (`src/build/reservoir.ts`): the rings leave the
 * loop on the skin, the centreline turns from the skin's normal toward a
 * direction, the section narrows or widens from the loop's own to the one asked
 * for, and the cap closes the end as a dome. The phallic organ and the scrotal
 * lobes are tubes with different sections and lengths (`phallus.ts`,
 * `scrotum.ts`); nothing here knows which.
 *
 * Rings are at equal steps of arclength, one per ring the reservoir has, the
 * last at the tip. The cap's interior vertices map by their polar place in the
 * loop onto the dome over the tip ring, so the cap stays a continuous quad mesh.
 */
import type { Vec3 } from "./disc.ts";
import type { ReservoirRoot, RootShape } from "./root.ts";

/** Smootherstep, 0 to 1 over 0 to 1 and clamped outside. */
export const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Half-widths of a section: across the root's first axis and along its second. */
export interface TubeSection {
  across: number;
  up: number;
}

export interface TubeSpec {
  /** Centreline length from the root's centre to the tip ring. */
  axial: number;
  /** Unit tangent at the tip. */
  direction: Vec3;
  /** Arclength over which the tangent turns from the normal to `direction`. */
  bend: number;
  /** Arclength over which the loop's own section becomes the asked one. */
  flare: number;
  /** The section asked for at an arclength. */
  section: (s: number) => TubeSection;
  /** The tip ring's section, which the dome closes. */
  tip: TubeSection;
  /** The dome's height over the tip ring. */
  dome: number;
}

export interface TubeBuild {
  /** The cap's vertices, then each ring's (`RootShape`). */
  shape: RootShape;
  rings: Vec3[][];
  apex: Vec3;
  /** Loop index of the vertex on the "up" side, where a dorsal line runs. */
  top: number;
}

const STEPS = 400;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));

/** `v` turned by `angle` about the unit `axis` (Rodrigues). */
const turn = (v: Vec3, axis: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
};

/** The radius of an ellipse of semi-axes (across, up) at a polar angle. */
export const ellipseRadius = (angle: number, a: number, b: number): number =>
  (a * b) / Math.hypot(b * Math.cos(angle), a * Math.sin(angle));

/** The angle between the root's normal and a direction, radians. */
export const turnAngle = (root: ReservoirRoot, direction: Vec3): number =>
  Math.acos(Math.min(1, Math.max(-1, dot(root.normal, norm(direction)))));

export function tubeShape(root: ReservoirRoot, spec: TubeSpec): TubeBuild {
  const n = norm(root.normal);
  const d = norm(spec.direction);
  // The loop's plane: its first axis is world x seen from the normal (or z where they align).
  const along: Vec3 = Math.abs(n[0]) < 0.95 ? [1, 0, 0] : [0, 0, 1];
  const b1 = norm(sub(along, scale(n, dot(along, n))));
  const b2 = cross(n, b1);
  const polar = (q: Vec3) => {
    const o = sub(q, root.centre);
    const across = dot(o, b1);
    const up = dot(o, b2);
    return { radius: Math.hypot(across, up), angle: Math.atan2(up, across), up };
  };
  const loop = root.loop.map(polar);
  const top = loop.reduce((best, l, i) => (l.up > (loop[best] as { up: number }).up ? i : best), 0);
  const byAngle = loop
    .map((l) => ({ angle: l.angle, radius: l.radius }))
    .sort((a, b) => a.angle - b.angle);
  const loopRadiusAt = (angle: number) => {
    const m = byAngle.length;
    let hi = byAngle.findIndex((l) => l.angle >= angle);
    if (hi < 0) hi = 0;
    const lo = (hi + m - 1) % m;
    const a = byAngle[lo] as { angle: number; radius: number };
    const b = byAngle[hi] as { angle: number; radius: number };
    let span = b.angle - a.angle;
    let off = angle - a.angle;
    if (span <= 0) span += 2 * Math.PI;
    if (off < 0) off += 2 * Math.PI;
    return a.radius + (b.radius - a.radius) * (span > 0 ? Math.min(1, off / span) : 0);
  };

  // The tangent turns about the axis normal x direction by up to the angle between them.
  const delta = turnAngle(root, d);
  const axisRaw = cross(n, d);
  const axis: Vec3 = Math.hypot(...axisRaw) > 1e-9 ? norm(axisRaw) : [1, 0, 0];
  const theta = (s: number) => delta * smooth(s / spec.bend);
  const ds = spec.axial / STEPS;
  const path = new Float64Array((STEPS + 1) * 3);
  for (let k = 1; k <= STEPS; k++) {
    const t = turn(n, axis, theta((k - 0.5) * ds));
    for (let c = 0; c < 3; c++)
      path[k * 3 + c] = (path[(k - 1) * 3 + c] as number) + (t[c] as number) * ds;
  }
  const centreAt = (s: number): Vec3 => {
    const f = Math.min(STEPS, Math.max(0, s / ds));
    const k = Math.min(STEPS - 1, Math.floor(f));
    const t = f - k;
    return [0, 1, 2].map(
      (c) =>
        (root.centre[c] as number) +
        (path[k * 3 + c] as number) * (1 - t) +
        (path[(k + 1) * 3 + c] as number) * t,
    ) as unknown as Vec3;
  };
  const at = (centre: Vec3, angle: number, across: number, up: number, a: number): Vec3 => {
    const e1 = turn(b1, axis, a);
    const e2 = turn(b2, axis, a);
    return add(centre, add(scale(e1, across * Math.cos(angle)), scale(e2, up * Math.sin(angle))));
  };

  const flare = spec.flare;
  const rings = Array.from({ length: root.rings }, (_, k) => {
    const s = (spec.axial * (k + 1)) / root.rings;
    const centre = centreAt(s);
    const a = theta(s);
    const w = smooth(s / flare);
    const want = spec.section(s);
    return loop.map((l) => {
      const r = l.radius + (ellipseRadius(l.angle, want.across, want.up) - l.radius) * w;
      return at(centre, l.angle, r, r, a);
    });
  });
  const tip = centreAt(spec.axial);
  const aEnd = theta(spec.axial);
  const tangent = turn(n, axis, aEnd);
  const cap = root.cap.map(({ position }) => {
    const q = polar(position);
    const sigma = Math.min(1, q.radius / loopRadiusAt(q.angle));
    const r = sigma * ellipseRadius(q.angle, spec.tip.across, spec.tip.up);
    const base = at(tip, q.angle, r, r, aEnd);
    return add(base, scale(tangent, spec.dome * Math.sqrt(1 - sigma * sigma)));
  });
  const apex = add(tip, scale(tangent, spec.dome));
  return { shape: [...cap, ...rings.flat()], rings, apex, top };
}
