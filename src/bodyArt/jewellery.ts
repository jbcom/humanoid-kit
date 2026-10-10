/**
 * Piercings' jewellery (docs/ARCHITECTURE.md, "Body art"; research/BODY-ART.md
 * C3): a stud, ring or barbell built in the frame of its site's hole, in the
 * figure's rest space, and skinned rigidly with the site vertex's own bone
 * weights, so it follows the posed surface as the skin there does. The part
 * of the jewellery inside the tissue is hidden by the skin in front of it.
 *
 * A hole runs through the tissue along the site's channel (`PiercingChannel`):
 * into the skin (a lobe), across the body (the septum), or vertically under the
 * skin (a brow's ridge, the navel's upper rim). Its middle is where a ring
 * passes and a barbell's bar lies; a ring hangs down from it.
 */
import type { Vec3 } from "../presence/presence.ts";
import type { Jewellery, Metal, PiercingSite } from "../recipe/bodyArt.ts";
import type { Rgb } from "../surface/skinTone.ts";
import type { PiercingChannel } from "./sites.ts";
import { closestSkin, type SkinPatch } from "./skinDistance.ts";

/** A piercing placed on a figure: what it is, and its hole's frame and skinning. */
export interface PlacedPiercing {
  site: string;
  jewellery: Jewellery;
  metal: Metal;
  size: number;
  /** Where the hole meets the skin, metres, rest space. */
  hole: Vec3;
  /** The skin's outward unit normal there. */
  normal: Vec3;
  /** Unit direction of the hole through the tissue. */
  channel: Vec3;
  /** Unit direction a ring hangs toward, square to the channel. */
  down: Vec3;
  /** The hole's midpoint, where a ring passes and a barbell's bar lies. */
  middle: Vec3;
  /** A barbell's ends, its balls seated on the skin (`barbellEnds`). */
  ends: [Vec3, Vec3];
  /** The site vertex's four bones and weights. */
  skinIndex: [number, number, number, number];
  skinWeight: [number, number, number, number];
}

/**
 * How thick the tissue a site's hole crosses is, metres: CHOICES after typical
 * piercing anatomy (a lobe 4 mm, the helix's cartilage 2 mm, a nostril's wing
 * 3 mm, the columella 7 mm across, 8 mm of brow ridge, 6 mm of lip, 8 mm of the
 * navel's rim).
 */
export const TISSUE_DEPTH: Readonly<Record<PiercingSite, number>> = {
  "ear-lobe.L": 0.004,
  "ear-lobe.R": 0.004,
  "ear-helix.L": 0.002,
  "ear-helix.R": 0.002,
  "nostril.L": 0.003,
  "nostril.R": 0.003,
  septum: 0.007,
  "brow.L": 0.008,
  "brow.R": 0.008,
  "lower-lip": 0.006,
  navel: 0.008,
};

/**
 * Metals' reflectance at normal incidence (linear sRGB): steel (iron), silver,
 * gold and titanium from measured optical constants (Hoffman, "Physics and Math
 * of Shading", SIGGRAPH 2015 course, after Gulbrandsen 2014); rose gold, a
 * gold-copper alloy, between gold's and copper's (CHOICE).
 */
export const METAL_REFLECTANCE: Readonly<Record<Metal, Rgb>> = {
  steel: [0.56, 0.57, 0.58],
  silver: [0.95, 0.93, 0.88],
  gold: [1.0, 0.71, 0.29],
  titanium: [0.54, 0.5, 0.45],
  "rose-gold": [0.97, 0.68, 0.42],
};
/** Polished jewellery's roughness (CHOICE). */
export const JEWELLERY_ROUGHNESS = 0.18;

/** A ring's wire thickness, and a barbell's balls, as shares of the size (CHOICES), with floors in metres. */
export const RING_WIRE = 0.08;
export const RING_WIRE_MIN = 0.0008;
export const BARBELL_BALL = 0.22;
export const BARBELL_BALL_MIN = 0.0025;
export const BARBELL_BAR = 0.0012;

const BODY_UP: Vec3 = [0, 1, 0];
const BODY_ACROSS: Vec3 = [1, 0, 0];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** `a` with its part along unit `n` removed, normalised. */
const square = (a: Vec3, n: Vec3): Vec3 => {
  const d = dot(a, n);
  return unit([a[0] - n[0] * d, a[1] - n[1] * d, a[2] - n[2] * d]);
};
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** The hole's frame at a site: its channel, the way a ring hangs, and its middle. */
export function holeFrame(
  hole: Vec3,
  normal: Vec3,
  channel: PiercingChannel,
  depth: number,
): Pick<PlacedPiercing, "channel" | "down" | "middle"> {
  const n = unit(normal);
  const c: Vec3 =
    channel === "normal"
      ? [-n[0], -n[1], -n[2]]
      : channel === "across"
        ? square(BODY_ACROSS, n)
        : square(BODY_UP, n);
  // A hole into the tissue has its middle along it; one under the skin lies beneath its entry.
  const middle = channel === "normal" ? add(hole, c, depth / 2) : add(hole, n, -depth / 2);
  // A ring hangs down from a hole into the skin or across it; through a ridge
  // (a vertical hole under the skin) it loops out in front of the ridge.
  const down =
    channel === "vertical" ? square(n, c) : square([-BODY_UP[0], -BODY_UP[1], -BODY_UP[2]], c);
  return { channel: c, down, middle };
}

export interface JewelleryMesh {
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
}

class Builder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly index: number[] = [];

  /** A grid of (i, j) points, wrapped in i (and in j when `wrapJ`), each placed by `at`. */
  grid(
    ni: number,
    nj: number,
    wrapJ: boolean,
    at: (u: number, v: number) => { p: Vec3; n: Vec3 },
  ): void {
    const base = this.positions.length / 3;
    const rows = wrapJ ? nj : nj + 1;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < ni; i++) {
        const { p, n } = at(i / ni, j / nj);
        this.positions.push(...p);
        this.normals.push(...n);
      }
    for (let j = 0; j < nj; j++)
      for (let i = 0; i < ni; i++) {
        const a = base + j * ni + i;
        const b = base + j * ni + ((i + 1) % ni);
        const c = base + ((j + 1) % rows) * ni + ((i + 1) % ni);
        const d = base + ((j + 1) % rows) * ni + i;
        this.index.push(a, b, c, a, c, d);
      }
  }

  sphere(centre: Vec3, r: number, e1: Vec3, e2: Vec3, e3: Vec3): void {
    this.grid(16, 10, false, (u, v) => {
      const theta = u * Math.PI * 2;
      const phi = v * Math.PI;
      const n: Vec3 = [0, 1, 2].map(
        (k) =>
          (e1[k] as number) * Math.sin(phi) * Math.cos(theta) +
          (e2[k] as number) * Math.sin(phi) * Math.sin(theta) +
          (e3[k] as number) * Math.cos(phi),
      ) as Vec3;
      return { p: add(centre, n, r), n };
    });
  }

  /** A torus: a circle of radius `R` in the plane of `e1`, `e2` round `centre`, a tube `t` thick. */
  torus(centre: Vec3, R: number, t: number, e1: Vec3, e2: Vec3, e3: Vec3): void {
    this.grid(32, 10, true, (u, v) => {
      const a = u * Math.PI * 2;
      const b = v * Math.PI * 2;
      const radial: Vec3 = [0, 1, 2].map(
        (k) => (e1[k] as number) * Math.cos(a) + (e2[k] as number) * Math.sin(a),
      ) as Vec3;
      const n: Vec3 = [0, 1, 2].map(
        (k) => (radial[k] as number) * Math.cos(b) + (e3[k] as number) * Math.sin(b),
      ) as Vec3;
      return { p: add(add(centre, radial, R), n, t), n };
    });
  }

  /** A tube of radius `r` from `a` to `b`, open at its ends (the balls close them). */
  tube(a: Vec3, b: Vec3, r: number, e1: Vec3, e2: Vec3): void {
    this.grid(10, 1, false, (u, v) => {
      const t = u * Math.PI * 2;
      const n: Vec3 = [0, 1, 2].map(
        (k) => (e1[k] as number) * Math.cos(t) + (e2[k] as number) * Math.sin(t),
      ) as Vec3;
      const along: Vec3 = [0, 1, 2].map(
        (k) => (a[k] as number) + ((b[k] as number) - (a[k] as number)) * v,
      ) as Vec3;
      return { p: add(along, n, r), n };
    });
  }
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** A barbell's balls' radius, metres. */
export function barbellBall(p: Pick<PlacedPiercing, "size">): number {
  return Math.max(BARBELL_BALL_MIN, p.size * BARBELL_BALL) / 2;
}

/** How far round a site the skin is searched for seating a barbell's balls, metres. */
export const SEAT_REACH = 0.04;

/**
 * A barbell's two ends, where its balls sit: along the channel either side of
 * the hole's middle, each moved out along the skin's normal, where it lies
 * under the skin, until its ball rests on the skin. A straight bar under skin
 * that is flat or curves away (a navel's rim, a brow's ridge) would hold both
 * balls inside the tissue, as the sheets' navel did; seated, the bar bends
 * through the middle as those piercings' curved bars do.
 */
export function barbellEnds(
  p: Pick<PlacedPiercing, "middle" | "channel" | "size">,
  skin: SkinPatch,
): [Vec3, Vec3] {
  const r = barbellBall(p);
  const seat = (sign: number): Vec3 => {
    let end = add(p.middle, p.channel, (sign * p.size) / 2);
    // Moving out along the normal can bring other skin nearer: settle twice more.
    for (let i = 0; i < 3; i++) {
      const c = closestSkin(skin, end);
      if (c.distance >= r - 1e-6) break;
      end = add(c.point, c.normal, r);
    }
    return end;
  };
  return [seat(-1), seat(1)];
}

/**
 * The jewellery's mesh in rest space: a stud is a ball sitting on the skin at
 * the hole; a ring is a torus through the hole's middle, hanging toward `down`;
 * a barbell is a bar along the channel through the hole's middle with a ball at
 * each end.
 */
export function jewelleryMesh(p: PlacedPiercing): JewelleryMesh {
  const b = new Builder();
  const side = cross(p.channel, p.down);
  if (p.jewellery === "stud") {
    const r = p.size / 2;
    // Seated on the skin: a fifth of the ball below the surface.
    b.sphere(add(p.hole, p.normal, r * 0.6), r, p.channel, p.down, side);
  } else if (p.jewellery === "ring") {
    const t = Math.max(RING_WIRE_MIN, p.size * RING_WIRE);
    const R = p.size / 2 - t;
    b.torus(add(p.middle, p.down, R), R, t, p.down, p.channel, side);
  } else {
    const ball = barbellBall(p);
    // The bar runs from each ball to the hole's middle.
    for (const end of p.ends) {
      const along = unit([end[0] - p.middle[0], end[1] - p.middle[1], end[2] - p.middle[2]]);
      const e1 = square(p.down, along);
      b.tube(p.middle, end, BARBELL_BAR / 2, e1, cross(along, e1));
      b.sphere(end, ball, p.down, side, p.channel);
    }
  }
  return {
    positions: new Float32Array(b.positions),
    normals: new Float32Array(b.normals),
    index: new Uint32Array(b.index),
  };
}
