/**
 * The authored styles: where each one's ropes leave the scalp and what they are like. Positions
 * are given as a hair stylist gives them, in angles round the head (`HeadFrame`), and a hairline
 * that follows a real one: lower at the front's middle, receding at the temples, up over the ear
 * and down again at the nape.
 */

import { Vector3 } from "three";
import { METRES_PER_V, random, TILE_COUNT, tileRange } from "./atlas.ts";
import type { BodySurface, HeadFrame, ScalpPoint } from "./head.ts";
import { addRope, addTube, type Cards, newCards } from "./ropes.ts";

const DEG = Math.PI / 180;

/** Elevation (degrees) of the hairline at an azimuth (degrees from the front, either side). */
export function hairlineElevation(azimuth: number): number {
  const stops: [number, number][] = [
    [0, 22],
    [20, 16],
    [40, 6],
    [60, 8],
    [80, 14],
    [100, 10],
    [125, -8],
    [155, -30],
    [180, -38],
  ];
  const a = Math.min(180, Math.abs(azimuth));
  for (let i = 1; i < stops.length; i++) {
    const [a1, e1] = stops[i] as [number, number];
    const [a0, e0] = stops[i - 1] as [number, number];
    if (a <= a1) return e0 + ((e1 - e0) * (a - a0)) / (a1 - a0);
  }
  return -38;
}

export interface StyleContext {
  head: HeadFrame;
  body: BodySurface;
}

/**
 * One tile per rope in turn, so neighbouring ropes do not wear the same pattern, starting a little
 * way down it (up to 0.3 of V) as far as a rope of `length` metres leaves room for: it must still end
 * inside the atlas, with 3% to spare for the stretch settling leaves.
 */
const tileOf = (index: number, metresPerV = METRES_PER_V, length = 0) => {
  const { u0, u1 } = tileRange(index % TILE_COUNT);
  const room = Math.min(0.3, Math.max(0, 1 - (1.03 * length) / metresPerV));
  return { u0, u1, metresPerV, v0: ((index * 0.37) % 1) * room };
};

/** The scalp where a plane `x` = constant meets it, from `fromE` to `toE` (radians) over the top: one parting, front to back. */
function partingAlong(
  head: HeadFrame,
  x: number,
  fromE: number,
  toE: number,
  steps: number,
): ScalpPoint[] {
  const points: ScalpPoint[] = [];
  const radius = (head.extent.max.x - head.extent.min.x) / 2;
  for (let i = 0; i <= steps; i++) {
    // Over the top from the front: a pitch from the horizontal at the front, through 90 at the crown, to the nape.
    const pitch = fromE + ((toE - fromE) * i) / steps;
    let dx = x / radius;
    let hit: ScalpPoint | null = null;
    // The ray's sideways lean is corrected until the hit lies on the plane.
    for (let iteration = 0; iteration < 5; iteration++) {
      const dir = new Vector3(dx, Math.sin(pitch), Math.cos(pitch)).normalize();
      const azimuth = Math.atan2(dir.x, dir.z);
      const elevation = Math.asin(dir.y);
      hit = head.surface(azimuth, elevation);
      if (!hit) break;
      const offset = hit.point.x - head.centre.x;
      if (Math.abs(offset) < 1e-4) break;
      dx *= x / (offset || 1e-6);
    }
    if (hit) points.push(hit);
  }
  return points;
}

/**
 * Cornrows: plaits that lie on the scalp, front to back in parallel lines from the hairline over the
 * crown to the nape, then hang as a braid below it. The partings between them are bare scalp.
 */
export function cornrows({ head, body }: StyleContext): Cards {
  const cards = newCards();
  const rand = random(23);
  const radius = 0.0052;
  let index = 0;
  const rows = Array.from({ length: 13 }, (_, i) => (i - 6) * 0.0135);
  for (const x of rows) {
    const az = Math.asin(Math.min(1, Math.abs(x) / 0.1)) * Math.sign(x);
    const front = hairlineElevation(az / DEG) * DEG;
    // From the hairline up over the crown and down to the nape, in pitch from the horizontal.
    const line = partingAlong(head, x, front + 0.04, Math.PI + 0.3, 80).filter(
      (p, i, all) => i === 0 || p.point.distanceTo((all[i - 1] as ScalpPoint).point) > 1e-5,
    );
    if (line.length < 8) continue;
    // Lie on the scalp: centre a little out of it so the plait stands from it by most of its radius.
    const lay = line.map((p) => p.point.clone().addScaledVector(p.normal, radius * 0.7));
    const tile = tileOf(index++);
    addTube(
      cards,
      lay,
      lay.map(() => radius),
      5,
      tile,
      (line[0] as ScalpPoint).normal,
    );
    // The tail: the row's end hangs as a braid.
    const end = line[line.length - 1] as ScalpPoint;
    const before = line[line.length - 3] as ScalpPoint;
    const along = new Vector3().subVectors(end.point, before.point).normalize();
    addRope(
      cards,
      {
        root: { point: end.point.clone().addScaledVector(end.normal, radius * 0.7), normal: along },
        hang: { kind: "marched", lift: 0.02 },
        length: 0.2 + 0.04 * rand(),
        radius,
        tipRadius: 0.0032,
        sides: 5,
        segments: 10,
        tile,
      },
      body,
    );
  }
  return cards;
}

/**
 * Roots on a grid over the whole scalp above the hairline, `spacing` apart, brick-wise as sections
 * are parted, at least `margin` degrees above it. Over the crown the rows of a ring would crowd into
 * a point, so there a flat grid, read from above and projected onto the scalp, takes over.
 */
export function gridRoots(
  head: HeadFrame,
  spacing: number,
  margin = 3,
): { root: ScalpPoint; azimuth: number }[] {
  const roots: { root: ScalpPoint; azimuth: number }[] = [];
  const radiusOfHead = (head.extent.max.x - head.extent.min.x) / 2;
  const rowStep = spacing / radiusOfHead;
  const crownFrom = 62 * DEG;
  for (let e = crownFrom - rowStep / 2; e > -36 * DEG; e -= rowStep) {
    const ring = 2 * Math.PI * Math.cos(e) * radiusOfHead;
    const count = Math.max(1, Math.round(ring / spacing));
    for (let n = 0; n < count; n++) {
      const a =
        ((n + 0.5 * (Math.round((crownFrom - e) / rowStep) % 2)) / count) * 2 * Math.PI - Math.PI;
      if (e / DEG < hairlineElevation(a / DEG) + margin) continue;
      const root = head.surface(a, e);
      if (root) roots.push({ root, azimuth: a });
    }
  }
  const reach = radiusOfHead * Math.cos(crownFrom);
  for (let row = 0, z = -reach; z <= reach; z += spacing * 0.9, row++)
    for (let x = -reach + (row % 2) * spacing * 0.5; x <= reach; x += spacing) {
      if (Math.hypot(x, z) > reach) continue;
      const direction = new Vector3(x, radiusOfHead, z).normalize();
      const azimuth = Math.atan2(direction.x, direction.z);
      const root = head.surface(azimuth, Math.asin(direction.y));
      if (root) roots.push({ root, azimuth });
    }
  return roots;
}

/**
 * A grid of ropes over the head, brick-wise as sections are parted, each combed along the scalp and
 * settled (`RopeHang` "combed"): the one thing twists, locs and box braids differ in is how thick,
 * long, stiff and numerous the ropes are.
 */
export interface RopeGridSpec {
  seed: number;
  /** Metres between partings. */
  spacing: number;
  length: number;
  radius: number;
  tipRadius: number;
  sides: number;
  segments: number;
  /** How far a rope strays from the straight hang, as drift (see `RopeSpec`). */
  stray: number;
  /** Radians off the scalp a rope leaves its root at. */
  rise: number;
  /** How much it resists bending as it settles. */
  stiffness: number;
}

function ropeGrid({ head, body }: StyleContext, rope: RopeGridSpec): Cards {
  const cards = newCards();
  const rand = random(rope.seed);
  let index = 0;
  for (const { root } of gridRoots(head, rope.spacing)) {
    const length = rope.length * (0.85 + 0.3 * rand());
    addRope(
      cards,
      {
        root,
        hang: { kind: "combed", rise: rope.rise, stiffness: rope.stiffness },
        length,
        radius: rope.radius,
        collar: 0.7,
        tipRadius: rope.tipRadius,
        sides: rope.sides,
        segments: rope.segments,
        drift: new Vector3(rope.stray * (rand() - 0.5), 0, rope.stray * (rand() - 0.5)),
        tile: tileOf(index++, METRES_PER_V, length),
      },
      body,
    );
  }
  return cards;
}

/** Two-strand twists: thinner, shorter and more of them than braids, springier. */
export const TWISTS: RopeGridSpec = {
  seed: 31,
  spacing: 0.017,
  length: 0.17,
  radius: 0.0048,
  tipRadius: 0.0028,
  sides: 5,
  segments: 12,
  stray: 0.35,
  rise: 0.35,
  stiffness: 0.25,
};
export const twists = (context: StyleContext): Cards => ropeGrid(context, TWISTS);

/** Locs: thick matted ropes, long, falling heavily; 40 to 80 of them on a head. */
export const LOCS: RopeGridSpec = {
  seed: 41,
  spacing: 0.027,
  length: 0.36,
  radius: 0.0088,
  tipRadius: 0.0055,
  sides: 6,
  segments: 18,
  stray: 0.2,
  rise: 0.25,
  stiffness: 0.15,
};
export const locs = (context: StyleContext): Cards => ropeGrid(context, LOCS);

/**
 * Box braids: plaits from the roots all the way down, one from each section of a grid of partings
 * over the head (100 to 200 of them), shoulder-blade length, lying over the shoulders and the back.
 */
export const BOX_BRAIDS: RopeGridSpec = {
  seed: 11,
  spacing: 0.018,
  length: 0.3,
  radius: 0.0072,
  tipRadius: 0.0035,
  sides: 5,
  segments: 14,
  stray: 0.1,
  rise: 0.3,
  stiffness: 0.3,
};
export const boxBraids = (context: StyleContext): Cards => ropeGrid(context, BOX_BRAIDS);

/**
 * Bantu knots: the head parted into square sections, each section's hair twisted into a rope and
 * wound round its own root into a raised bun. `spacing` is the sections' size; `rope` the twisted
 * rope's radius; `base` the radius of the bun's bottom coil (to the rope's centre); `turns` how many
 * times it winds (varied by `vary` either way per knot), each turn sitting `pitch` rope radii above
 * the last and a little inside it (`taper` of the base over the whole bun), so the coil stacks into
 * a cone 2.5 to 3.5 cm tall; the rope's end tucks into the top.
 */
export const BANTU_KNOT = {
  spacing: 0.045,
  rope: 0.0045,
  base: 0.011,
  turns: 3,
  vary: 0.3,
  pitch: 1.7,
  taper: 0.75,
  pointsPerTurn: 16,
  sides: 6,
} as const;

export function bantuKnots({ head }: StyleContext): Cards {
  const cards = newCards();
  const rand = random(53);
  const { spacing, rope, base, turns, vary, pitch, taper, pointsPerTurn, sides } = BANTU_KNOT;
  // A knot's bottom coil reaches its base plus the rope round the root: the whole of it sits behind
  // the hairline, so its root is that far (as an angle over the head) and three degrees more above it.
  const radiusOfHead = (head.extent.max.x - head.extent.min.x) / 2;
  const margin = (base * 1.1 + rope) / radiusOfHead / DEG + 3;
  let index = 0;
  for (const { root } of gridRoots(head, spacing, margin)) {
    // The knot's axis is the scalp's normal at its root; two directions across the scalp there.
    const axis = root.normal;
    const up = Math.abs(axis.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const u = new Vector3().crossVectors(axis, up).normalize();
    const v = new Vector3().crossVectors(axis, u).normalize();
    const start = rand() * Math.PI * 2;
    const direction = rand() < 0.5 ? 1 : -1;
    const knotTurns = turns + vary * (2 * rand() - 1);
    const knotBase = base * (0.9 + 0.2 * rand());
    const at = (angle: number, r: number, h: number) =>
      root.point
        .clone()
        .addScaledVector(u, r * Math.cos(start + direction * angle))
        .addScaledVector(v, r * Math.sin(start + direction * angle))
        .addScaledVector(axis, h);
    const points: Vector3[] = [];
    const radii: number[] = [];
    // Out of the scalp at the root (sunk 2 mm, as every rope's first ring) and out to the bottom coil
    // over a quarter turn, lying on the scalp.
    const out = Math.round(pointsPerTurn / 4);
    for (let i = 0; i < out; i++) {
      const s = i / out;
      points.push(at((s * Math.PI) / 2, knotBase * s, -0.002 + (rope + 0.002) * s));
      radii.push(rope * (0.8 + 0.2 * s));
    }
    // The coil: up by `pitch` rope radii a turn, in toward the axis as it rises.
    const count = Math.round(knotTurns * pointsPerTurn);
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const angle = Math.PI / 2 + knotTurns * 2 * Math.PI * t;
      points.push(at(angle, knotBase * (1 - taper * t), rope + pitch * rope * knotTurns * t));
      radii.push(rope * (1 - 0.15 * t));
    }
    // The end tucks into the top of the bun.
    const top = rope + pitch * rope * knotTurns;
    const last = Math.PI / 2 + knotTurns * 2 * Math.PI;
    for (let i = 1; i <= 3; i++) {
      const s = i / 3;
      points.push(
        at(last + (s * Math.PI) / 2, knotBase * (1 - taper) * (1 - s), top + 0.3 * rope * s),
      );
      radii.push(rope * 0.85 * (1 - 0.4 * s));
    }
    addTube(cards, points, radii, sides, tileOf(index++, METRES_PER_V), axis);
  }
  return cards;
}
