import type { BoneRotations, RestBones } from "./bones.ts";
import { rotate } from "./quat.ts";

/**
 * The hip fold (docs/ARCHITECTURE.md, "The hip fold"): where a flexed hip's
 * thigh meets the trunk, the skin of the thigh's front swings into the skin of
 * the belly and passes through it, and the groin collapses into a slit. A real
 * body gives instead: the flesh of both is pressed flat against the other and
 * the fold between them is deep and smooth. The correction is a displacement of
 * the skin around the hip, found once per figure at a few flexions
 * (`solveHipFold`) and read at the flexion a pose has (`foldAt`), added to the
 * skinned vertex.
 */

/** The fold's terms. */
export const HIP_FOLD = {
  /** The bone that flexes: the thigh's upper half (left and right alike). */
  bone: "upperleg01",
  /** The bone that carries on from the thigh's end, where the fold's reach ends (`FOLD_REACH`). */
  along: "lowerleg01",
  /** Bones that carry on from the thigh's, and are flexed with it (the thigh's lower half). */
  follows: ["upperleg02"],
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
} as const;

/** How many flexions the fold is solved at. */
export const FOLD_KEYS = (HIP_FOLD.to - HIP_FOLD.from) / HIP_FOLD.step;

/** How far each bone's hip is flexed, and which bones are the thigh's, in a pose. */
export interface HipPose {
  /** Per bone, degrees of flexion (0 for a bone that is not the thigh's, or that does not flex). */
  flexion: Float32Array;
  /** Per bone, 1 for the thigh's bones (`HIP_FOLD.bone`, `follows`), 0 otherwise. */
  thigh: Uint8Array;
}

/**
 * How far the hip bone `b` is flexed, in degrees: the turn about the figure's
 * side-to-side axis (x) that a rotation made of an opening of the leg (about
 * z), then a flexion (about x), then a twist of the thigh (about y), as the
 * poses' channels are ("Zrotation Xrotation Yrotation", `bodyPoseRotations`),
 * has in it. A twist leaves the thigh's up axis where it was, and an opening
 * only swings it from side to side, so neither moves its height out of the
 * figure's plane front to back, which is what flexion is. Forward (the knee up)
 * is positive, a turn about -x.
 */
function flexionOf(rotations: BoneRotations, b: number): number {
  // Where the bone's rotation takes the up axis: (-sin a cos f, cos a cos f, sin f) for an opening a and a flexion f.
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
  // cos f is the length of (x, y), signed as y is while the opening is under a right angle, which lets f pass 90°.
  const flexion = Math.atan2(z, y < 0 ? -Math.hypot(x, y) : Math.hypot(x, y));
  return (-flexion * 180) / Math.PI;
}

/** The thigh's bones, by index, and each one's hip bone: `bone` for the hip bone itself, its hip bone for a follower. */
export function thighBones(rest: RestBones): { thigh: Uint8Array; hip: Int16Array } {
  const thigh = new Uint8Array(rest.names.length);
  const hip = new Int16Array(rest.names.length).fill(-1);
  rest.names.forEach((name, b) => {
    if (!name.startsWith(`${HIP_FOLD.bone}.`)) return;
    const suffix = name.slice(HIP_FOLD.bone.length);
    thigh[b] = 1;
    hip[b] = b;
    for (const f of HIP_FOLD.follows) {
      const follower = rest.names.indexOf(f + suffix);
      if (follower >= 0) {
        thigh[follower] = 1;
        hip[follower] = b;
      }
    }
  });
  return { thigh, hip };
}

/** How far each hip is flexed in a pose: each thigh bone carries its hip's flexion. */
export function hipPose(rest: RestBones, rotations: BoneRotations): HipPose {
  const { thigh, hip } = thighBones(rest);
  const flexion = new Float32Array(rest.names.length);
  hip.forEach((h, b) => {
    if (h >= 0) flexion[b] = flexionOf(rotations, h);
  });
  return { flexion, thigh };
}

/** Whether any hip of the pose is flexed enough for the fold to show. */
export const folds = (pose: HipPose): boolean => pose.flexion.some((f) => f > HIP_FOLD.from);

/**
 * A figure's hip fold: for each vertex of the base mesh the fold moves, and
 * each flexion it is solved at (`FOLD_KEYS` of them, `HIP_FOLD.step` degrees
 * apart from `from`), the displacement (metres) that puts the skin the thigh
 * holds against the trunk's instead of through it, added to the vertex as the
 * skin poses it with both hips flexed so far, and how the skin's normal turns
 * with it (the normal the displaced skin has less the one the bones left it).
 * Axes are the figure's own.
 */
export interface HipFold {
  /** The vertices the fold moves or turns, in the base mesh's numbering. */
  vertices: Uint32Array;
  /** Per vertex of the base mesh, its place in `vertices`, or -1 if the fold leaves it. */
  slot: Int32Array;
  /** Per moved vertex, per key, x, y, z: `vectors[(slot * FOLD_KEYS + key) * 3 + axis]`. */
  vectors: Float32Array;
  /** Per vertex, per key, x, y, z, as `vectors`: what is added to the skinned normal, before it is made a unit vector again. */
  normals: Float32Array;
}

/** A fold that moves nothing, for a mesh of `n` vertices. */
export const noFold = (n: number): HipFold => ({
  vertices: new Uint32Array(0),
  slot: new Int32Array(n).fill(-1),
  vectors: new Float32Array(0),
  normals: new Float32Array(0),
});

/**
 * The value of `table` (a fold's `vectors` or `normals`) for slot `slot` at
 * flexion `flexion` degrees, added to `out[at..at + 2]`: nothing up to
 * `HIP_FOLD.from`, the first key's from there to that key, then the straight
 * line from key to key, and the last key's past it.
 */
function addKeyed(
  table: Float32Array,
  slot: number,
  flexion: number,
  out: Float32Array,
  at: number,
): void {
  if (slot < 0) return;
  const t = (flexion - HIP_FOLD.from) / HIP_FOLD.step;
  if (!(t > 0)) return;
  // Key `j` is at t = j + 1; t between i and i + 1 lies between keys i - 1 and i (key -1 being nothing).
  const i = Math.min(Math.floor(t), FOLD_KEYS);
  const along = i >= FOLD_KEYS ? 1 : t - i;
  const hi = Math.min(i, FOLD_KEYS - 1);
  const base = slot * FOLD_KEYS * 3;
  for (let k = 0; k < 3; k++) {
    const to = table[base + hi * 3 + k] as number;
    const was = i === 0 || i >= FOLD_KEYS ? 0 : (table[base + (i - 1) * 3 + k] as number);
    out[at + k] = (out[at + k] as number) + (i >= FOLD_KEYS ? to : was + (to - was) * along);
  }
}

/** Vertex `v`'s displacement at flexion `flexion` degrees, added to `out[at..at + 2]`. */
export function addFold(
  fold: HipFold,
  v: number,
  flexion: number,
  out: Float32Array,
  at: number,
): void {
  addKeyed(fold.vectors, fold.slot[v] as number, flexion, out, at);
}

/** What vertex `v`'s normal gains at flexion `flexion` degrees, added to `out[at..at + 2]`. */
export function addFoldNormal(
  fold: HipFold,
  v: number,
  flexion: number,
  out: Float32Array,
  at: number,
): void {
  addKeyed(fold.normals, fold.slot[v] as number, flexion, out, at);
}

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

/** Each vertex's skin weight on the bones whose names `test` accepts. */
export function boneMass(
  names: readonly string[],
  skinIndex: ArrayLike<number>,
  skinWeight: ArrayLike<number>,
  test: RegExp,
): Float32Array {
  const wanted = names.map((n) => test.test(n));
  const out = new Float32Array(skinWeight.length / 4);
  for (let v = 0; v < out.length; v++) {
    let mass = 0;
    for (let k = 0; k < 4; k++)
      if (wanted[skinIndex[v * 4 + k] as number]) mass += skinWeight[v * 4 + k] as number;
    out[v] = mass;
  }
  return out;
}

/** The least weight on the trunk's bones a vertex needs to be the trunk's skin. */
const TRUNK_SHARE = 0.2;

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

/**
 * A figure's hip fold on one rendered surface, for the renderer: the fold's
 * vertices of the surface's own (the surface is the base body subdivided, so
 * a vertex of it lies among control vertices that the fold moves), and what
 * to add at each flexion.
 */
export interface SurfaceFold {
  /** Per render vertex, its row in `data`, or -1 where the fold leaves it. */
  slot: Float32Array;
  /** How many rows `data` has. */
  rows: number;
  /**
   * Row `r`, key `k`, as two texels: `(r * FOLD_KEYS + k) * 2` holds the
   * displacement (x, y, z, 0) and the next the normal's change (x, y, z, 0).
   */
  data: Float32Array;
}

/** The part of a subdivision stencil `surfaceFold` reads: row `s` mixes `src[offsets[s]..offsets[s + 1]]` by `weights`. */
export interface StencilRows {
  offsets: ArrayLike<number>;
  src: ArrayLike<number>;
  weights: ArrayLike<number>;
}

/**
 * `fold`, which is per control vertex, on the render vertices of a surface
 * built from the control mesh by `stencil` (one row per surface vertex), with
 * `renderToSurface` saying which surface vertex each render vertex is: each
 * row is the stencil's mix of the control vertices' displacements, as the
 * surface's positions are of their positions.
 */
export function surfaceFold(
  fold: HipFold,
  stencil: StencilRows,
  renderToSurface: ArrayLike<number>,
): SurfaceFold {
  const surfaceVertices = stencil.offsets.length - 1;
  const rowOf = new Int32Array(surfaceVertices).fill(-1);
  let rows = 0;
  for (let s = 0; s < surfaceVertices; s++)
    for (let e = stencil.offsets[s] as number; e < (stencil.offsets[s + 1] as number); e++)
      if ((fold.slot[stencil.src[e] as number] as number) >= 0) {
        rowOf[s] = rows++;
        break;
      }
  const data = new Float32Array(rows * FOLD_KEYS * 8);
  for (let s = 0; s < surfaceVertices; s++) {
    const row = rowOf[s] as number;
    if (row < 0) continue;
    for (let e = stencil.offsets[s] as number; e < (stencil.offsets[s + 1] as number); e++) {
      const slot = fold.slot[stencil.src[e] as number] as number;
      if (slot < 0) continue;
      const w = stencil.weights[e] as number;
      for (let key = 0; key < FOLD_KEYS; key++)
        for (let k = 0; k < 3; k++) {
          const at = (row * FOLD_KEYS + key) * 8 + k;
          const from = (slot * FOLD_KEYS + key) * 3 + k;
          data[at] = (data[at] as number) + w * (fold.vectors[from] as number);
          data[at + 4] = (data[at + 4] as number) + w * (fold.normals[from] as number);
        }
    }
  }
  const slot = Float32Array.from(renderToSurface, (s) => rowOf[s] as number);
  return { slot, rows, data };
}
