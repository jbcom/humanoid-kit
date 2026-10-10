/**
 * The channel behind an aperture (docs/FOUNDATION.md, "Affordances";
 * docs/research/AFFORDANCE-CHANNELS.md): a path in from the rim with a size at
 * each depth, so the kit can say what is inside an opening, how far in, and
 * whether a point has passed the rim and is to be hidden (what a figure eats
 * dissolves past its lips).
 *
 * A channel runs straight in along `inward`: its rim's inward normal, turned
 * toward the head's centre by its `towardHead` (the nostril's). Its
 * cross-section is an ellipse: `across` along the rim frame's bitangent, `up`
 * along its tangent, each made square to the path.
 * Every size is an adult's, scaled to the figure by the width of its head (its
 * ear canals' span over the default adult's), so a child's are a child's. The
 * mouth's width is the figure's own (between its corners) and its height is
 * how far it is open.
 */
import type { LandmarkFrame, Vec3 } from "../foundation/landmarks.ts";

export type ChannelId = "auditory" | "nasal" | "oral";

export interface ChannelSpec {
  /** How deep it runs behind the rim, metres (an adult's). */
  depth: number;
  /** Its size at the rim, metres across (the rim's bitangent) and up (its tangent), an adult's. */
  rim: { across: number; up: number };
  /**
   * Its size along its depth, as a share of the rim's: `[share of depth, across
   * factor, up factor]` from 0 to 1, between which the size is interpolated.
   */
  profile: readonly (readonly [number, number, number])[];
  /**
   * How far its straight path turns from the rim's inward normal toward the
   * head's centre, 0 to 1: a channel that bends inside the head (the nostril's
   * vestibule rises, then turns back into the nose) runs between the two.
   */
  towardHead: number;
}

/** The channels' adult dimensions (docs/research/AFFORDANCE-CHANNELS.md: measured unless marked CHOICE there). */
export const CHANNELS: Readonly<Record<ChannelId, ChannelSpec>> = {
  // The ear canal: entry 7.75 high by 6.1 mm wide, isthmus 6.8 by 5.2 a third of the way in
  // (CHOICE of depth) and so to its end, 24 mm deep (cartilage 8 + bone 16).
  auditory: {
    depth: 0.024,
    rim: { across: 0.0061, up: 0.00775 },
    profile: [
      [0, 1, 1],
      [1 / 3, 5.2 / 6.1, 6.8 / 7.75],
      [1, 5.2 / 6.1, 6.8 / 7.75],
    ],
    towardHead: 0,
  },
  // The nostril: 10.5 mm across its floor and 15 mm along its axis; 15 mm deep to the
  // nasal valve (CHOICE), running midway between straight up from the nostril and the way
  // back into the head (CHOICE: the vestibule rises, then turns back).
  nasal: {
    depth: 0.015,
    rim: { across: 0.0105, up: 0.015 },
    profile: [
      [0, 1, 1],
      [1, 1, 1],
    ],
    towardHead: 0.5,
  },
  // The mouth: 90 mm deep (CHOICE, on the oropharyngeal airway's adult sizes), its rim's
  // width the figure's own and its height the opening's (45 mm wide open, CHOICE); its
  // rim's size to half its depth, 60% at the back (CHOICE).
  oral: {
    depth: 0.09,
    rim: { across: 0, up: 0.045 },
    profile: [
      [0, 1, 1],
      [0.5, 1, 1],
      [1, 0.6, 0.6],
    ],
    towardHead: 0,
  },
};

/** The default adult's ear canals' span, metres: the head width the channels' dimensions are for. */
export const ADULT_EAR_SPAN = 0.1314;

/** A channel on a figure: where its rim is, which way it runs, and its size along it. */
export interface Channel {
  /** The rim's centre. */
  origin: Vec3;
  /** Into the body, along the channel. */
  inward: Vec3;
  /** The cross-section's axes: the rim frame's bitangent and tangent. */
  across: Vec3;
  up: Vec3;
  /** How deep it runs, metres. */
  depth: number;
  /**
   * Its size along it: `[depth, half across, half up]`, metres, from the rim
   * (depth 0) to its end (`depth`), between which the size is interpolated.
   * What `halfSize` reads and the renderer's clip (`ChannelClip`) uploads.
   */
  knots: readonly (readonly [number, number, number])[];
  /** Its half-sizes (across, up) at `d` metres in, metres; 0 past either end. */
  halfSize(d: number): [number, number];
}

/** The most knots a channel's profile has (`CHANNELS`' longest), which the renderer's clip is sized for. */
export const CHANNEL_KNOTS = 3;

/** Where a point is against a channel: how far in it is, and whether it is inside. */
export interface ChannelPlace {
  /** Metres in from the rim along the channel (negative: in front of the rim). */
  depth: number;
  /** Inside the channel: past the rim, short of its end, within its cross-section. */
  inside: boolean;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The half-sizes (across, up) at `d` metres along `knots`, interpolated; 0 past either end. */
export function knotHalfSize(
  knots: readonly (readonly [number, number, number])[],
  d: number,
): [number, number] {
  const end = knots[knots.length - 1] as readonly [number, number, number];
  if (d < 0 || d > end[0]) return [0, 0];
  for (let i = 1; i < knots.length; i++) {
    const [d0, a0, u0] = knots[i - 1] as readonly [number, number, number];
    const [d1, a1, u1] = knots[i] as readonly [number, number, number];
    if (d <= d1) {
      const t = (d - d0) / (d1 - d0 || 1);
      return [a0 + (a1 - a0) * t, u0 + (u1 - u0) * t];
    }
  }
  return [end[1], end[2]];
}

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * A channel behind a rim. `scale` is the figure's head width over the adult's
 * (`ADULT_EAR_SPAN`), `head` its centre (midway between its ear canals);
 * `opening` (0 to 1) opens a channel that opens (the mouth), whose rim is
 * `width` across (the figure's own mouth, metres).
 */
export function channelOf(
  id: ChannelId,
  rim: LandmarkFrame,
  scale: number,
  head: Vec3,
  opening = 1,
  width?: number,
): Channel {
  const spec = CHANNELS[id];
  if (!(scale > 0)) throw new RangeError(`channel ${id}: scale must be positive, not ${scale}`);
  const sizeAcross = id === "oral" ? (width ?? 0) : spec.rim.across * scale;
  const sizeUp = spec.rim.up * scale * (id === "oral" ? opening : 1);
  const depth = spec.depth * scale;
  const t = spec.towardHead;
  const toHead = unit([
    head[0] - rim.position[0],
    head[1] - rim.position[1],
    head[2] - rim.position[2],
  ]);
  const inward = unit([
    -rim.normal[0] * (1 - t) + toHead[0] * t,
    -rim.normal[1] * (1 - t) + toHead[1] * t,
    -rim.normal[2] * (1 - t) + toHead[2] * t,
  ]);
  // The rim's axes made square to the path, with their handedness kept (across = up × inward).
  const d = dot(rim.tangent, inward);
  const up = unit([
    rim.tangent[0] - inward[0] * d,
    rim.tangent[1] - inward[1] * d,
    rim.tangent[2] - inward[2] * d,
  ]);
  const across = cross(up, inward);
  const knots = spec.profile.map(
    ([share, fa, fu]) => [share * depth, (sizeAcross / 2) * fa, (sizeUp / 2) * fu] as const,
  );
  return {
    origin: rim.position,
    inward,
    across,
    up,
    depth,
    knots,
    halfSize: (d) => knotHalfSize(knots, d),
  };
}

/** Where `p` is against `channel`. */
export function placeIn(channel: Channel, p: Vec3): ChannelPlace {
  const o: Vec3 = [p[0] - channel.origin[0], p[1] - channel.origin[1], p[2] - channel.origin[2]];
  const depth = dot(o, channel.inward);
  const [a, u] = channel.halfSize(depth);
  if (depth < 0 || depth > channel.depth || a <= 0 || u <= 0) return { depth, inside: false };
  const x = dot(o, channel.across) / a;
  const y = dot(o, channel.up) / u;
  return { depth, inside: x * x + y * y <= 1 };
}
