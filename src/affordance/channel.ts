/**
 * The channel behind an aperture (docs/FOUNDATION.md, "Affordances";
 * docs/research/AFFORDANCE-CHANNELS.md): a path in from the rim with a size at
 * each depth, so the kit can say what is inside an opening, how far in, and
 * whether a point has passed the rim and is to be hidden (what a figure eats
 * dissolves past its lips).
 *
 * A channel runs straight in along its rim's inward normal. Its cross-section is
 * an ellipse: `across` along the rim frame's bitangent, `up` along its tangent.
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
   * Its size along its depth, as a share of the rim's: `[share of depth, factor]`
   * pairs from 0 to 1, between which the size is interpolated.
   */
  profile: readonly (readonly [number, number])[];
  /**
   * How far its straight path turns from the rim's inward normal toward the
   * head's centre, 0 to 1: a channel that bends inside the head (the nostril's
   * vestibule rises, then turns back into the nose) runs between the two.
   */
  towardHead: number;
}

/** The channels' adult dimensions (docs/research/AFFORDANCE-CHANNELS.md: measured unless marked CHOICE there). */
export const CHANNELS: Readonly<Record<ChannelId, ChannelSpec>> = {
  // The ear canal: entry 7.75 by 6.1 mm, isthmus 6.8 by 5.2 a third of the way in (CHOICE
  // of depth), 24 mm deep (cartilage 8 + bone 16).
  auditory: {
    depth: 0.024,
    rim: { across: 0.0061, up: 0.00775 },
    profile: [
      [0, 1],
      [1 / 3, 0.86],
      [1, 0.86],
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
      [0, 1],
      [1, 1],
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
      [0, 1],
      [0.5, 1],
      [1, 0.6],
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
  /** Its half-sizes (across, up) at `d` metres in, metres; 0 past either end. */
  halfSize(d: number): [number, number];
}

/** Where a point is against a channel: how far in it is, and whether it is inside. */
export interface ChannelPlace {
  /** Metres in from the rim along the channel (negative: in front of the rim). */
  depth: number;
  /** Inside the channel: past the rim, short of its end, within its cross-section. */
  inside: boolean;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The profile's factor at a share of the depth. */
function factorAt(profile: ChannelSpec["profile"], share: number): number {
  for (let i = 1; i < profile.length; i++) {
    const [s0, f0] = profile[i - 1] as readonly [number, number];
    const [s1, f1] = profile[i] as readonly [number, number];
    if (share <= s1) return f0 + ((f1 - f0) * (share - s0)) / (s1 - s0 || 1);
  }
  return (profile[profile.length - 1] as readonly [number, number])[1];
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
  return {
    origin: rim.position,
    inward,
    across,
    up,
    depth,
    halfSize(d) {
      if (d < 0 || d > depth) return [0, 0];
      const f = factorAt(spec.profile, d / depth);
      return [(sizeAcross / 2) * f, (sizeUp / 2) * f];
    },
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
