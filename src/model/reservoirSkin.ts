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
 * where it is rooted: each of its vertices takes the weights of the reservoir's root
 * (`rootSkin`) by where it sits on the organ, how far along the drawn surface it is
 * from the loop, over a band a fixed share of the organ's base radius wide
 * (`rootShares`). Keyed to how far a vertex was pushed instead, a shallow base (a
 * vulva's, its first millimetres of push spread over five of skin) sorted neighbours
 * into very different shares, and the crease sheared them over.
 *
 * A canal (`AdultReservoirSpec.canal`) is drawn into the body, its opening closing
 * over its first centimetre into a lumen a few millimetres across. Over an organ's
 * band (a fifth of its base radius, two millimetres) each wall of the opening went
 * from its own side's share of the thigh to the root's across one ring, and a flexed
 * hip folded the opening over (f-slim squat: 113 more folded edges, all within 7 mm
 * of the loop). A canal takes the root's weights over the length its opening closes
 * in. Over its whole length instead, the lumen's middle kept half its side's thigh
 * and swung out through the skin (f-slim squat: 30 cm² more penetrating).
 *
 * The weights depend on the evaluation, so they are found with it (`evaluatedSkin`),
 * once, and every consumer skins by those: the renderer's attributes, the posed
 * body the invariants measure, the affordances' landmarks and the mesh's own CPU
 * skinning. A surface nothing has pushed (the base surface, an adult with no
 * organ) keeps its topology's weights, the very arrays.
 */
import type { SurfaceMesh } from "../build/surfaceMesh.ts";
import { fromHalf, toHalf } from "../rig/half.ts";
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

/**
 * Which render vertices are a reservoir's, the weights each reservoir's root has,
 * and the reservoirs' surface as a graph, for how far along it a vertex is from
 * its loop (`rootShares`).
 */
export interface ReservoirSkinning {
  /** Per render vertex, the reservoir it is drawn from (a ring copy or a cap vertex), or -1. */
  owner: Int16Array;
  /** Per reservoir, its root's four bones and weights (`rootSkin`). */
  roots: readonly { index: Uint16Array; weight: Float32Array }[];
  /** Per reservoir, its loop's render vertices: where the organ meets the body. */
  loops: readonly Uint32Array[];
  /** Per reservoir, a canal's opening length (`AdultReservoirSpec.canal`), metres, or null for an organ. */
  openings: readonly (number | null)[];
  /**
   * The reservoirs' and their loops' surface vertices, numbered from 0 (`node`),
   * welded across UV seams: per node, a render vertex of it (`render`), its
   * reservoir (`reservoir`, -1 on a loop), and its neighbours along the drawn
   * triangles' edges (`next[start[n]..start[n + 1]]`); per render vertex, its node or -1.
   */
  graph: {
    node: Int32Array;
    render: Uint32Array;
    reservoir: Int16Array;
    start: Uint32Array;
    next: Uint32Array;
  };
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
  return {
    owner,
    roots,
    loops,
    openings: reservoirs.map((r) => r.canal?.opening ?? null),
    graph: reservoirGraph(mesh.index, mesh.renderToSurface, bySurface, loopOf),
  };
}

/**
 * The reservoirs' surface as `ReservoirSkinning.graph`, from a surface's triangles
 * over its render vertices (`index`), each render vertex's surface vertex
 * (`renderToSurface`), and per surface vertex its reservoir (`bySurface`) or the
 * reservoir whose loop it is on (`loopOf`), -1 for neither.
 */
export function reservoirGraph(
  index: ArrayLike<number>,
  renderToSurface: ArrayLike<number>,
  bySurface: Int16Array,
  loopOf: Int16Array,
): ReservoirSkinning["graph"] {
  const surfaceNode = new Int32Array(bySurface.length).fill(-1);
  const render: number[] = [];
  const reservoir: number[] = [];
  for (let r = 0; r < renderToSurface.length; r++) {
    const v = renderToSurface[r] as number;
    if ((bySurface[v] as number) < 0 && (loopOf[v] as number) < 0) continue;
    if ((surfaceNode[v] as number) >= 0) continue;
    surfaceNode[v] = render.length;
    render.push(r);
    reservoir.push(bySurface[v] as number);
  }
  const node = Int32Array.from({ length: renderToSurface.length }, (_, r) => {
    return surfaceNode[renderToSurface[r] as number] as number;
  });
  const sets = render.map(() => new Set<number>());
  const I = index;
  for (let t = 0; t + 2 < I.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = node[I[t + k] as number] as number;
      const b = node[I[t + ((k + 1) % 3)] as number] as number;
      if (a < 0 || b < 0 || a === b) continue;
      sets[a]?.add(b);
      sets[b]?.add(a);
    }
  const start = new Uint32Array(render.length + 1);
  sets.forEach((s, n) => {
    start[n + 1] = (start[n] as number) + s.size;
  });
  const next = new Uint32Array(start[render.length] as number);
  sets.forEach((s, n) => {
    next.set([...s], start[n] as number);
  });
  return {
    node,
    render: Uint32Array.from(render),
    reservoir: Int16Array.from(reservoir),
    start,
    next,
  };
}

/**
 * How far out of the skin a vertex must be pushed to take all the root's weights its
 * place on the organ gives it, metres; a vertex pushed less takes that share in
 * proportion, so a reservoir nothing pushes keeps its topology's weights exactly.
 * CHOICE: the skin line a sculpt is attached at lies a millimetre or two inside the
 * loop (scripts/lib/detail/transfer.ts, `skinLine`).
 */
export const PUSH_STARTS = 0.001;

/**
 * How wide the band over which an organ's vertices go from the skin's weights to the
 * root's is, as a share of the organ's base radius (its loop's mean distance from its
 * centre), measured from the loop along the drawn surface: `ROOT_BAND.narrow` for an
 * organ that stands straight out of its loop, `ROOT_BAND.wide` for one that rises
 * shallowly, and between them by how steeply it rises (`rise`), smoothly from
 * `RISE.shallow` to `RISE.steep`. A shaft wants the narrow band (wider, its walls take
 * the skin's spread of thigh weights and fold over in a crease) and a vulva the wide
 * one (narrower, its shallow base sorts close neighbours into very different shares).
 * CHOICE, fitted over the smoke tier's adult bodies (docs/ARCHITECTURE.md,
 * "Reservoir skinning").
 */
export const ROOT_BAND = { narrow: 0.2, wide: 0.7 } as const;

/**
 * The rises (`rise`) at and below which an organ takes `ROOT_BAND.wide`, and at and
 * above which `ROOT_BAND.narrow`. Measured: a vulva rises 0.35 (2.8 mm proud of its
 * loop's plane 8 mm along the surface), a small phallus 0.43, the intermediate form at
 * gender 0.5 about 0.6, a sac about 0.6 and a shaft 0.85, so a sac stands with the
 * shaft and a small phallus near the vulva.
 */
export const RISE = { shallow: 0.35, steep: 0.5 } as const;

/** The surface distances from the loop, metres, over which an organ's rise is measured. */
const RISE_WINDOW = [0.006, 0.01] as const;

/**
 * How steeply a reservoir's organ rises from its loop as drawn: the mean height of
 * its vertices `RISE_WINDOW` along the surface from the loop above the loop's plane
 * (its centre, and the normal of its polygon turned toward the organ's farthest
 * vertex), over their mean distance. Zero with no vertex in the window.
 */
function rise(
  skinning: ReservoirSkinning,
  s: number,
  positions: Float32Array,
  dist: Float64Array,
  centre: number[],
): number {
  const { owner, loops, graph } = skinning;
  const loop = loops[s] as Uint32Array;
  const n = [0, 0, 0];
  const rel = (v: number, k: number) => (positions[v * 3 + k] as number) - (centre[k] as number);
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] as number;
    const b = loop[(i + 1) % loop.length] as number;
    n[0] = (n[0] as number) + rel(a, 1) * rel(b, 2) - rel(a, 2) * rel(b, 1);
    n[1] = (n[1] as number) + rel(a, 2) * rel(b, 0) - rel(a, 0) * rel(b, 2);
    n[2] = (n[2] as number) + rel(a, 0) * rel(b, 1) - rel(a, 1) * rel(b, 0);
  }
  const length = Math.hypot(...n) || 1;
  const height = (v: number) =>
    (rel(v, 0) * (n[0] as number) + rel(v, 1) * (n[1] as number) + rel(v, 2) * (n[2] as number)) /
    length;
  let far = 0;
  let heights = 0;
  let distances = 0;
  for (let v = 0; v < owner.length; v++) {
    if (owner[v] !== s) continue;
    const h = height(v);
    if (Math.abs(h) > Math.abs(far)) far = h;
    const d = dist[graph.node[v] as number] as number;
    if (d < RISE_WINDOW[0] || d > RISE_WINDOW[1]) continue;
    heights += h;
    distances += d;
  }
  return distances > 0 ? (Math.sign(far) || 1) * (heights / distances) : 0;
}

/** The band (`ROOT_BAND`) an organ rising `r` takes. */
export function bandOf(r: number): number {
  const t = smooth((r - RISE.shallow) / (RISE.steep - RISE.shallow));
  return ROOT_BAND.wide + (ROOT_BAND.narrow - ROOT_BAND.wide) * t;
}

/** Smoothstep of `t` clamped to 0..1. */
const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * Each render vertex's share of its root's weights and fold in an evaluation that
 * drew the surface at `positions` and pushed its vertices `pushed` metres out of the
 * skin: by its distance from its reservoir's loop along the drawn surface, over the
 * band its organ's rise gives (`bandOf`) of the organ's base radius (a canal's: its
 * opening's length), times how far it was pushed of `PUSH_STARTS`. Zero off the
 * reservoirs; null when no vertex takes any.
 */
export function rootShares(
  skinning: ReservoirSkinning,
  pushed: Float32Array,
  positions: Float32Array,
): Float32Array | null {
  const { owner, loops, graph } = skinning;
  const n = graph.render.length;
  const at = (node: number, k: number) =>
    positions[(graph.render[node] as number) * 3 + k] as number;
  const out = new Float32Array(owner.length);
  let any = false;
  loops.forEach((loop, s) => {
    let pushes = false;
    for (let v = 0; v < owner.length && !pushes; v++)
      pushes = owner[v] === s && (pushed[v] as number) > 0;
    if (!pushes || !loop.length) return;
    // The base radius: the loop's mean distance from its centre, as drawn.
    const centre = [0, 0, 0];
    for (const r of loop)
      for (let k = 0; k < 3; k++)
        centre[k] = (centre[k] as number) + (positions[r * 3 + k] as number) / loop.length;
    let radius = 0;
    for (const r of loop)
      radius +=
        Math.hypot(
          (positions[r * 3] as number) - (centre[0] as number),
          (positions[r * 3 + 1] as number) - (centre[1] as number),
          (positions[r * 3 + 2] as number) - (centre[2] as number),
        ) / loop.length;
    // Distance from the loop along the drawn surface (Dijkstra over the reservoir's nodes).
    const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
    const heap: [number, number][] = [];
    const push = (d: number, node: number) => {
      heap.push([d, node]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if ((heap[p] as [number, number])[0] <= d) break;
        [heap[p], heap[i]] = [heap[i] as [number, number], heap[p] as [number, number]];
        i = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0] as [number, number];
      const last = heap.pop() as [number, number];
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (
            l < heap.length &&
            (heap[l] as [number, number])[0] < (heap[m] as [number, number])[0]
          )
            m = l;
          if (
            r < heap.length &&
            (heap[r] as [number, number])[0] < (heap[m] as [number, number])[0]
          )
            m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i] as [number, number], heap[m] as [number, number]];
          i = m;
        }
      }
      return top;
    };
    for (const r of loop) {
      const node = graph.node[r] as number;
      if (node >= 0 && (dist[node] as number) > 0) {
        dist[node] = 0;
        push(0, node);
      }
    }
    while (heap.length) {
      const [d, a] = pop();
      if (d > (dist[a] as number)) continue;
      for (let e = graph.start[a] as number; e < (graph.start[a + 1] as number); e++) {
        const b = graph.next[e] as number;
        if (graph.reservoir[b] !== s) continue;
        const nd = d + Math.hypot(at(a, 0) - at(b, 0), at(a, 1) - at(b, 1), at(a, 2) - at(b, 2));
        if (nd < (dist[b] as number)) {
          dist[b] = nd;
          push(nd, b);
        }
      }
    }
    const width =
      skinning.openings[s] ?? bandOf(rise(skinning, s, positions, dist, centre)) * radius;
    for (let v = 0; v < owner.length; v++) {
      if (owner[v] !== s) continue;
      const d = dist[graph.node[v] as number] as number;
      const e =
        (Number.isFinite(d) ? smooth(d / width) : 0) * smooth((pushed[v] as number) / PUSH_STARTS);
      out[v] = e;
      if (e > 0) any = true;
    }
  });
  return any ? out : null;
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
 * The surface's weights for an evaluation whose reservoir vertices take `shares` of
 * their roots' (`rootShares`, per render vertex): each blended toward its root's
 * weights by its share. Null when none takes any, so the surface keeps its
 * topology's weights exactly.
 */
export function evaluatedSkin(
  skin: SkinWeights,
  skinning: ReservoirSkinning,
  shares: Float32Array | null,
): SkinWeights | null {
  if (!shares) return null;
  let out: SkinWeights | null = null;
  const bones: number[] = [];
  const weights: number[] = [];
  const { owner, roots } = skinning;
  for (let v = 0; v < owner.length; v++) {
    const s = owner[v] as number;
    if (s < 0) continue;
    const e = shares[v] as number;
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
 * The hip fold of a surface (`surfaceFold`) for an evaluation whose reservoir
 * vertices take `shares` of their roots' (`rootShares`), by the rule its weights
 * follow (`evaluatedSkin`): each reservoir vertex's row blended toward its root's by
 * its share, the root's being the mean of its loop's displacements (a loop vertex
 * the fold leaves counting as none) with no change to the normal. A reservoir's rings and cap carry the fold of
 * the disc of skin they were copied from; drawn out into an organ, each side of
 * it took its own share of the belly's press and the thigh's push, and the organ
 * was pulled out of shape. The fold itself when no vertex takes any.
 */
export function evaluatedFold(
  fold: SurfaceFold,
  skinning: ReservoirSkinning,
  shares: Float32Array | null,
): SurfaceFold {
  if (!shares) return fold;
  const row = FOLD_ROW_TEXELS * 4;
  const { owner, loops } = skinning;
  /** The fold's value at `i` (it is held as half floats). */
  const value = (i: number) => fromHalf(fold.data[i] as number);
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
      for (let i = 0; i < row; i++) sum[i] = (sum[i] as number) + value(r * row + i);
    }
    // The side (the first texel's fourth place) is a mean of the rows there are; the values count the rest as none.
    const side = held ? (sum[3] as number) / held : 0.5;
    for (let i = 0; i < row; i++) sum[i] = (sum[i] as number) / Math.max(1, loop.length);
    sum[3] = side;
    // No normal change (each opening and key's second texel): a loop vertex's is a change to
    // its own normal, which the crease turns most of the way over, and their mean added to an
    // organ's normals turned its faces against them; its normals turn with its root's weights.
    for (let i = 0; i < row; i += 8) sum.fill(0, i + 4, i + 8);
    roots[s] = sum;
    return sum;
  };
  const blended: { v: number; e: number; s: number }[] = [];
  for (let v = 0; v < owner.length; v++) {
    const s = owner[v] as number;
    if (s < 0) continue;
    const e = shares[v] as number;
    if (e > 0) blended.push({ v, e, s });
  }
  if (!blended.length) return fold;
  // Each blended vertex its own row after the surface's: the blend is the vertex's, not its row's.
  const data = new Uint16Array((fold.rows + blended.length) * row);
  data.set(fold.data.subarray(0, fold.rows * row));
  const slot = Float32Array.from(fold.slot);
  blended.forEach(({ v, e, s }, i) => {
    const at = (fold.rows + i) * row;
    const own = fold.slot[v] as number;
    const root = rootOf(s);
    for (let k = 0; k < row; k++)
      data[at + k] = toHalf(
        (1 - e) * (own < 0 ? 0 : value(own * row + k)) + e * (root[k] as number),
      );
    // A vertex the fold left reads the root's side; one it moved, the two sides mixed as the rows are.
    data[at + 3] = toHalf(
      own < 0 ? (root[3] as number) : (1 - e) * value(own * row + 3) + e * (root[3] as number),
    );
    slot[v] = fold.rows + i;
  });
  return { slot, rows: fold.rows + blended.length, data };
}
