import type { BoneRotations, RestBones } from "./bones.ts";
import { boneMass, type FoldJoint, type JointFlexion } from "./jointFold.ts";
import { rotate } from "./quat.ts";

/**
 * The knee fold (docs/ARCHITECTURE.md, "The knee fold"): a knee bent to a right
 * angle collapses the skin at its back through itself, the bones carrying the
 * calf's skin and the thigh's toward each other faster than skinning's blend
 * can move the skin between them; bent further, the calf presses into the back
 * of the thigh and through it. A real knee folds the skin at its back into a
 * smooth crease, and calf and thigh give where they meet. The correction is a
 * joint fold (src/rig/jointFold.ts) keyed by the knee's flexion, solved by
 * `solveKneeFold` (src/rig/kneeFoldSolve.ts) as the hip's is: the calf's skin
 * pushed out of the thigh's, the thigh's giving its share, the skin folded
 * over itself smoothed out. This module holds what is the knee's own.
 */

/** The knee fold's terms. */
export const KNEE_FOLD = {
  name: "knee",
  /** The bone that flexes: the shin's upper half. */
  bone: "lowerleg01",
  /** The bone above it, whose turn the fold's displacements follow in a pose: the thigh's lower half. */
  above: "upperleg02",
  /**
   * Flexion, in degrees, below which the fold is nothing. The back of the knee
   * turns its first triangles over between 45° and 60° in the nine bodies of
   * the tests (2026-10-10), and the fold grows from nothing at this to its first key.
   */
  from: 30,
  /**
   * Solved every `step` degrees from `from` + `step` to `to`, as the hip's: a
   * contact begins abruptly, and a line between close keys stays on its safe
   * side. A knee bends about 150° at most (the pack's deep squat); `to` is a
   * margin past it.
   */
  step: 2.5,
  to: 155,
  keys: (155 - 30) / 2.5,
  /** A knee only bends: one set of keys. */
  openings: 1,
  opened: 0,
} as const satisfies FoldJoint;

/**
 * How far knee `b` is bent, in degrees, for a rotation about x with any turn
 * about the shin's own length after: where the rotation takes the shin's up
 * axis, its turn front to back. The heel back (a positive turn about +x) is a
 * positive flexion.
 */
function flexionOf(rotations: BoneRotations, b: number): number {
  const [, y, z] = rotate(
    [
      rotations[b * 4] as number,
      rotations[b * 4 + 1] as number,
      rotations[b * 4 + 2] as number,
      rotations[b * 4 + 3] as number,
    ],
    0,
    1,
    0,
  );
  return (Math.atan2(z, y) * 180) / Math.PI;
}

/** How far each knee (`KNEE_FOLD.bone`) is bent in a pose; 0 for a skeleton without it. A knee does not open. */
export function kneeFlexion(rest: RestBones, rotations: BoneRotations): JointFlexion {
  const of = (side: string) => {
    const b = rest.names.indexOf(`${KNEE_FOLD.bone}.${side}`);
    return b < 0 ? 0 : flexionOf(rotations, b);
  };
  return { left: of("L"), right: of("R"), leftOpening: 0, rightOpening: 0 };
}

/** The rotation of a knee bent `flexion` degrees, as `kneeFlexion` reads it. */
export function kneeRotation(flexion: number): [number, number, number, number] {
  const h = (flexion * Math.PI) / 360;
  return [Math.sin(h), 0, 0, Math.cos(h)];
}

/** The bones of a leg, by side, whose weight says which leg's knee drives a vertex. */
const LEG = {
  L: /^(upperleg|lowerleg|foot|toe)\d*\.L$/,
  R: /^(upperleg|lowerleg|foot|toe)\d*\.R$/,
};

/**
 * Per vertex, how much of its fold the left knee drives, the right's the rest:
 * the left leg's share of what the vertex holds on the two legs, and by which
 * side of the body it lies where it holds on neither.
 */
export function kneeSides(
  rest: RestBones,
  positions: Float32Array,
  skinIndex: ArrayLike<number>,
  skinWeight: ArrayLike<number>,
): Float32Array {
  const left = boneMass(rest.names, skinIndex, skinWeight, LEG.L);
  const right = boneMass(rest.names, skinIndex, skinWeight, LEG.R);
  const out = new Float32Array(positions.length / 3);
  for (let v = 0; v < out.length; v++) {
    const held = (left[v] as number) + (right[v] as number);
    out[v] = held > 0 ? (left[v] as number) / held : (positions[v * 3] as number) > 0 ? 1 : 0;
  }
  return out;
}

/**
 * How far from a knee joint, as a share of the thigh's length (the hip's head
 * to the knee's), the fold reaches up the thigh and down the calf. A knee bent
 * to 150° lays the calf along the back of the thigh about half way to the hip
 * (the calf's contact reaches 0.55 of a thigh, measured on the nine bodies,
 * 2026-10-10).
 */
export const KNEE_REACH = 0.85;
/** Where the fold is at full strength to: past it the displacement falls smoothly to nothing at `KNEE_REACH`. */
export const KNEE_FULL_REACH = 0.6;

/** Each side's knee joint and the thigh's length, for the skeleton `rest`. */
function knees(rest: RestBones): { at: [number, number, number]; thigh: number }[] {
  const out: { at: [number, number, number]; thigh: number }[] = [];
  for (const side of [".L", ".R"]) {
    const hip = rest.names.indexOf(`upperleg01${side}`);
    const knee = rest.names.indexOf(`${KNEE_FOLD.bone}${side}`);
    if (hip < 0 || knee < 0) continue;
    const head = (b: number) =>
      [0, 1, 2].map((k) => rest.heads[b * 3 + k] as number) as [number, number, number];
    const [h, k] = [head(hip), head(knee)];
    out.push({ at: k, thigh: Math.hypot(k[0] - h[0], k[1] - h[1], k[2] - h[2]) });
  }
  return out;
}

/** Per vertex of `positions`, its distance from the nearer knee joint as a share of that thigh's length. */
export function kneeShare(rest: RestBones, positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length / 3).fill(Number.POSITIVE_INFINITY);
  for (const { at, thigh } of knees(rest))
    for (let v = 0; v < out.length; v++)
      out[v] = Math.min(
        out[v] as number,
        Math.hypot(
          (positions[v * 3] as number) - at[0],
          (positions[v * 3 + 1] as number) - at[1],
          (positions[v * 3 + 2] as number) - at[2],
        ) / thigh,
      );
  return out;
}

/** Per vertex, how much of its displacement the knee fold keeps: 1 within `KNEE_FULL_REACH` of a knee, falling smoothly to 0 at `KNEE_REACH`. */
export function kneeTaper(rest: RestBones, positions: Float32Array): Float32Array {
  return Float32Array.from(kneeShare(rest, positions), (share) => {
    const t = Math.min(1, Math.max(0, (KNEE_REACH - share) / (KNEE_REACH - KNEE_FULL_REACH)));
    return t * t * (3 - 2 * t);
  });
}

/** The bones the knee fold holds each vertex's mass on: the shin (what bends) and the thigh (what it meets). */
export const KNEE_BODIES = {
  shin: /^lowerleg0[12]\./,
  thigh: /^upperleg0[12]\./,
} as const;

/**
 * The least weight on the shin's bones of the calf skin the fold moves, and on
 * the thigh's of the thigh skin it moves the calf out of. CHOICE: as the hip's
 * (`FOLD_THIGH_HOLD`, `TRUNK_SHARE`), so the two run into the seam between them.
 */
export const KNEE_SHIN_HOLD = 0.25;
export const KNEE_THIGH_SHARE = 0.2;

/** The two parts of a leg the knee fold keeps apart. */
export interface KneeParts {
  /** The calf's skin by the knee: vertices holding at least `KNEE_SHIN_HOLD` on the shin, and more than on the thigh. */
  calf: Uint32Array;
  /** The thigh's skin by the knee, as triangles whose corners hold at least `KNEE_THIGH_SHARE` on the thigh, and as much as on the shin. */
  thigh: Uint32Array;
  /** The calf's skin by the knee, all of it, as triangles: what the thigh's press must be near. */
  calfSkin: Uint32Array;
}

/** Splits the legs by the knees into the calf's skin and the thigh's: what `solveKneeFold` moves, and what out of. */
export function kneeParts(
  rest: RestBones,
  control: Float32Array,
  skinIndex: ArrayLike<number>,
  skinWeight: ArrayLike<number>,
  tris: Uint32Array,
): KneeParts {
  const n = control.length / 3;
  const shin = boneMass(rest.names, skinIndex, skinWeight, KNEE_BODIES.shin);
  const thigh = boneMass(rest.names, skinIndex, skinWeight, KNEE_BODIES.thigh);
  const share = kneeShare(rest, control);
  const near = (v: number) => (share[v] as number) < KNEE_REACH;
  const inBody = new Uint8Array(n);
  for (const v of tris) inBody[v] = 1;
  const isCalf = (v: number) =>
    near(v) && (shin[v] as number) >= KNEE_SHIN_HOLD && (shin[v] as number) > (thigh[v] as number);
  const calf: number[] = [];
  for (let v = 0; v < n; v++) if (inBody[v] && isCalf(v)) calf.push(v);
  const isThigh = (v: number) =>
    near(v) &&
    (thigh[v] as number) >= KNEE_THIGH_SHARE &&
    (thigh[v] as number) >= (shin[v] as number);
  const calfAll = (v: number) => near(v) && (shin[v] as number) > (thigh[v] as number);
  const thighTris: number[] = [];
  const calfTris: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const corners = [tris[t], tris[t + 1], tris[t + 2]] as [number, number, number];
    if (corners.every(isThigh)) thighTris.push(...corners);
    if (corners.every(calfAll)) calfTris.push(...corners);
  }
  return {
    calf: Uint32Array.from(calf),
    thigh: Uint32Array.from(thighTris),
    calfSkin: Uint32Array.from(calfTris),
  };
}
