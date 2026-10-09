/**
 * Each hand's frame, measured from the base mesh alone, as the skin-state
 * zones are: the skeleton's finger joints give each digit a polyline, so a
 * vertex has a digit, a distance along it and a distance across it, and the
 * vertex normals tell the palmar side from the dorsal. No target or vertex
 * group is added. The hands' layers (`./index.ts`) all draw from it.
 */
import type { HumanoidAssets } from "../../../format/assetFormat.ts";
import { jointPosition } from "../../../format/assetFormat.ts";
import { palmDirection, skinZones } from "../skinZones.ts";

type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: Vec3, b: Vec3, w: number): Vec3 => [
  a[0] + (b[0] - a[0]) * w,
  a[1] + (b[1] - a[1]) * w,
  a[2] + (b[2] - a[2]) * w,
];
const normalise = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Hermite ease from 0 at `lo` to 1 at `hi`. Shared by the hands' fields. */
export const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** `x` held to `lo`..`hi`. Shared by the hands' fields. */
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Digits, thumb first. */
const DIGITS = [1, 2, 3, 4, 5] as const;

/**
 * A digit's polyline from the wrist: the wrist, then its base joint (the
 * thumb's carpometacarpal joint, a finger's knuckle), its two interphalangeal
 * joints (the thumb's metacarpophalangeal and interphalangeal) and its tip.
 */
function digitJoints(assets: HumanoidAssets, side: "L" | "R", digit: number): Vec3[] {
  const at = (joint: string): Vec3 => {
    const p = new Float32Array(3);
    jointPosition(assets, assets.positions, joint, p, 0);
    return [p[0] as number, p[1] as number, p[2] as number];
  };
  return [
    at(`wrist.${side}____head`),
    at(`finger${digit}-1.${side}____head`),
    at(`finger${digit}-2.${side}____head`),
    at(`finger${digit}-3.${side}____head`),
    at(`finger${digit}-3.${side}____tail`),
  ];
}

/**
 * Where each vertex of a hand lies in that hand's frame. `digit` is the digit
 * whose polyline is nearest (0 for none: off the hands); `along` is the
 * distance along that polyline from its base joint, metres (negative over the
 * back and front of the hand, between the wrist and the knuckle); `across` the
 * signed distance across the digit; `volar` the normal's alignment with the
 * palm's facing, 1 on the palm and −1 on the back. `joints[side][digit]` are
 * the `along` of the digit's joints: base 0, then the two joints, then the
 * tip; `palm` holds each vertex's coordinates in the palm's plane.
 */
export interface HandFrame {
  digit: Int8Array;
  along: Float32Array;
  across: Float32Array;
  volar: Float32Array;
  /** Per vertex: 0 for the left hand, 1 for the right. */
  side: Uint8Array;
  /** `along` of each digit's joints, per side then digit (1 to 5): base, two joints, tip. */
  joints: readonly (readonly (readonly number[])[])[];
  /** Per side and digit: the digit's mean radius over its last segment, metres. */
  radius: readonly (readonly number[])[];
  /**
   * Coordinates in the palm's plane, metres, two per vertex: across the palm
   * toward the thumb (u) and from the wrist toward the middle finger (v).
   */
  palm: Float32Array;
  /** Per side, the palm-plane coordinates of the landmarks the creases are drawn from. */
  landmarks: readonly PalmLandmarks[];
}

/** Landmarks in the palm's plane, metres: (u, v) each. */
export interface PalmLandmarks {
  /** The knuckles of the index, middle, ring and little fingers. */
  knuckles: readonly [number, number][];
  /** The thumb's carpometacarpal and metacarpophalangeal joints. */
  thumbBase: [number, number];
  thumbKnuckle: [number, number];
}

const frames = new WeakMap<HumanoidAssets, HandFrame>();

/** The hands' frame of a base mesh, measured on first use. */
export function handFrame(assets: HumanoidAssets): HandFrame {
  const known = frames.get(assets);
  if (known) return known;
  const n = assets.manifest.vertexCount;
  const P = assets.positions;
  const zones = skinZones(assets);
  const hand = zones.zone("hand");
  const N = zones.normals;
  const frame: HandFrame = {
    digit: new Int8Array(n),
    along: new Float32Array(n),
    across: new Float32Array(n),
    volar: new Float32Array(n),
    side: new Uint8Array(n),
    joints: [],
    radius: [],
    palm: new Float32Array(n * 2),
    landmarks: [],
  };
  const joints: number[][][] = [];
  const radius: number[][] = [];
  const landmarks: PalmLandmarks[] = [];
  (["L", "R"] as const).forEach((sideName, sideIndex) => {
    const sign = sideName === "L" ? 1 : -1;
    const palmDir = palmDirection(assets, sideName);
    const lines = DIGITS.map((d) => digitJoints(assets, sideName, d));
    // Each segment of each digit: start, unit axis, length, `along` at its start,
    // and its neighbours along the digit.
    interface Segment {
      digit: number;
      a: Vec3;
      axis: Vec3;
      len: number;
      s0: number;
      prev: Segment | null;
      next: Segment | null;
    }
    const segments: Segment[] = [];
    const sideJoints: number[][] = [[]];
    lines.forEach((pts, i) => {
      const lens = pts.slice(1).map((p, k) => length(sub(p, pts[k] as Vec3)));
      const s: number[] = [-(lens[0] as number)];
      for (let k = 1; k < pts.length; k++) s.push((s[k - 1] as number) + (lens[k - 1] as number));
      let prev: Segment | null = null;
      for (let k = 0; k < pts.length - 1; k++) {
        const seg: Segment = {
          digit: i + 1,
          a: pts[k] as Vec3,
          axis: normalise(sub(pts[k + 1] as Vec3, pts[k] as Vec3)),
          len: lens[k] as number,
          s0: s[k] as number,
          prev,
          next: null,
        };
        if (prev) prev.next = seg;
        segments.push(seg);
        prev = seg;
      }
      sideJoints.push(s.slice(1));
    });
    joints.push(sideJoints);
    // The palm's plane: v from the wrist toward the middle finger's knuckle, u across toward the thumb.
    const wrist = (lines[0] as Vec3[])[0] as Vec3;
    const toMiddle = sub((lines[2] as Vec3[])[1] as Vec3, wrist);
    const vAxis = normalise(sub(toMiddle, palmDir.map((c) => c * dot(toMiddle, palmDir)) as Vec3));
    let uAxis = cross(palmDir, vAxis);
    if (dot(uAxis, sub((lines[0] as Vec3[])[2] as Vec3, wrist)) < 0)
      uAxis = [-uAxis[0], -uAxis[1], -uAxis[2]];
    const uv = (p: Vec3): [number, number] => [
      dot(sub(p, wrist), uAxis),
      dot(sub(p, wrist), vAxis),
    ];
    landmarks.push({
      knuckles: [2, 3, 4, 5].map((d) => uv((lines[d - 1] as Vec3[])[1] as Vec3)),
      thumbBase: uv((lines[0] as Vec3[])[1] as Vec3),
      thumbKnuckle: uv((lines[0] as Vec3[])[2] as Vec3),
    });
    const radSum = [0, 0, 0, 0, 0, 0];
    const radCount = [0, 0, 0, 0, 0, 0];
    for (let v = 0; v < n; v++) {
      if ((hand[v] as number) <= 0.01) continue;
      const x = P[v * 3] as number;
      if (Math.sign(x) !== sign) continue;
      const p: Vec3 = [x, P[v * 3 + 1] as number, P[v * 3 + 2] as number];
      let best = Number.POSITIVE_INFINITY;
      let pick = segments[0] as (typeof segments)[number];
      let t = 0;
      // The nearest segment (squared distance, no allocation: this runs for
      // every hand vertex against every segment).
      for (const seg of segments) {
        const [ax, ay, az] = seg.a;
        const [ux, uy, uz] = seg.axis;
        const dx = p[0] - ax;
        const dy = p[1] - ay;
        const dz = p[2] - az;
        const proj = dx * ux + dy * uy + dz * uz;
        const c = clamp(proj, 0, seg.len);
        const ex = dx - ux * c;
        const ey = dy - uy * c;
        const ez = dz - uz * c;
        const dist2 = ex * ex + ey * ey + ez * ez;
        if (dist2 < best) {
          best = dist2;
          pick = seg;
          t = proj;
        }
      }
      // Near a joint, blend the projections onto the segments either side of
      // it, so `along` and `across` run on smoothly round the bend. (Taking the
      // nearest segment's alone jumps by about the radius times the bend at
      // the bisector, which would draw a crease there.)
      const before = t < pick.len / 2 ? pick.prev : pick;
      const after = t < pick.len / 2 ? pick : pick.next;
      let origin = pick.a;
      let s0 = pick.s0;
      let axis = pick.axis;
      let along = pick.s0 + t;
      if (before && after) {
        origin = after.a;
        s0 = after.s0;
        const dj = sub(p, origin);
        const reach = 0.4 * Math.min(before.len, after.len);
        const w = smoothstep(
          -reach,
          reach,
          dot(dj, normalise(lerp3(before.axis, after.axis, 0.5))),
        );
        along = s0 + (1 - w) * dot(dj, before.axis) + w * dot(dj, after.axis);
        axis = normalise(lerp3(before.axis, after.axis, w));
      }
      const dj = sub(p, origin);
      const offset = sub(dj, axis.map((c) => c * dot(dj, axis)) as Vec3);
      const acrossDir = normalise(cross(axis, palmDir));
      frame.digit[v] = pick.digit;
      frame.along[v] = along;
      frame.across[v] = dot(offset, acrossDir);
      frame.volar[v] = dot(
        [N[v * 3] as number, N[v * 3 + 1] as number, N[v * 3 + 2] as number],
        palmDir,
      );
      frame.side[v] = sideIndex;
      const [u, w] = uv(p);
      frame.palm[v * 2] = u;
      frame.palm[v * 2 + 1] = w;
      // The last segment's radius: the fingertip's, where the nail lies.
      const tipJoints = sideJoints[pick.digit] as number[];
      if (along > (tipJoints[2] as number) + 0.002 && along < (tipJoints[3] as number) - 0.004) {
        radSum[pick.digit] = (radSum[pick.digit] as number) + length(offset);
        radCount[pick.digit] = (radCount[pick.digit] as number) + 1;
      }
    }
    radius.push(radSum.map((r, d) => (radCount[d] ? r / (radCount[d] as number) : 0)));
  });
  frame.joints = joints;
  frame.radius = radius;
  frame.landmarks = landmarks;
  frames.set(assets, frame);
  return frame;
}
