import { SkinPatch, TriangleCrossings } from "./contact.ts";
import { FOLD_KEYS, foldParts, HIP_FOLD, type HipFold, noFold } from "./hipFold.ts";
import { IDENTITY_POSE, type RestBones, skinPositions } from "./pose.ts";

/**
 * Solves a figure's hip fold (docs/ARCHITECTURE.md, "The hip fold"): for each
 * key flexion of `HIP_FOLD`, how far each vertex of the thigh's skin must move,
 * from where the bones put it with both hips flexed so far, to lie against the
 * trunk's skin and not through it.
 *
 * The hips are flexed a few degrees at a time from where the fold starts, as a
 * contact would develop, and at each step the thigh's skin that is behind the
 * trunk's is pushed out of it (along the trunk's outward normal, to
 * `CLEARANCE` off it), the first pushes of a step spread over the neighbouring
 * skin, until no push is needed. Spreading is what makes the result a smooth
 * fold, not a crease cut by the trunk's edge; the steps are what keep every
 * push small, so that it is always the nearest skin that the thigh is pushed
 * from, and never a far side of the belly. The displacement a step ends with
 * carries on to the next, and is given back where the skin has left the trunk
 * behind.
 */

/** How far (metres) off the trunk's skin the thigh's is left: a skin's thickness of touching. */
const CLEARANCE = 0.005;
/** Thigh skin further than this (metres) from the trunk's is not tested. */
const REACH = 0.05;
/** Cells (metres) of the grid that finds the trunk's triangles near a vertex. */
const CELL = 0.04;
/** The share of its neighbours' push each vertex takes in a spread pass. */
const SPREAD = 0.5;
/** Spread passes made of each of the first passes of a step. */
const SPREADS = 2;
/** The passes of a step that spread their pushes; the rest push each vertex alone. */
const SPREADING = 3;
/** A pass that needs no push over this (metres) is the last of its step. */
const TOLERANCE = 0.0002;
const PASSES = 60;
/** From this pass of a step on, each push is made only `RELAXED` of the way. */
const RELAX_FROM = 30;
const RELAXED = 0.5;
/** The most (metres) a pass moves any skin. */
const MOST_PUSH = 0.04;
/** Skin the thigh holds under this much of is not moved. */
const MIN_THIGH = 0.25;

/** `fold` for the figure whose rest vertices are `control`, skeleton `rest`, skinned by `skinIndex` and `skinWeight`; `tris` are the body's triangles. */
export function solveHipFold(
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  tris: Uint32Array,
): HipFold {
  const steps = solveHipFoldSteps(rest, control, skinIndex, skinWeight, tris);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** `solveHipFold` a flexion at a time: it yields after each, so that a caller can let other work in between. */
export function* solveHipFoldSteps(
  rest: RestBones,
  control: Float32Array,
  skinIndex: Uint8Array | Uint16Array,
  skinWeight: Float32Array,
  tris: Uint32Array,
): Generator<void, HipFold> {
  const n = control.length / 3;
  // The thigh's skin by the hip, which moves, and the trunk's, which it must not pass through.
  const parts = foldParts(rest, control, skinIndex, skinWeight, tris, MIN_THIGH);
  const movers = Array.from(parts.movers);
  const skin = Array.from(parts.skin);
  const hips = [".L", ".R"].map((s) => rest.names.indexOf(HIP_FOLD.bone + s)).filter((b) => b >= 0);
  if (!movers.length || !skin.length || !hips.length) return noFold(n);
  const patch = new SkinPatch(parts.skin, n);
  const around = neighbours(tris, n);
  const triangles = skin.length / 3;

  /** How far each vertex of the thigh's skin has been displaced so far. */
  const D = new Float64Array(n * 3);
  const push = new Float64Array(n * 3);
  /** How far each mover is to be pushed this pass. */
  const size = new Float64Array(n);
  const spread = new Float64Array(n * 3);
  const isMover = new Uint8Array(n);
  for (const v of movers) isMover[v] = 1;
  // The edges of the body that have a mover at an end, once.
  const pairs: number[] = [];
  const seen = new Set<number>();
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k] as number;
      const b = tris[t + ((k + 1) % 3)] as number;
      if (!isMover[a] && !isMover[b]) continue;
      const key = a < b ? a * n + b : b * n + a;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(a, b);
    }
  /** The edges' ends, two to an edge. */
  const edges = Uint32Array.from(pairs);
  const point = new Float64Array(3);
  const normal = new Float64Array(3);
  /** Per mover, per key, x, y, z. */
  const keyed = new Float32Array(movers.length * FOLD_KEYS * 3);
  // Only the vertices the solve reads are skinned: the movers, the trunk's skin, and the ends of the edges.
  const wanted = new Uint8Array(n);
  for (const v of movers) wanted[v] = 1;
  for (const v of skin) wanted[v] = 1;
  for (const v of edges) wanted[v] = 1;
  const needed = Uint32Array.from({ length: n }, (_, v) => v).filter((v) => wanted[v]);
  const neededControl = new Float32Array(needed.length * 3);
  const neededIndex = new Uint16Array(needed.length * 4);
  const neededWeight = new Float32Array(needed.length * 4);
  needed.forEach((v, i) => {
    neededControl.set(control.subarray(v * 3, v * 3 + 3), i * 3);
    for (let k = 0; k < 4; k++) {
      neededIndex[i * 4 + k] = skinIndex[v * 4 + k] as number;
      neededWeight[i * 4 + k] = skinWeight[v * 4 + k] as number;
    }
  });
  /** The hips flexed `degrees`, both, and the vertices the solve reads as the bones put them (the rest are zero). */
  const posedAt = (degrees: number): Float32Array => {
    const rotations = IDENTITY_POSE(rest.names.length);
    const half = (-degrees * Math.PI) / 360;
    for (const b of hips) rotations.set([Math.sin(half), 0, 0, Math.cos(half)], b * 4);
    const posed = skinPositions(
      rest,
      rotations,
      neededControl,
      neededIndex,
      neededWeight,
      new Float32Array(needed.length * 3),
    );
    const out = new Float32Array(n * 3);
    needed.forEach((v, i) => {
      out.set(posed.subarray(i * 3, i * 3 + 3), v * 3);
    });
    return out;
  };
  for (let key = 0; key < FOLD_KEYS; key++) {
    const degrees = HIP_FOLD.from + (key + 1) * HIP_FOLD.step;
    const posed0 = posedAt(degrees);
    // The trunk is posed once for the step: only the thigh's skin moves between passes.
    const trunkSkin = patch.pose(posed0);
    const grid = new TriangleGrid(posed0, skin, triangles);
    const P = new Float32Array(posed0);
    for (const v of movers)
      for (let k = 0; k < 3; k++)
        P[v * 3 + k] = (posed0[v * 3 + k] as number) + (D[v * 3 + k] as number);
    // The skin that is near enough the trunk's to meet it this step.
    const active = movers.filter(
      (v) =>
        grid.near(P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number, REACH)
          .length > 0,
    );
    const crossings = new TriangleCrossings(P, parts.skin);
    // Halfway back to the last key, the fold is the mean of the two, which is not what is solved: it is looked at too, so that what is between two keys is as clear as they are.
    const before = Float64Array.from(D);
    const posedMid = posedAt(degrees - HIP_FOLD.step / 2);
    const PM = new Float32Array(posedMid);
    const mid = (v: number, k: number) =>
      (posedMid[v * 3 + k] as number) +
      ((before[v * 3 + k] as number) + (D[v * 3 + k] as number)) / 2;
    for (const v of movers) for (let k = 0; k < 3; k++) PM[v * 3 + k] = mid(v, k);
    const crossingsMid = new TriangleCrossings(PM, parts.skin);

    for (let pass = 0; pass < PASSES; pass++) {
      let most = 0;
      push.fill(0);
      size.fill(0);
      /** Pushes mover `v` out along `n` by `need`, if that is more than it is already to be pushed. */
      const pushOut = (v: number, n: ArrayLike<number>, wanted: number) => {
        most = Math.max(most, wanted);
        // However far behind a plane, a pass moves skin only so far: what is behind a plane is not always behind its triangle.
        const need = Math.min(wanted, MOST_PUSH);
        if (need <= (size[v] as number)) return;
        size[v] = need;
        for (let k = 0; k < 3; k++) push[v * 3 + k] = (n[k] as number) * need;
      };
      // Skin behind the trunk's, by the nearest of it...
      for (const v of active) {
        const [x, y, z] = [P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number];
        const near = grid.near(x, y, z, REACH);
        if (!near.length) continue;
        const c = trunkSkin.signed(x, y, z, point, near, normal);
        if (CLEARANCE - c > 0) pushOut(v, normal, CLEARANCE - c);
      }
      // ... and skin whose edges pass through it, which is what is seen, wherever the nearest of it is;
      // halfway, a push of the key moves the skin half as far, so it is twice what is behind.
      const through = (c: TriangleCrossings, t: number, v: number, scale: number) => {
        if (!isMover[v]) return;
        const behind = -c.side(t, v);
        if (behind <= 0) return;
        c.normal(t, normal);
        pushOut(v, normal, scale * behind + CLEARANCE);
      };
      for (const [c, scale] of [
        [crossings, 1],
        [crossingsMid, 2],
      ] as const)
        for (let e = 0; e < edges.length; e += 2) {
          const a = edges[e] as number;
          const b = edges[e + 1] as number;
          const found = c.find(a, b);
          for (let h = 0; h < found; h++) {
            through(c, c.hits[h] as number, a, scale);
            through(c, c.hits[h] as number, b, scale);
          }
        }
      if (most < TOLERANCE) break;
      if (pass < SPREADING)
        for (let again = 0; again < SPREADS; again++) {
          spread.fill(0);
          for (const v of movers)
            for (let k = 0; k < 3; k++) {
              let sum = 0;
              const [from, to] = [around.start[v] as number, around.start[v + 1] as number];
              for (let e = from; e < to; e++)
                sum += push[(around.list[e] as number) * 3 + k] as number;
              spread[v * 3 + k] =
                (1 - SPREAD) * (push[v * 3 + k] as number) +
                (SPREAD * sum) / Math.max(1, to - from);
            }
          for (const v of movers)
            for (let k = 0; k < 3; k++) push[v * 3 + k] = spread[v * 3 + k] as number;
        }
      // A vertex in a concave corner is pushed out of one triangle into the next and back; pushing less each time settles it.
      const relax = pass < RELAX_FROM ? 1 : RELAXED;
      for (const v of movers)
        for (let k = 0; k < 3; k++) {
          D[v * 3 + k] = (D[v * 3 + k] as number) + (push[v * 3 + k] as number) * relax;
          P[v * 3 + k] = (posed0[v * 3 + k] as number) + (D[v * 3 + k] as number);
          PM[v * 3 + k] = mid(v, k);
        }
    }
    movers.forEach((v, m) => {
      for (let k = 0; k < 3; k++) keyed[(m * FOLD_KEYS + key) * 3 + k] = D[v * 3 + k] as number;
    });
    yield;
  }
  // Only the vertices the fold ever moves are kept.
  const moved = movers.flatMap((_, m) => {
    for (let i = 0; i < FOLD_KEYS * 3; i++) if (keyed[m * FOLD_KEYS * 3 + i] !== 0) return [m];
    return [];
  });
  const fold = noFold(n);
  const vertices = Uint32Array.from(moved, (m) => movers[m] as number);
  const vectors = new Float32Array(moved.length * FOLD_KEYS * 3);
  moved.forEach((m, s) => {
    fold.slot[movers[m] as number] = s;
    vectors.set(keyed.subarray(m * FOLD_KEYS * 3, (m + 1) * FOLD_KEYS * 3), s * FOLD_KEYS * 3);
  });
  return { vertices, slot: fold.slot, vectors };
}

/** The trunk's triangles by where their centres are, to find those near a point without testing them all. */
class TriangleGrid {
  /** The grid's lowest corner, and its size in cells along each axis. */
  private readonly low: [number, number, number] = [0, 0, 0];
  private readonly size: [number, number, number] = [1, 1, 1];
  /** Triangle numbers by cell, in rows: cell `c` holds `list[start[c]..start[c + 1]]`. */
  private readonly start: Uint32Array;
  private readonly list: Uint32Array;
  /** Scratch for `near`: the triangles found, and how near their nearest points can be. */
  private readonly found: Int32Array;
  private readonly away: Float32Array;
  /** Where each triangle's centre is, and how far from it its farthest corner. */
  private readonly centres: Float32Array;
  private readonly radius: Float32Array;
  /** The largest radius. */
  private readonly widest: number;

  constructor(positions: Float32Array, skin: readonly number[], triangles: number) {
    const centres = new Float32Array(triangles * 3);
    this.centres = centres;
    this.found = new Int32Array(triangles);
    this.away = new Float32Array(triangles);
    this.radius = new Float32Array(triangles);
    const high = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const low = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    for (let t = 0; t < triangles; t++)
      for (let k = 0; k < 3; k++) {
        const c =
          ((positions[(skin[t * 3] as number) * 3 + k] as number) +
            (positions[(skin[t * 3 + 1] as number) * 3 + k] as number) +
            (positions[(skin[t * 3 + 2] as number) * 3 + k] as number)) /
          3;
        centres[t * 3 + k] = c;
        low[k] = Math.min(low[k] as number, c);
        high[k] = Math.max(high[k] as number, c);
      }
    let widest = 0;
    for (let t = 0; t < triangles; t++) {
      let r = 0;
      for (let c = 0; c < 3; c++) {
        const v = skin[t * 3 + c] as number;
        r = Math.max(
          r,
          Math.hypot(
            (positions[v * 3] as number) - (centres[t * 3] as number),
            (positions[v * 3 + 1] as number) - (centres[t * 3 + 1] as number),
            (positions[v * 3 + 2] as number) - (centres[t * 3 + 2] as number),
          ),
        );
      }
      this.radius[t] = r;
      widest = Math.max(widest, r);
    }
    this.widest = widest;
    for (let k = 0; k < 3; k++) {
      this.low[k] = low[k] as number;
      this.size[k] = Math.floor(((high[k] as number) - (low[k] as number)) / CELL) + 1;
    }
    const cells = this.size[0] * this.size[1] * this.size[2];
    this.start = new Uint32Array(cells + 1);
    const of = new Uint32Array(triangles);
    for (let t = 0; t < triangles; t++) {
      of[t] = this.cell(
        centres[t * 3] as number,
        centres[t * 3 + 1] as number,
        centres[t * 3 + 2] as number,
      );
      this.start[(of[t] as number) + 1] = (this.start[(of[t] as number) + 1] as number) + 1;
    }
    for (let c = 0; c < cells; c++)
      this.start[c + 1] = (this.start[c + 1] as number) + (this.start[c] as number);
    this.list = new Uint32Array(triangles);
    const filled = new Uint32Array(cells);
    for (let t = 0; t < triangles; t++) {
      const c = of[t] as number;
      this.list[(this.start[c] as number) + (filled[c] as number)++] = t;
    }
  }

  private cell(x: number, y: number, z: number): number {
    const [sx, sy] = this.size;
    return (
      Math.floor((x - this.low[0]) / CELL) +
      sx * (Math.floor((y - this.low[1]) / CELL) + sy * Math.floor((z - this.low[2]) / CELL))
    );
  }

  /**
   * The triangles that can hold the point nearest (x, y, z) when it is within
   * `reach` of the trunk's skin: those no further from it than the farthest
   * another triangle is sure to be (a triangle lies within its radius of its
   * centre). None when the point is not within reach. The list is reused.
   */
  near(x: number, y: number, z: number, reach: number): Int32Array {
    const r = reach + this.widest;
    const [sx, sy, sz] = this.size;
    const range = (v: number, axis: 0 | 1 | 2, size: number): [number, number] => [
      Math.max(0, Math.floor((v - r - this.low[axis]) / CELL)),
      Math.min(size - 1, Math.floor((v + r - this.low[axis]) / CELL)),
    ];
    const [i0, i1] = range(x, 0, sx);
    const [j0, j1] = range(y, 1, sy);
    const [k0, k1] = range(z, 2, sz);
    const { found, away, centres, radius } = this;
    let count = 0;
    let sure = Number.POSITIVE_INFINITY;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const c = i + sx * (j + sy * k);
          for (let e = this.start[c] as number; e < (this.start[c + 1] as number); e++) {
            const t = this.list[e] as number;
            const d = Math.sqrt(
              ((centres[t * 3] as number) - x) ** 2 +
                ((centres[t * 3 + 1] as number) - y) ** 2 +
                ((centres[t * 3 + 2] as number) - z) ** 2,
            );
            // The triangle's nearest point is no nearer than `d - radius` and no further than `d + radius`.
            found[count] = t;
            away[count++] = d - (radius[t] as number);
            sure = Math.min(sure, d + (radius[t] as number));
          }
        }
    if (sure > reach + this.widest) return found.subarray(0, 0);
    let kept = 0;
    for (let e = 0; e < count; e++)
      if ((away[e] as number) <= sure) found[kept++] = found[e] as number;
    return found.subarray(0, kept);
  }
}

/** Each vertex's neighbours along the triangles' edges, in compressed rows. */
function neighbours(tris: Uint32Array, n: number): { start: Uint32Array; list: Uint32Array } {
  const sets = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k] as number;
      const b = tris[t + ((k + 1) % 3)] as number;
      sets[a]?.add(b);
      sets[b]?.add(a);
    }
  const start = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) start[v + 1] = (start[v] as number) + (sets[v]?.size ?? 0);
  const list = new Uint32Array(start[n] as number);
  sets.forEach((s, v) => {
    let at = start[v] as number;
    for (const u of s) list[at++] = u;
  });
  return { start, list };
}
