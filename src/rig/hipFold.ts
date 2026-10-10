import type { BoneRotations, RestBones } from "./bones.ts";
import { fromHalf, toHalf } from "./half.ts";
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
  /**
   * The opening (degrees, the thigh swung out to its side) of the fold's second
   * set of keys: the fold is solved with the thighs together and again opened so
   * far, and read between the two by how far a hip is opened (`addFold`), the
   * last past it. A press solved with the thighs together presses, in an opened
   * pose, belly the thighs have left; solved opened, it does not (see
   * docs/ARCHITECTURE.md, "The hip fold"). CHOICE: the deep squat's 20°, the
   * widest a flexed hip opens in the pack's poses.
   */
  opened: 20,
} as const;

/** How many flexions the fold is solved at, for each opening. */
export const FOLD_KEYS = (HIP_FOLD.to - HIP_FOLD.from) / HIP_FOLD.step;
/** How many openings the fold is solved at: the thighs together, and `HIP_FOLD.opened`. */
export const FOLD_OPENINGS = 2;

/** How far each hip is flexed and opened in a pose, in degrees (`hipFlexion`). */
export interface HipFlexion {
  left: number;
  right: number;
  leftOpening: number;
  rightOpening: number;
}

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
export function hipFlexion(rest: RestBones, rotations: BoneRotations): HipFlexion {
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

/** Whether either hip of the pose is flexed enough for the fold to show. */
export const folds = (hips: HipFlexion): boolean => Math.max(hips.left, hips.right) > HIP_FOLD.from;

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
 * A figure's hip fold: for each vertex of the base mesh the fold moves, each
 * opening it is solved at (`FOLD_OPENINGS`: the thighs together, and
 * `HIP_FOLD.opened`) and each flexion (`FOLD_KEYS` of them, `HIP_FOLD.step`
 * degrees apart from `from`), the displacement (metres) that puts the skin the
 * thigh holds against the trunk's instead of through it, added to the vertex as
 * the skin poses it with both hips so flexed and opened, and how the skin's
 * normal turns with it (the normal the displaced skin has less the one the bones
 * left it). Axes are the figure's own.
 */
export interface HipFold {
  /** The vertices the fold moves or turns, in the base mesh's numbering. */
  vertices: Uint32Array;
  /** Per vertex of the base mesh, its place in `vertices`, or -1 if the fold leaves it. */
  slot: Int32Array;
  /** Per moved vertex, per opening, per key, x, y, z: `vectors[((slot * FOLD_OPENINGS + opening) * FOLD_KEYS + key) * 3 + axis]`. */
  vectors: Float32Array;
  /** Per vertex, per opening, per key, x, y, z, as `vectors`: what is added to the skinned normal, before it is made a unit vector again. */
  normals: Float32Array;
  /** Per vertex, by slot: how much of it is the left hip's (`foldSides`), the right's the rest, which says the hip it is read by (`foldAngles`). */
  side: Float32Array;
}

/** A fold that moves nothing, for a mesh of `n` vertices. */
export const noFold = (n: number): HipFold => ({
  vertices: new Uint32Array(0),
  slot: new Int32Array(n).fill(-1),
  vectors: new Float32Array(0),
  normals: new Float32Array(0),
  side: new Float32Array(0),
});

/**
 * How near a thigh's skin keeps the trunk's press, metres. CHOICE: at each key
 * the solve keeps the press whole where the thigh's skin is within `near` of the
 * trunk's (twice the 5 mm a contact leaves), and lets it go smoothly to nothing
 * at `far`: skin no thigh touches is not pressed.
 */
export const FOLD_PRESS = { near: 0.01, far: 0.03 } as const;

/** 0 at or below `a`, 1 at or above `b`, smooth between. */
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The flexion and the opening vertex `v`'s fold is read at, by its side
 * (`HipFold.side`), or null where the fold leaves it: each hip's flexion counted
 * by twice the share of the vertex that is its side, to all of it from half, and
 * the greater of the two, with that hip's opening. Skin all one thigh's is read
 * by that hip; skin both thighs reach (the belly between the hips, the groin) by
 * the more flexed hip, for either thigh alone presses it as far as both do; and
 * between, the other hip counts for less, to nothing at its own side's edge.
 */
export function foldAngles(
  fold: HipFold,
  v: number,
  hips: HipFlexion,
): { flexion: number; opening: number } | null {
  const slot = fold.slot[v] as number;
  if (!(slot >= 0)) return null;
  const s = fold.side[slot] as number;
  const left = Math.min(1, 2 * s) * hips.left;
  const right = Math.min(1, 2 * (1 - s)) * hips.right;
  return left >= right
    ? { flexion: left, opening: hips.leftOpening }
    : { flexion: right, opening: hips.rightOpening };
}

/**
 * The value of `table` (a fold's `vectors` or `normals`) for slot `slot` at
 * flexion `flexion` and opening `opening` degrees, added to `out[at..at + 2]`.
 * By flexion: nothing up to `HIP_FOLD.from`, the first key's from there to that
 * key, then the straight line from key to key, and the last key's past it; by
 * opening: the straight line from the thighs together (no opening, or a thigh
 * drawn in across the body) to `HIP_FOLD.opened`, and that past it.
 */
function addKeyed(
  table: Float32Array,
  slot: number,
  flexion: number,
  opening: number,
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
  const open = Math.min(1, Math.max(0, opening / HIP_FOLD.opened));
  const value = (o: number, k: number) => {
    const base = (slot * FOLD_OPENINGS + o) * FOLD_KEYS * 3;
    const to = table[base + hi * 3 + k] as number;
    const was = i === 0 || i >= FOLD_KEYS ? 0 : (table[base + (i - 1) * 3 + k] as number);
    return i >= FOLD_KEYS ? to : was + (to - was) * along;
  };
  for (let k = 0; k < 3; k++)
    out[at + k] = (out[at + k] as number) + value(0, k) * (1 - open) + value(1, k) * open;
}

/** Vertex `v`'s displacement at flexion `flexion` and opening `opening` degrees (`foldAngles`), added to `out[at..at + 2]`. */
export function addFold(
  fold: HipFold,
  v: number,
  flexion: number,
  opening: number,
  out: Float32Array,
  at: number,
): void {
  addKeyed(fold.vectors, fold.slot[v] as number, flexion, opening, out, at);
}

/** What vertex `v`'s normal gains at flexion `flexion` and opening `opening` degrees, added to `out[at..at + 2]`. */
export function addFoldNormal(
  fold: HipFold,
  v: number,
  flexion: number,
  opening: number,
  out: Float32Array,
  at: number,
): void {
  addKeyed(fold.normals, fold.slot[v] as number, flexion, opening, out, at);
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
   * Row `r`, opening `o`, key `k`, as two texels: `((r * FOLD_OPENINGS + o) *
   * FOLD_KEYS + k) * 2` holds the displacement (x, y, z, 0) and the next the
   * normal's change (x, y, z, 0). A row is `FOLD_ROW_TEXELS` texels. Its first
   * texel holds the row's side (`HipFold.side`) in its fourth place:
   * `data[r * FOLD_ROW_TEXELS * 4 + 3]`. Each value a half float (`toHalf`'s
   * 16 bits), as the texture holds it, so that the CPU's fold (`renderFold`) is
   * the GPU's exactly; rounded, a displacement is within 2⁻¹¹ of the solve's.
   */
  data: Uint16Array;
}

/** Texels per row of a surface fold: two (a displacement and a normal's change) per key, per opening. */
export const FOLD_ROW_TEXELS = FOLD_OPENINGS * FOLD_KEYS * 2;

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
 * surface's positions are of their positions. Its side is the mix of the sides
 * of the control vertices the fold moves, by the same weights, over theirs
 * alone (the others add nothing to the displacement, so they have no side).
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
  const keys = FOLD_OPENINGS * FOLD_KEYS;
  const data = new Float32Array(rows * keys * 8);
  for (let s = 0; s < surfaceVertices; s++) {
    const row = rowOf[s] as number;
    if (row < 0) continue;
    let side = 0;
    let held = 0;
    for (let e = stencil.offsets[s] as number; e < (stencil.offsets[s + 1] as number); e++) {
      const slot = fold.slot[stencil.src[e] as number] as number;
      if (slot < 0) continue;
      const w = stencil.weights[e] as number;
      side += w * (fold.side[slot] as number);
      held += w;
      for (let key = 0; key < keys; key++)
        for (let k = 0; k < 3; k++) {
          const at = (row * keys + key) * 8 + k;
          const from = (slot * keys + key) * 3 + k;
          data[at] = (data[at] as number) + w * (fold.vectors[from] as number);
          data[at + 4] = (data[at + 4] as number) + w * (fold.normals[from] as number);
        }
    }
    data[row * keys * 8 + 3] = held > 0 ? side / held : 0;
  }
  const slot = Float32Array.from(renderToSurface, (s) => rowOf[s] as number);
  return { slot, rows, data: Uint16Array.from(data, toHalf) };
}

/**
 * A surface's fold (`surfaceFold`) as a fold over its render vertices, for
 * skinning them on the CPU (`skinPositions`) exactly as the shader does with
 * the same rows.
 */
export function renderFold(fold: SurfaceFold): HipFold {
  const slot = Int32Array.from(fold.slot);
  const vertices = Uint32Array.from(
    Array.from(slot.keys()).filter((v) => (slot[v] as number) >= 0),
  );
  const keys = FOLD_OPENINGS * FOLD_KEYS;
  const vectors = new Float32Array(fold.rows * keys * 3);
  const normals = new Float32Array(fold.rows * keys * 3);
  const side = new Float32Array(fold.rows);
  for (let r = 0; r < fold.rows; r++) {
    side[r] = fromHalf(fold.data[r * keys * 8 + 3] as number);
    for (let key = 0; key < keys; key++)
      for (let k = 0; k < 3; k++) {
        const from = (r * keys + key) * 8 + k;
        vectors[(r * keys + key) * 3 + k] = fromHalf(fold.data[from] as number);
        normals[(r * keys + key) * 3 + k] = fromHalf(fold.data[from + 4] as number);
      }
  }
  return { vertices, slot, vectors, normals, side };
}
