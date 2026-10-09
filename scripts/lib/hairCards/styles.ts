/**
 * The authored styles: where each one's ropes leave the scalp and what they are like. Positions
 * are given as a hair stylist gives them, in angles round the head (`HeadFrame`), and a hairline
 * that follows a real one: lower at the front's middle, receding at the temples, up over the ear
 * and down again at the nape.
 */

import { Vector3 } from "three";
import { METRES_PER_V, random, TILE_COUNT, tileRange } from "./atlas.ts";
import type { BodySurface, HeadFrame, ScalpPoint } from "./head.ts";
import { addRope, addTube, type Cards, newCards, type RopeSpec } from "./ropes.ts";

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

/** One tile per rope in turn, so neighbouring ropes do not wear the same pattern. */
const tileOf = (index: number, metresPerV = METRES_PER_V) => {
  const { u0, u1 } = tileRange(index % TILE_COUNT);
  return { u0, u1, metresPerV, v0: ((index * 0.37) % 1) * 0.3 };
};

/**
 * Box braids: plaits from the roots all the way down, one from each section of a grid of partings
 * over the head, shoulder-blade length, hanging under their own weight.
 */
export function boxBraids({ head, body }: StyleContext): Cards {
  const cards = newCards();
  const rand = random(11);
  const spacing = 0.02; // metres between roots
  const radiusOfHead = (head.extent.max.x - head.extent.min.x) / 2;
  const rowStep = spacing / radiusOfHead;
  let index = 0;
  for (let e = 82 * DEG; e > -36 * DEG; e -= rowStep) {
    const ring = 2 * Math.PI * Math.cos(e) * radiusOfHead;
    const count = Math.max(1, Math.round(ring / spacing));
    for (let n = 0; n < count; n++) {
      // Stagger alternate rows by half a step, as sections are parted brick-wise.
      const a =
        ((n + 0.5 * (Math.round((82 * DEG - e) / rowStep) % 2)) / count) * 2 * Math.PI - Math.PI;
      if (e / DEG < hairlineElevation(a / DEG) + 3) continue;
      const root = head.surface(a, e);
      if (!root) continue;
      // Braids from the front fall to the side of the face, not across it: swept away from the
      // midline and back, more the nearer the front they start.
      const front = Math.max(0, 1 - Math.abs(a) / (40 * DEG));
      const spec: RopeSpec = {
        drift: new Vector3(Math.sign(root.point.x) * 1.3 * front, 0, -0.5 * front),
        root,
        length: 0.3 + 0.04 * (rand() - 0.5),
        radius: 0.0072,
        tipRadius: 0.0035,
        lift: 0.012,
        sides: 5,
        segments: 12,
        tile: tileOf(index++),
      };
      addRope(cards, spec, body);
    }
  }
  const crown = head.surface(0, 90 * DEG);
  if (crown)
    addRope(
      cards,
      {
        root: crown,
        length: 0.3,
        radius: 0.0072,
        tipRadius: 0.0035,
        lift: 0.012,
        sides: 5,
        segments: 12,
        drift: new Vector3(0, 0, -0.6),
        tile: tileOf(index++),
      },
      body,
    );
  return cards;
}

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
        length: 0.2 + 0.04 * rand(),
        radius,
        tipRadius: 0.0032,
        lift: 0.02,
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
 * A grid of ropes over the head, brick-wise as sections are parted: the one thing twists, locs and box
 * braids differ in is how thick, long, stiff and numerous the ropes are.
 */
function ropeGrid(
  { head, body }: StyleContext,
  rope: {
    seed: number;
    spacing: number;
    length: number;
    radius: number;
    tipRadius: number;
    lift: number;
    sides: number;
    segments: number;
    /** How far a rope strays from the straight hang, as drift (see `RopeSpec`). */
    stray: number;
  },
): Cards {
  const cards = newCards();
  const rand = random(rope.seed);
  const radiusOfHead = (head.extent.max.x - head.extent.min.x) / 2;
  const rowStep = rope.spacing / radiusOfHead;
  let index = 0;
  const top = 84 * DEG;
  for (let e = top; e > -36 * DEG; e -= rowStep) {
    const ring = 2 * Math.PI * Math.cos(e) * radiusOfHead;
    const count = Math.max(1, Math.round(ring / rope.spacing));
    for (let n = 0; n < count; n++) {
      const a = ((n + 0.5 * (Math.round((top - e) / rowStep) % 2)) / count) * 2 * Math.PI - Math.PI;
      if (e / DEG < hairlineElevation(a / DEG) + 3) continue;
      const root = head.surface(a, e);
      if (!root) continue;
      const front = Math.max(0, 1 - Math.abs(a) / (40 * DEG));
      addRope(
        cards,
        {
          root,
          length: rope.length * (0.85 + 0.3 * rand()),
          radius: rope.radius,
          tipRadius: rope.tipRadius,
          lift: rope.lift,
          sides: rope.sides,
          segments: rope.segments,
          drift: new Vector3(
            Math.sign(root.point.x) * 1.3 * front + rope.stray * (rand() - 0.5),
            0,
            -0.5 * front + rope.stray * (rand() - 0.5),
          ),
          tile: tileOf(index++),
        },
        body,
      );
    }
  }
  const crown = head.surface(0, 90 * DEG);
  if (crown)
    addRope(
      cards,
      {
        root: crown,
        length: rope.length,
        radius: rope.radius,
        tipRadius: rope.tipRadius,
        lift: rope.lift,
        sides: rope.sides,
        segments: rope.segments,
        drift: new Vector3(0, 0, -0.5),
        tile: tileOf(index++),
      },
      body,
    );
  return cards;
}

/** Two-strand twists: thinner, shorter and more of them than braids, standing off the scalp before they fall. */
export const twists = (context: StyleContext): Cards =>
  ropeGrid(context, {
    seed: 31,
    spacing: 0.017,
    length: 0.17,
    radius: 0.0048,
    tipRadius: 0.0028,
    lift: 0.03,
    sides: 5,
    segments: 9,
    stray: 0.35,
  });

/** Locs: thick matted ropes, long, falling heavily. */
export const locs = (context: StyleContext): Cards =>
  ropeGrid(context, {
    seed: 41,
    spacing: 0.026,
    length: 0.36,
    radius: 0.0088,
    tipRadius: 0.0055,
    lift: 0.01,
    sides: 6,
    segments: 12,
    stray: 0.2,
  });
