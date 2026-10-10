/**
 * A joint's fold (docs/ARCHITECTURE.md, "The hip fold", "The knee fold"): where
 * a joint bends far, skinning alone sends one part's skin through another's
 * (the thigh's through the belly at the hip, the calf's through the thigh's at
 * the knee) or folds the skin at the joint over itself. A real body gives
 * instead. The correction is a displacement of the skin round the joint, solved
 * once per figure at a run of flexions (the joint's keys, at each of its
 * openings) by `solveFold` (src/rig/foldSolve.ts), and read at the flexion a pose
 * has, added to the skinned vertex. What is particular to a joint (which bone
 * flexes, the skin that moves and the skin it meets, which side drives a
 * vertex) is the joint's own module's: src/rig/hipFold.ts, src/rig/kneeFold.ts.
 */
import { fromHalf, toHalf } from "./half.ts";

/** A joint fold's keys: the flexions (and openings) it is solved at and read between. */
export interface FoldJoint {
  /** Which joint: what a fold is read by. */
  readonly name: "hip" | "knee";
  /** The bone that flexes, without its side (`.L`, `.R`). */
  readonly bone: string;
  /**
   * The bone, without its side, whose turn in a pose each side's displacements
   * follow (they are solved with it at rest), or null for the figure's root.
   */
  readonly above: string | null;
  /** Flexion, in degrees, below which the fold is nothing; it grows from nothing here to its first key. */
  readonly from: number;
  /**
   * The fold is solved at every `step` degrees from `from` + `step` to `to`;
   * between two a vertex's displacement is the straight line between them, and
   * past the last it stays.
   */
  readonly step: number;
  readonly to: number;
  /** How many flexions: `(to - from) / step`. */
  readonly keys: number;
  /**
   * How many openings (the limb swung out to its side) each flexion is solved
   * at: 1, or 2 (closed, and `opened` degrees), read between the two by how far
   * the joint is opened, the last past it.
   */
  readonly openings: number;
  readonly opened: number;
}

/**
 * A figure's fold at one joint: for each vertex of the mesh it moves, each
 * opening and each flexion of `joint`, the displacement (metres) added to the
 * vertex as the skin poses it so flexed and opened, and how the skin's normal
 * turns with it (the normal the displaced skin has less the one the bones left
 * it). Axes are the figure's own.
 */
export interface JointFold {
  /** The keys the tables are laid out by. */
  joint: FoldJoint;
  /** The vertices the fold moves or turns, in the mesh's numbering. */
  vertices: Uint32Array;
  /** Per vertex of the mesh, its place in `vertices`, or -1 if the fold leaves it. */
  slot: Int32Array;
  /** Per moved vertex, per opening, per key, x, y, z: `vectors[((slot * openings + opening) * keys + key) * 3 + axis]`. */
  vectors: Float32Array;
  /** Per vertex, per opening, per key, x, y, z, as `vectors`: what is added to the skinned normal, before it is made a unit vector again. */
  normals: Float32Array;
  /** Per vertex, by slot: how much of it is the left joint's, the right's the rest, which says the joint it is read by. */
  side: Float32Array;
}

/** A fold of `joint` that moves nothing, for a mesh of `n` vertices. */
export const noFold = (n: number, joint: FoldJoint): JointFold => ({
  joint,
  vertices: new Uint32Array(0),
  slot: new Int32Array(n).fill(-1),
  vectors: new Float32Array(0),
  normals: new Float32Array(0),
  side: new Float32Array(0),
});

/** How far each side's joint is flexed and opened in a pose, in degrees (`hipFlexion`, `kneeFlexion`). */
export interface JointFlexion {
  left: number;
  right: number;
  leftOpening: number;
  rightOpening: number;
}

/** Whether either side's joint is flexed past where `joint`'s fold starts. */
export const flexedPast = (joint: FoldJoint, flexion: JointFlexion): boolean =>
  Math.max(flexion.left, flexion.right) > joint.from;

/**
 * The flexion and the opening vertex `v`'s fold is read at, by its side
 * (`JointFold.side`), or null where the fold leaves it: each side's flexion
 * counted by twice the share of the vertex that is its side, to all of it from
 * half, and the greater of the two, with that side's opening. Skin all one
 * side's is read by that side's joint; skin both reach (the belly between the
 * hips, the groin) by the more flexed, for either alone presses it as far as
 * both do; and between, the other side counts for less, to nothing at its own
 * side's edge.
 */
export function foldAngles(
  fold: JointFold,
  v: number,
  flexion: JointFlexion,
): { flexion: number; opening: number; left: boolean } | null {
  const slot = fold.slot[v] as number;
  if (!(slot >= 0)) return null;
  const s = fold.side[slot] as number;
  const left = Math.min(1, 2 * s) * flexion.left;
  const right = Math.min(1, 2 * (1 - s)) * flexion.right;
  return left >= right
    ? { flexion: left, opening: flexion.leftOpening, left: true }
    : { flexion: right, opening: flexion.rightOpening, left: false };
}

/** 0 at or below `a`, 1 at or above `b`, smooth between. */
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Values a key holds per vertex: three, each of `vectors` and `normals`. */
const keyCount = (joint: FoldJoint) => joint.openings * joint.keys;

/**
 * The value of `table` (a fold's `vectors` or `normals`) for slot `slot` at
 * flexion `flexion` and opening `opening` degrees, added to `out[at..at + 2]`.
 * By flexion: nothing up to `from`, the first key's from there to that key,
 * then the straight line from key to key, and the last key's past it; by
 * opening: the straight line from closed (no opening, or a limb drawn in
 * across the body) to `opened`, and that past it.
 */
function addKeyed(
  joint: FoldJoint,
  table: Float32Array,
  slot: number,
  flexion: number,
  opening: number,
  out: Float32Array,
  at: number,
): void {
  if (slot < 0) return;
  const t = (flexion - joint.from) / joint.step;
  if (!(t > 0)) return;
  const keys = joint.keys;
  // Key `j` is at t = j + 1; t between i and i + 1 lies between keys i - 1 and i (key -1 being nothing).
  const i = Math.min(Math.floor(t), keys);
  const along = i >= keys ? 1 : t - i;
  const hi = Math.min(i, keys - 1);
  const open = joint.openings > 1 ? Math.min(1, Math.max(0, opening / joint.opened)) : 0;
  const value = (o: number, k: number) => {
    const base = (slot * joint.openings + o) * keys * 3;
    const to = table[base + hi * 3 + k] as number;
    const was = i === 0 || i >= keys ? 0 : (table[base + (i - 1) * 3 + k] as number);
    return i >= keys ? to : was + (to - was) * along;
  };
  for (let k = 0; k < 3; k++)
    out[at + k] =
      (out[at + k] as number) +
      (joint.openings > 1 ? value(0, k) * (1 - open) + value(1, k) * open : value(0, k));
}

/** Vertex `v`'s displacement at flexion `flexion` and opening `opening` degrees, added to `out[at..at + 2]`. */
export function addFold(
  fold: JointFold,
  v: number,
  flexion: number,
  opening: number,
  out: Float32Array,
  at: number,
): void {
  addKeyed(fold.joint, fold.vectors, fold.slot[v] as number, flexion, opening, out, at);
}

/** What vertex `v`'s normal gains at flexion `flexion` and opening `opening` degrees, added to `out[at..at + 2]`. */
export function addFoldNormal(
  fold: JointFold,
  v: number,
  flexion: number,
  opening: number,
  out: Float32Array,
  at: number,
): void {
  addKeyed(fold.joint, fold.normals, fold.slot[v] as number, flexion, opening, out, at);
}

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

/**
 * A joint fold on one rendered surface, for the renderer: the fold's vertices
 * of the surface's own (the surface is the base body subdivided, so a vertex
 * of it lies among control vertices that the fold moves), and what to add at
 * each flexion.
 */
export interface SurfaceFold {
  /** The keys the rows are laid out by. */
  joint: FoldJoint;
  /** Per render vertex, its row in `data`, or -1 where the fold leaves it. */
  slot: Float32Array;
  /** How many rows `data` has. */
  rows: number;
  /**
   * Row `r`, opening `o`, key `k`, as two texels: `((r * openings + o) * keys +
   * k) * 2` holds the displacement (x, y, z, 0) and the next the normal's
   * change (x, y, z, 0). A row is `rowTexels(joint)` texels. Its first texel
   * holds the row's side (`JointFold.side`) in its fourth place:
   * `data[r * rowTexels(joint) * 4 + 3]`. Each value a half float (`toHalf`'s
   * 16 bits), as the texture holds it, so that the CPU's fold (`renderFold`) is
   * the GPU's exactly; rounded, a displacement is within 2⁻¹¹ of the solve's.
   */
  data: Uint16Array;
}

/** Texels per row of a surface fold of `joint`: two (a displacement and a normal's change) per key, per opening. */
export const rowTexels = (joint: FoldJoint): number => joint.openings * joint.keys * 2;

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
  fold: JointFold,
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
  const keys = keyCount(fold.joint);
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
  return { joint: fold.joint, slot, rows, data: Uint16Array.from(data, toHalf) };
}

/**
 * A surface's fold (`surfaceFold`) as a fold over its render vertices, for
 * skinning them on the CPU (`skinPositions`) exactly as the shader does with
 * the same rows.
 */
export function renderFold(fold: SurfaceFold): JointFold {
  const slot = Int32Array.from(fold.slot);
  const vertices = Uint32Array.from(
    Array.from(slot.keys()).filter((v) => (slot[v] as number) >= 0),
  );
  const keys = keyCount(fold.joint);
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
  return { joint: fold.joint, vertices, slot, vectors, normals, side };
}
