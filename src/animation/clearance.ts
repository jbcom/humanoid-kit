/**
 * Does a pose put one part of the body through another? A coarse check, for
 * tests and tooling, not the renderer: the body as 15 capsules (head, torso, and
 * each side's upper arm, forearm, hand, thigh, shin and foot), each a segment between
 * two joints and a radius measured from the figure's own skin, and the depth to
 * which two that are not neighbours overlap in a pose.
 *
 * A capsule is a coarse stand-in for a limb (a hand is not round), so a small
 * overlap is not a collision; `CLEARANCE_TOLERANCE` is what the check allows.
 */
import { type HumanoidAssets, jointPosition } from "../format/assetFormat.ts";
import { type BoneRotations, posedBones, type RestBones } from "../rig/bones.ts";
import { rotate } from "../rig/quat.ts";

/** A part of the body: a bone's head (or one end), and the bone whose tail is the other end, with the bones whose skin it measures. */
interface SegmentSpec {
  id: string;
  /** The bone whose head starts the segment. */
  from: string;
  /** The bone whose tail ends it. */
  to: string;
  /** Every bone whose skin counts as this part. */
  bones: string[];
  /**
   * How much of the measured radius the capsule has: a hand and a foot are flat, and the
   * mean distance of their skin from the axis counts their width as their thickness.
   */
  flat?: number;
}

const side = (s: "L" | "R"): SegmentSpec[] => [
  {
    id: `upperarm.${s}`,
    from: `upperarm01.${s}`,
    to: `upperarm02.${s}`,
    bones: [`upperarm01.${s}`, `upperarm02.${s}`],
  },
  {
    id: `forearm.${s}`,
    from: `lowerarm01.${s}`,
    to: `lowerarm02.${s}`,
    bones: [`lowerarm01.${s}`, `lowerarm02.${s}`],
  },
  {
    id: `hand.${s}`,
    flat: 0.5,
    from: `wrist.${s}`,
    to: `metacarpal3.${s}`,
    bones: [
      `wrist.${s}`,
      ...[1, 2, 3, 4].map((i) => `metacarpal${i}.${s}`),
      ...["finger1-1", "finger1-2", "finger1-3", "finger2-1", "finger2-2", "finger2-3"].map(
        (f) => `${f}.${s}`,
      ),
      ...["finger3-1", "finger3-2", "finger3-3", "finger4-1", "finger4-2", "finger4-3"].map(
        (f) => `${f}.${s}`,
      ),
      ...["finger5-1", "finger5-2", "finger5-3"].map((f) => `${f}.${s}`),
    ],
  },
  {
    id: `thigh.${s}`,
    from: `upperleg01.${s}`,
    to: `upperleg02.${s}`,
    bones: [`upperleg01.${s}`, `upperleg02.${s}`],
  },
  {
    id: `shin.${s}`,
    from: `lowerleg01.${s}`,
    to: `lowerleg02.${s}`,
    bones: [`lowerleg01.${s}`, `lowerleg02.${s}`],
  },
  { id: `foot.${s}`, flat: 0.6, from: `foot.${s}`, to: `foot.${s}`, bones: [`foot.${s}`] },
];

const SPECS: SegmentSpec[] = [
  {
    id: "torso",
    from: "spine05",
    to: "spine01",
    bones: ["spine05", "spine04", "spine03", "spine02", "spine01"],
  },
  { id: "head", from: "head", to: "head", bones: ["head"] },
  ...side("L"),
  ...side("R"),
];

/** Pairs of parts that meet by construction: they overlap at a joint, and are not tested. */
const NEIGHBOURS = new Set(
  [
    ["torso", "head"],
    ...(["L", "R"] as const).flatMap((s) => [
      ["torso", `upperarm.${s}`],
      ["torso", `thigh.${s}`],
      [`upperarm.${s}`, `forearm.${s}`],
      [`forearm.${s}`, `hand.${s}`],
      [`thigh.${s}`, `shin.${s}`],
      [`shin.${s}`, `foot.${s}`],
    ]),
    ["thigh.L", "thigh.R"],
  ].map(([a, b]) => [a, b].sort().join("|")),
);

/** How deeply two parts may overlap before it counts as one through the other, metres: the capsules are coarse. */
export const CLEARANCE_TOLERANCE = 0.025;

export interface BodySegment {
  id: string;
  from: number;
  to: number;
  /** Where the segment ends, in the `to` bone's frame: its rest tail minus its rest head. */
  tail: [number, number, number];
  radius: number;
}

/** The body's capsules for a figure: its rest skeleton, control mesh and skin (`RigSkin`'s weights). */
export function bodySegments(
  assets: HumanoidAssets,
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  bodyVertices: Iterable<number>,
): BodySegment[] {
  const bone = (name: string) => {
    const i = rest.names.indexOf(name);
    if (i < 0) throw new Error(`the rig has no bone ${name}`);
    return i;
  };
  const tails = new Float32Array(3);
  return SPECS.map((spec) => {
    const from = bone(spec.from);
    const to = bone(spec.to);
    const toBone = assets.manifest.skeleton.bones[to];
    if (!toBone) throw new Error(`no bone ${spec.to}`);
    // A segment of one bone ends at that bone's tail joint, one of several at the last one's.
    jointPosition(assets, control, toBone.tail, tails);
    const tail: [number, number, number] = [
      (tails[0] as number) - (rest.heads[to * 3] as number),
      (tails[1] as number) - (rest.heads[to * 3 + 1] as number),
      (tails[2] as number) - (rest.heads[to * 3 + 2] as number),
    ];
    const a = [
      rest.heads[from * 3] as number,
      rest.heads[from * 3 + 1] as number,
      rest.heads[from * 3 + 2] as number,
    ];
    const b = [
      (rest.heads[to * 3] as number) + tail[0],
      (rest.heads[to * 3 + 1] as number) + tail[1],
      (rest.heads[to * 3 + 2] as number) + tail[2],
    ];
    const mine = new Set(spec.bones.map(bone));
    // The radius: how far, on average, the skin that belongs to this part is from its axis.
    let sum = 0;
    let n = 0;
    for (const v of bodyVertices) {
      let best = 0;
      let bestW = -1;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight[v * 4 + k] as number;
        if (w > bestW) {
          bestW = w;
          best = skinIndex[v * 4 + k] as number;
        }
      }
      if (!mine.has(best)) continue;
      sum += distanceToSegment(
        control[v * 3] as number,
        control[v * 3 + 1] as number,
        control[v * 3 + 2] as number,
        a,
        b,
      );
      n++;
    }
    return { id: spec.id, from, to, tail, radius: n > 0 ? (sum / n) * (spec.flat ?? 1) : 0 };
  });
}

function distanceToSegment(
  x: number,
  y: number,
  z: number,
  a: readonly number[],
  b: readonly number[],
): number {
  const dx = (b[0] as number) - (a[0] as number);
  const dy = (b[1] as number) - (a[1] as number);
  const dz = (b[2] as number) - (a[2] as number);
  const len2 = dx * dx + dy * dy + dz * dz;
  const t =
    len2 === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            ((x - (a[0] as number)) * dx +
              (y - (a[1] as number)) * dy +
              (z - (a[2] as number)) * dz) /
              len2,
          ),
        );
  return Math.hypot(
    x - ((a[0] as number) + t * dx),
    y - ((a[1] as number) + t * dy),
    z - ((a[2] as number) + t * dz),
  );
}

/** The shortest distance between segments `p0 p1` and `q0 q1`. */
function segmentDistance(
  p0: readonly number[],
  p1: readonly number[],
  q0: readonly number[],
  q1: readonly number[],
): number {
  const u = [0, 1, 2].map((i) => (p1[i] as number) - (p0[i] as number)) as [number, number, number];
  const v = [0, 1, 2].map((i) => (q1[i] as number) - (q0[i] as number)) as [number, number, number];
  const w = [0, 1, 2].map((i) => (p0[i] as number) - (q0[i] as number)) as [number, number, number];
  const dot = (a: readonly number[], b: readonly number[]) =>
    (a[0] as number) * (b[0] as number) +
    (a[1] as number) * (b[1] as number) +
    (a[2] as number) * (b[2] as number);
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w);
  const e = dot(v, w);
  const det = a * c - b * b;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  let s = det > 1e-12 ? clamp((b * e - c * d) / det) : 0;
  let t = c > 1e-12 ? (b * s + e) / c : 0;
  if (t < 0) {
    t = 0;
    s = a > 1e-12 ? clamp(-d / a) : 0;
  } else if (t > 1) {
    t = 1;
    s = a > 1e-12 ? clamp((b - d) / a) : 0;
  }
  return Math.hypot(
    (w[0] as number) + s * u[0] - t * v[0],
    (w[1] as number) + s * u[1] - t * v[1],
    (w[2] as number) + s * u[2] - t * v[2],
  );
}

export interface Overlap {
  a: string;
  b: string;
  /** How far the two capsules are into each other, metres (positive: overlapping). */
  depth: number;
}

/** Where the segments are in a pose: each one's two ends. */
export function segmentEnds(
  rest: RestBones,
  segments: readonly BodySegment[],
  rotations: BoneRotations,
): { a: [number, number, number]; b: [number, number, number] }[] {
  const { world, heads } = posedBones(rest, rotations);
  return segments.map((s) => {
    const q: [number, number, number, number] = [
      world[s.to * 4] as number,
      world[s.to * 4 + 1] as number,
      world[s.to * 4 + 2] as number,
      world[s.to * 4 + 3] as number,
    ];
    const t = rotate(q, s.tail[0], s.tail[1], s.tail[2]);
    return {
      a: [
        heads[s.from * 3] as number,
        heads[s.from * 3 + 1] as number,
        heads[s.from * 3 + 2] as number,
      ],
      b: [
        (heads[s.to * 3] as number) + t[0],
        (heads[s.to * 3 + 1] as number) + t[1],
        (heads[s.to * 3 + 2] as number) + t[2],
      ],
    };
  });
}

/** Every pair of parts that are not neighbours, with how deep they overlap in the pose (negative: apart). */
export function overlaps(
  rest: RestBones,
  segments: readonly BodySegment[],
  rotations: BoneRotations,
): Overlap[] {
  const ends = segmentEnds(rest, segments, rotations);
  const out: Overlap[] = [];
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i] as BodySegment;
      const b = segments[j] as BodySegment;
      if (NEIGHBOURS.has([a.id, b.id].sort().join("|"))) continue;
      const ei = ends[i] as (typeof ends)[number];
      const ej = ends[j] as (typeof ends)[number];
      out.push({
        a: a.id,
        b: b.id,
        depth: a.radius + b.radius - segmentDistance(ei.a, ei.b, ej.a, ej.b),
      });
    }
  return out;
}
