/**
 * The skin weights of a figure's adult surface as its detail has drawn it: a
 * reservoir's vertices take their root's weights as far as the organ has pushed
 * them out from rest (docs/ARCHITECTURE.md, "Reservoir skinning").
 *
 * A reservoir's rings are copies of its loop's vertices, with the loop's weights,
 * and its cap keeps the weights of the skin it covers (src/build/reservoir.ts), so
 * collapsed it bends exactly as the skin it lies on. Drawn out into an organ, the
 * same weights are wrong: every ring holds the whole loop's spread of weights round
 * it, and the cap the spread of the disc it covered, so a small organ carries the
 * weights of a disc thirty millimetres across, the upper leg's share among them
 * running from a tenth at the top of the loop to near a fifth at its foot. On a
 * flexed hip each side of the organ followed its own share of the thigh, and a
 * clitoral glans seven millimetres across turned inside out. An organ moves with
 * where it is rooted: each of its vertices takes, in proportion to how far it has
 * been pushed out of the skin, the weights of the reservoir's root (`rootSkin`).
 *
 * The weights depend on the evaluation, so they are found with it (`evaluatedSkin`),
 * once, and every consumer skins by those: the renderer's attributes, the posed
 * body the invariants measure, the affordances' landmarks and the mesh's own CPU
 * skinning. A surface nothing has pushed (the base surface, an adult with no
 * organ) keeps its topology's weights, the very arrays.
 */
import type { SurfaceMesh } from "../build/surfaceMesh.ts";
import { FOLD_ROW_TEXELS, type SurfaceFold } from "../rig/hipFold.ts";

/** A surface's skin weights: four bones and four weights per render vertex. */
export interface SkinWeights {
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
}

/**
 * The weights to skin an evaluation's body surface by: its own (`Evaluation.skin`)
 * or, when it has none, the topology's of the surface it is for. Every consumer of
 * a body surface's skin weights reads them here.
 */
export function skinOfEvaluation(
  evaluation: { readonly skin: SkinWeights | null },
  topology: SkinWeights,
): SkinWeights {
  return evaluation.skin ?? topology;
}

/** Which render vertices are a reservoir's, and the weights each reservoir's root has. */
export interface ReservoirSkinning {
  /** Per render vertex, the reservoir it is drawn from (a ring copy or a cap vertex), or -1. */
  owner: Int16Array;
  /** Per reservoir, its root's four bones and weights (`rootSkin`). */
  roots: readonly { index: Uint16Array; weight: Float32Array }[];
  /** Per reservoir, its loop's render vertices: where the organ meets the body. */
  loops: readonly Uint32Array[];
}

/** A built surface's reservoirs as `evaluatedSkin` reads them; none without a lattice. */
export function reservoirSkinningOf(mesh: SurfaceMesh): ReservoirSkinning {
  const reservoirs = mesh.lattice?.reservoirs ?? [];
  const bySurface = new Int16Array(mesh.topology.vertexCount).fill(-1);
  const loopOf = new Int16Array(mesh.topology.vertexCount).fill(-1);
  reservoirs.forEach((r, s) => {
    for (const v of r.copies) bySurface[v] = s;
    for (const v of r.capVertices) bySurface[v] = s;
    for (const v of r.loopVertices) loopOf[v] = s;
  });
  const owner = Int16Array.from(mesh.renderToSurface, (v) => bySurface[v] as number);
  const loops = reservoirs.map((_, s) => {
    const loop: number[] = [];
    mesh.renderToSurface.forEach((v, r) => {
      if (loopOf[v] === s) loop.push(r);
    });
    return Uint32Array.from(loop);
  });
  const roots = loops.map((loop) => rootSkin(mesh, loop));
  return { owner, roots, loops };
}

/**
 * How far out of the skin a vertex is pushed before it takes any of its root's
 * weights, metres. CHOICE: the skin line a sculpt is attached at lies a millimetre
 * or two inside the loop (scripts/lib/detail/transfer.ts, `skinLine`), on the
 * skin; the band between them stays skinned as the skin round it.
 */
export const PUSH_STARTS = 0.001;

/**
 * How far out of the skin a vertex is pushed when it has its root's weights
 * alone, metres. CHOICE: a clitoral glans stands its own length, twelve
 * millimetres, out of the skin, and the walls of a shaft or a sac a few
 * millimetres from the loop; at five millimetres an organ of any size moves as
 * one piece above its first millimetres, and the skin round its root bends into it.
 */
export const PUSHED_FULLY = 0.005;

/** The share of the root's weights a vertex pushed `distance` metres out of the skin takes: 0 to 1, smoothly. */
export function rootShare(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - PUSH_STARTS) / (PUSHED_FULLY - PUSH_STARTS)));
  return t * t * (3 - 2 * t);
}

/**
 * A reservoir's root: the mean of its loop's render vertices' weights, its four
 * heaviest bones renormalised. The loop is where the organ meets the body.
 */
export function rootSkin(
  skin: SkinWeights,
  loopRenderVertices: ArrayLike<number>,
): { index: Uint16Array; weight: Float32Array } {
  const sum = new Map<number, number>();
  for (let i = 0; i < loopRenderVertices.length; i++) {
    const v = loopRenderVertices[i] as number;
    for (let k = 0; k < 4; k++) {
      const w = skin.skinWeight[v * 4 + k] as number;
      if (w > 0) {
        const b = skin.skinIndex[v * 4 + k] as number;
        sum.set(b, (sum.get(b) ?? 0) + w);
      }
    }
  }
  const top = [...sum].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
  const total = top.reduce((s, [, w]) => s + w, 0);
  const index = new Uint16Array(4);
  const weight = new Float32Array(4);
  top.forEach(([b, w], k) => {
    index[k] = b;
    weight[k] = w / total;
  });
  return { index, weight };
}

/**
 * Four weights from up to eight, continuously: each loses the fifth largest and
 * the four left are renormalised. Keeping the four largest as they are would jump
 * where the fourth and fifth swap; with the fifth taken off, both are zero there.
 */
function fourOf(
  bones: number[],
  weights: number[],
  index: Uint16Array,
  weight: Float32Array,
  at: number,
) {
  const order = weights
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (weights[b] as number) - (weights[a] as number) ||
        (bones[a] as number) - (bones[b] as number),
    );
  const floor = order.length > 4 ? (weights[order[4] as number] as number) : 0;
  let total = 0;
  for (let k = 0; k < 4; k++) {
    const i = order[k];
    const w = i === undefined ? 0 : Math.max(0, (weights[i] as number) - floor);
    index[at + k] = i === undefined ? 0 : (bones[i] as number);
    weight[at + k] = w;
    total += w;
  }
  for (let k = 0; k < 4; k++) weight[at + k] = total > 0 ? (weight[at + k] as number) / total : 0;
}

/**
 * The surface's weights for an evaluation that pushed its render vertices `pushed`
 * metres out of the skin (per render vertex): each reservoir vertex blended toward
 * its root's weights by `rootShare`. Null when none is pushed far enough to take any,
 * so the surface keeps its topology's weights exactly.
 */
export function evaluatedSkin(
  skin: SkinWeights,
  skinning: ReservoirSkinning,
  pushed: Float32Array,
): SkinWeights | null {
  let out: SkinWeights | null = null;
  const bones: number[] = [];
  const weights: number[] = [];
  const { owner, roots } = skinning;
  for (let v = 0; v < owner.length; v++) {
    const s = owner[v] as number;
    if (s < 0) continue;
    const e = rootShare(pushed[v] as number);
    if (e <= 0) continue;
    out ??= {
      skinIndex: Uint16Array.from(skin.skinIndex),
      skinWeight: Float32Array.from(skin.skinWeight),
    };
    const root = roots[s] as { index: Uint16Array; weight: Float32Array };
    bones.length = 0;
    weights.length = 0;
    const add = (b: number, w: number) => {
      if (w <= 0) return;
      const at = bones.indexOf(b);
      if (at < 0) {
        bones.push(b);
        weights.push(w);
      } else weights[at] = (weights[at] as number) + w;
    };
    for (let k = 0; k < 4; k++)
      add(skin.skinIndex[v * 4 + k] as number, (1 - e) * (skin.skinWeight[v * 4 + k] as number));
    for (let k = 0; k < 4; k++) add(root.index[k] as number, e * (root.weight[k] as number));
    fourOf(bones, weights, out.skinIndex, out.skinWeight, v * 4);
  }
  return out;
}

/**
 * The hip fold of a surface (`surfaceFold`) for an evaluation that pushed its
 * render vertices `pushed` metres out of the skin, by the rule its weights follow
 * (`evaluatedSkin`): each reservoir vertex's row blended toward its root's by
 * `rootShare`, the root's being the mean of its loop's rows (a loop vertex the
 * fold leaves counting as none). A reservoir's rings and cap carry the fold of
 * the disc of skin they were copied from; drawn out into an organ, each side of
 * it took its own share of the belly's press and the thigh's push, and the organ
 * was pulled out of shape. The fold itself when nothing is pushed far enough.
 */
export function evaluatedFold(
  fold: SurfaceFold,
  skinning: ReservoirSkinning,
  pushed: Float32Array,
): SurfaceFold {
  const row = FOLD_ROW_TEXELS * 4;
  const { owner, loops } = skinning;
  /** Per reservoir, its root's row (lazily), or null while not needed. */
  const roots: (Float32Array | null)[] = loops.map(() => null);
  const rootOf = (s: number): Float32Array => {
    const known = roots[s];
    if (known) return known;
    const loop = loops[s] as Uint32Array;
    const sum = new Float32Array(row);
    let held = 0;
    for (const v of loop) {
      const r = fold.slot[v] as number;
      if (r < 0) continue;
      held++;
      for (let i = 0; i < row; i++)
        sum[i] = (sum[i] as number) + (fold.data[r * row + i] as number);
    }
    // The side (the first texel's fourth place) is a mean of the rows there are; the values count the rest as none.
    const side = held ? (sum[3] as number) / held : 0.5;
    for (let i = 0; i < row; i++) sum[i] = (sum[i] as number) / Math.max(1, loop.length);
    sum[3] = side;
    roots[s] = sum;
    return sum;
  };
  const blended: { v: number; e: number; s: number }[] = [];
  for (let v = 0; v < owner.length; v++) {
    const s = owner[v] as number;
    if (s < 0) continue;
    const e = rootShare(pushed[v] as number);
    if (e > 0) blended.push({ v, e, s });
  }
  if (!blended.length) return fold;
  // Each blended vertex its own row after the surface's: the blend is the vertex's, not its row's.
  const data = new Float32Array((fold.rows + blended.length) * row);
  data.set(fold.data.subarray(0, fold.rows * row));
  const slot = Float32Array.from(fold.slot);
  blended.forEach(({ v, e, s }, i) => {
    const at = (fold.rows + i) * row;
    const own = fold.slot[v] as number;
    const root = rootOf(s);
    for (let k = 0; k < row; k++)
      data[at + k] =
        (1 - e) * (own < 0 ? 0 : (fold.data[own * row + k] as number)) + e * (root[k] as number);
    // A vertex the fold left reads the root's side; one it moved, the two sides mixed as the rows are.
    data[at + 3] =
      own < 0
        ? (root[3] as number)
        : (1 - e) * (fold.data[own * row + 3] as number) + e * (root[3] as number);
    slot[v] = fold.rows + i;
  });
  return { slot, rows: fold.rows + blended.length, data };
}
