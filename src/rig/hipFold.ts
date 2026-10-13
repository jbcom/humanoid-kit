import type { BoneRotations, RestBones } from "./bones.ts";
import { boneMass, type FoldJoint, type JointFlexion } from "./jointFold.ts";
import { rotate } from "./quat.ts";

/**
 * The hip fold (docs/ARCHITECTURE.md, "The hip fold"): where a flexed hip's
 * thigh meets the trunk, the skin of the thigh's front swings into the skin of
 * the belly and passes through it, and the groin collapses into a slit. A real
 * body gives instead: the flesh of both is pressed flat against the other and
 * the fold between them is deep and smooth. The correction is a joint fold
 * (src/rig/jointFold.ts) of the hips, solved by `solveHipFold`; this module
 * holds what is the hip's own: its keys, how a pose flexes and opens it, which
 * hip drives a vertex, and the skin it moves and meets.
 */

/** The hip fold's terms. */
export const HIP_FOLD = {
  name: "hip",
  /** The bone that flexes: the thigh's upper half (left and right alike). */
  bone: "upperleg01",
  /** The bone whose turn the fold's displacements follow in a pose: none, the figure's root, for both hips (`jointTurns`). */
  above: null,
  /** The bone that carries on from the thigh's end, where the fold's reach ends (`FOLD_REACH`). */
  along: "lowerleg01",
  /**
   * Flexion, in degrees, below which the fold is nothing. The thigh's front
   * first reaches the belly's skin at about 55° (5 mm deep at 60°, 17 mm at
   * 80°), and the fold grows from nothing at this to its first key.
   */
  from: 30,
  /**
   * The fold is solved at every `step` degrees from `from` + `step` to `to`
   * (`solveHipFold`); between two a vertex's displacement is the straight line
   * between them, and past the last it stays. A contact begins abruptly, a
   * vertex going from clear to pressed in a few degrees, and a line from one
   * key to the next only lies on the safe side of it (too much push, never too
   * little) where the keys are close. A hip flexes about 135° at most; `to` is
   * a margin past it. Past it the thigh of a heavy body is wedged against a
   * belly that has nowhere to go, and no push out of one triangle is not a
   * push into the next.
   */
  step: 2.5,
  to: 140,
  keys: (140 - 30) / 2.5,
  /**
   * The fold is solved with the thighs together and again opened `opened`
   * degrees (the thigh swung out to its side), and read between the two by how
   * far a hip is opened, the last past it. A press solved with the thighs
   * together presses, in an opened pose, belly the thighs have left; solved
   * opened, it does not (see docs/ARCHITECTURE.md, "The hip fold"). CHOICE: the
   * deep squat's 20°, the widest a flexed hip opens in the pack's poses.
   */
  openings: 2,
  opened: 20,
} as const satisfies FoldJoint & { readonly along: string };

/** How many flexions the hip fold is solved at, for each opening. */
export const FOLD_KEYS = HIP_FOLD.keys;
/** How many openings the hip fold is solved at: the thighs together, and `HIP_FOLD.opened`. */
export const FOLD_OPENINGS = HIP_FOLD.openings;

/**
 * How far the hip bone `b` is flexed and opened, in degrees, for a rotation
 * made of an opening of the thigh (about its own z) and then a flexion (about
 * x), with any twist of the thigh about its own length (y) after: the squat's
 * hips (`Xrotation` -125, `Yrotation` 20 in its channels) are exactly that,
 * 125° and 20°. Where the rotation takes the thigh's up axis, (-sin a,
 * cos a cos f, cos a sin f) for an opening a and a flexion f, gives both: the
 * flexion is the axis's turn front to back, about x, whatever its opening, and
 * the opening how far it has left the figure's plane front to back. A twist
 * moves neither. Forward (the knee up) is a positive flexion, a turn about -x;
 * out to its own side a positive opening (`side` +1 for the left, -1 for the right).
 */
function anglesOf(rotations: BoneRotations, b: number, side: number): [number, number] {
  const [x, y, z] = rotate(
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
  const flexion = (-Math.atan2(z, y) * 180) / Math.PI;
  const opening = (Math.asin(Math.max(-1, Math.min(1, -side * x))) * 180) / Math.PI;
  return [flexion, opening];
}

/** How far each hip (`HIP_FOLD.bone`, left and right) is flexed and opened in a pose; 0 for a skeleton without it. */
export function hipFlexion(rest: RestBones, rotations: BoneRotations): JointFlexion {
  const of = (side: string, sign: number): [number, number] => {
    const b = rest.names.indexOf(`${HIP_FOLD.bone}.${side}`);
    return b < 0 ? [0, 0] : anglesOf(rotations, b, sign);
  };
  const [left, leftOpening] = of("L", 1);
  const [right, rightOpening] = of("R", -1);
  return { left, right, leftOpening, rightOpening };
}

/**
 * The rotation of a hip flexed `flexion` degrees and opened `opening` degrees to
 * its side (`side` +1 for the left, -1 for the right), as `hipFlexion` reads them.
 */
export function hipRotation(
  flexion: number,
  opening: number,
  side: number,
): [number, number, number, number] {
  // The flexion (about -x) after the opening (about z): qx · qz.
  const fx = Math.sin((-flexion * Math.PI) / 360);
  const fw = Math.cos((-flexion * Math.PI) / 360);
  const oz = Math.sin((side * opening * Math.PI) / 360);
  const ow = Math.cos((side * opening * Math.PI) / 360);
  return [fx * ow, -fx * oz, fw * oz, fw * ow];
}

/**
 * Per vertex of `positions` (the rest figure), how much of its fold the left
 * hip's flexion drives, the right's the rest (`foldAngles`). The thigh's skin
 * goes with its thighs, as the bones move it: the left thigh's share of what
 * the vertex holds on the two. The trunk's goes with the side of the body it
 * lies on, from all of it at the left hip joint to none at the right, smoothly,
 * so the belly the two thighs press is driven by the hip on its side, and both
 * hips' between them. Skin held by a thigh and the trunk mixes the two by how
 * much a thigh holds, all of it the thighs' from `FOLD_THIGH_HOLD` (the least
 * a thigh holds of the skin the fold pushes out), so the rule is one and smooth
 * over every vertex the fold moves, the thigh's and the trunk's.
 */
export function foldSides(
  rest: RestBones,
  positions: Float32Array,
  skinIndex: ArrayLike<number>,
  skinWeight: ArrayLike<number>,
): Float32Array {
  const n = positions.length / 3;
  const out = new Float32Array(n);
  const left = boneMass(rest.names, skinIndex, skinWeight, /^upperleg0[12]\.L$/);
  const right = boneMass(rest.names, skinIndex, skinWeight, /^upperleg0[12]\.R$/);
  const hipL = rest.names.indexOf(`${HIP_FOLD.bone}.L`);
  const hipR = rest.names.indexOf(`${HIP_FOLD.bone}.R`);
  const xL = hipL < 0 ? 1 : (rest.heads[hipL * 3] as number);
  const xR = hipR < 0 ? -1 : (rest.heads[hipR * 3] as number);
  for (let v = 0; v < n; v++) {
    const t = Math.min(1, Math.max(0, ((positions[v * 3] as number) - xR) / (xL - xR || 1)));
    const across = t * t * (3 - 2 * t);
    const l = left[v] as number;
    const held = l + (right[v] as number);
    const thighs = Math.min(1, held / FOLD_THIGH_HOLD);
    out[v] = thighs * (held > 0 ? l / held : 0) + (1 - thighs) * across;
  }
  return out;
}

/** The least weight on a thigh's bones of the skin the fold pushes out of the trunk (`foldParts`). */
export const FOLD_THIGH_HOLD = 0.25;

/**
 * How near a thigh's skin keeps the trunk's press, metres. CHOICE: at each key
 * the solve keeps the press whole where the thigh's skin is within `near` of the
 * trunk's (twice the 5 mm a contact leaves), and lets it go smoothly to nothing
 * at `far`: skin no thigh touches is not pressed.
 */
export const FOLD_PRESS = { near: 0.01, far: 0.03 } as const;

/**
 * How far from its hip the fold reaches along the thigh, as a share of the
 * thigh's length. Past it the skin is the knee's, whose bend is the pose's, and
 * a hip flexed with a straight leg is a pose that passes the leg through the body.
 * Half a thigh left the thigh's front, a hand's breadth below the groin, to go
 * through the belly of a tuck (the knees drawn up to the chest) unseen.
 */
export const FOLD_REACH = 1;

/**
 * Where, as a share of the thigh's length from its hip, the fold is at full
 * strength to: past it the displacement falls to nothing at `FOLD_REACH`, so
 * that the skin the fold ends on has no step in it (a seam down the thigh).
 */
export const FOLD_FULL_REACH = 0.7;

/**
 * Per vertex of `positions` (the rest figure), how much of its displacement the
 * fold keeps: 1 within `FOLD_FULL_REACH` of a hip, falling smoothly to 0 at
 * `FOLD_REACH`.
 */
export function foldTaper(rest: RestBones, positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length / 3);
  for (const side of [".L", ".R"]) {
    const hip = rest.names.indexOf(HIP_FOLD.bone + side);
    const knee = rest.names.indexOf(HIP_FOLD.along + side);
    if (hip < 0 || knee < 0) continue;
    const at = (b: number, k: number) => rest.heads[b * 3 + k] as number;
    const length = Math.hypot(
      at(knee, 0) - at(hip, 0),
      at(knee, 1) - at(hip, 1),
      at(knee, 2) - at(hip, 2),
    );
    for (let v = 0; v < out.length; v++) {
      const share =
        Math.hypot(
          (positions[v * 3] as number) - at(hip, 0),
          (positions[v * 3 + 1] as number) - at(hip, 1),
          (positions[v * 3 + 2] as number) - at(hip, 2),
        ) / length;
      const t = Math.min(1, Math.max(0, (FOLD_REACH - share) / (FOLD_REACH - FOLD_FULL_REACH)));
      out[v] = Math.max(out[v] as number, t * t * (3 - 2 * t));
    }
  }
  return out;
}

/**
 * How far (metres) behind the hip joint the groin's skin may be: the crotch
 * and the inner thigh lie level with the joint, and fold against the belly.
 */
export const FOLD_FRONT_MARGIN = 0.03;

/**
 * How far from a hip the trunk's skin the thigh may meet is taken, as a share
 * of the thigh's length: the belly and the flank, not the chest or the back.
 */
export const FOLD_TRUNK_REACH = 1;

/**
 * 1 for each vertex of `positions` (the rest figure) within `share` of the
 * thigh's length from a hip, else 0; with `front`, only those in front of the
 * hip joint (the fold is the groin's: the lateral and the back of the hip fold
 * against the flank and the buttock, which this does not make).
 */
export function nearHips(
  rest: RestBones,
  positions: Float32Array,
  share: number = FOLD_REACH,
  front = false,
): Uint8Array {
  const out = new Uint8Array(positions.length / 3);
  for (const side of [".L", ".R"]) {
    const hip = rest.names.indexOf(HIP_FOLD.bone + side);
    const knee = rest.names.indexOf(HIP_FOLD.along + side);
    if (hip < 0 || knee < 0) continue;
    const at = (b: number, k: number) => rest.heads[b * 3 + k] as number;
    const reach =
      share *
      Math.hypot(at(knee, 0) - at(hip, 0), at(knee, 1) - at(hip, 1), at(knee, 2) - at(hip, 2));
    for (let v = 0; v < out.length; v++)
      if (
        (!front || (positions[v * 3 + 2] as number) >= at(hip, 2) - FOLD_FRONT_MARGIN) &&
        Math.hypot(
          (positions[v * 3] as number) - at(hip, 0),
          (positions[v * 3 + 1] as number) - at(hip, 1),
          (positions[v * 3 + 2] as number) - at(hip, 2),
        ) < reach
      )
        out[v] = 1;
  }
  return out;
}

/** The bones the fold holds each vertex's mass on, by name: the thigh (what flexes) and the trunk (what it meets). */
export const FOLD_BODIES = {
  thigh: /^upperleg0[12]\./,
  trunk: /^(root|spine\d+|pelvis\.)/,
} as const;

/** The least weight on the trunk's bones a vertex needs to be the trunk's skin. */
export const TRUNK_SHARE = 0.2;

/** The two parts of a figure the fold keeps apart. */
export interface FoldParts {
  /** The thigh's skin by the hip, as the vertices that hold at least `thighShare` of their weight on the thigh bones, and more than the trunk's. */
  movers: Uint32Array;
  /** The thigh's mass per vertex. */
  thigh: Float32Array;
  /** The trunk's skin by the hips: the triangles whose corners hold at least half of their weight on the trunk's bones. */
  skin: Uint32Array;
}

/**
 * Splits a figure into the thigh's skin and the trunk's, near the hips: what
 * `solveHipFold` moves and what it moves it out of, and what the contact
 * measure of the tests reads. `tris` are the body's triangles.
 */
export function foldParts(
  rest: RestBones,
  control: Float32Array,
  skinIndex: ArrayLike<number>,
  skinWeight: ArrayLike<number>,
  tris: Uint32Array,
  thighShare: number,
  reach: number = FOLD_REACH,
): FoldParts {
  const n = control.length / 3;
  const thigh = boneMass(rest.names, skinIndex, skinWeight, FOLD_BODIES.thigh);
  const trunk = boneMass(rest.names, skinIndex, skinWeight, FOLD_BODIES.trunk);
  const inBody = new Uint8Array(n);
  for (const v of tris) inBody[v] = 1;
  const nearThigh = nearHips(rest, control, reach, true);
  const nearTrunk = nearHips(rest, control, FOLD_TRUNK_REACH);
  const movers: number[] = [];
  for (let v = 0; v < n; v++)
    if (
      inBody[v] &&
      nearThigh[v] &&
      (thigh[v] as number) >= thighShare &&
      (thigh[v] as number) > (trunk[v] as number)
    )
      movers.push(v);
  // The trunk's skin runs on into the seam, where the thigh's begins: every vertex the trunk holds as much of as the thigh, and some of.
  const trunkSkin = (v: number) =>
    nearTrunk[v] === 1 &&
    (trunk[v] as number) >= TRUNK_SHARE &&
    (trunk[v] as number) >= (thigh[v] as number);
  const skin: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]] as [number, number, number];
    if (trunkSkin(a) && trunkSkin(b) && trunkSkin(c)) skin.push(a, b, c);
  }
  return {
    movers: Uint32Array.from(movers),
    thigh,
    skin: Uint32Array.from(skin),
  };
}
