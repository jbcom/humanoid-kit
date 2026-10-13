/**
 * Multi-pose quadric decimation by half-edge collapse (docs/MINIATURES.md,
 * "Decision"): the mesh a miniature is baked from, simplified so that it reads
 * the same in every pose it will be drawn in.
 *
 * - **Half-edge collapse only.** A vertex is always merged onto one of its
 *   neighbours, which stays where it is, so every level is a subset of the
 *   input's vertices: a frame of any level is a gather from the full frame, and
 *   the levels nest (a coarser level only removes vertices of a finer one).
 * - **Every sample frame counts.** Each vertex holds one quadric per frame
 *   (Garland and Heckbert's plane quadrics, area weighted), a collapse costs the
 *   sum of its error over the frames, and a collapse that flips or flattens a
 *   triangle in any frame is refused, so a bend that is only visible in a pose
 *   (a knee in the walk) keeps its vertices.
 * - **Silhouettes and importance.** An open edge (a hem, a brim, a cuff) adds a
 *   plane through it at right angles to its triangle, so borders keep their
 *   shape; a border vertex only moves along its border. Each vertex's cost is
 *   multiplied by its `importance`, so the caller can keep a face or hands.
 * - **Manifold and deterministic.** The link condition keeps the surface a
 *   manifold; costs are plain double arithmetic and ties fall to the lower
 *   vertex indices, so the same input gives the same levels everywhere.
 */

/** What to simplify: one triangle mesh in several frames. */
export interface DecimateInput {
  /** Positions per sample frame, each `vertexCount * 3`; the topology is the same in all. */
  frames: readonly Float32Array[];
  /** Triangles, three vertex indices each. */
  index: Uint32Array;
  /** Per vertex, how much more its removal costs (default 1). */
  importance?: Float32Array;
  /** Triangle counts to stop at and record, largest first. */
  targets: readonly number[];
  /**
   * Weight of the planes that hold open borders, relative to a surface plane
   * (default 4): one for all, or per vertex (an edge takes the mean of its ends),
   * so a hem can hold its line while a hole nobody sees does not.
   */
  boundaryWeight?: number | Float32Array;
}

/** One recorded level. */
export interface DecimateLevel {
  /** The triangle count asked for. */
  target: number;
  /** Triangles left, in the input's vertex numbering. */
  index: Uint32Array;
  /** Per input vertex, the vertex it was merged into at this level (itself if it remains). */
  owner: Int32Array;
}

/** A symmetric 4 × 4 quadric as its ten distinct terms. */
const Q = 10;

/** Adds the quadric of plane (a, b, c, d) with weight `w` into `q` at `o`. */
function addPlane(
  q: Float64Array,
  o: number,
  a: number,
  b: number,
  c: number,
  d: number,
  w: number,
) {
  q[o] = (q[o] as number) + w * a * a;
  q[o + 1] = (q[o + 1] as number) + w * a * b;
  q[o + 2] = (q[o + 2] as number) + w * a * c;
  q[o + 3] = (q[o + 3] as number) + w * a * d;
  q[o + 4] = (q[o + 4] as number) + w * b * b;
  q[o + 5] = (q[o + 5] as number) + w * b * c;
  q[o + 6] = (q[o + 6] as number) + w * b * d;
  q[o + 7] = (q[o + 7] as number) + w * c * c;
  q[o + 8] = (q[o + 8] as number) + w * c * d;
  q[o + 9] = (q[o + 9] as number) + w * d * d;
}

/** The error of point (x, y, z) under the sum of the quadrics at `o1` and `o2`. */
function error(q: Float64Array, o1: number, o2: number, x: number, y: number, z: number): number {
  const t = (k: number) => (q[o1 + k] as number) + (q[o2 + k] as number);
  return (
    t(0) * x * x +
    2 * t(1) * x * y +
    2 * t(2) * x * z +
    2 * t(3) * x +
    t(4) * y * y +
    2 * t(5) * y * z +
    2 * t(6) * y +
    t(7) * z * z +
    2 * t(8) * z +
    t(9)
  );
}

/** A binary min-heap of directed collapses, ordered by cost, then `from`, then `to`. */
class CollapseHeap {
  private cost: number[] = [];
  private from: number[] = [];
  private to: number[] = [];
  private stamp: number[] = [];
  get size(): number {
    return this.cost.length;
  }
  private less(i: number, j: number): boolean {
    const a = this.cost[i] as number;
    const b = this.cost[j] as number;
    if (a !== b) return a < b;
    if (this.from[i] !== this.from[j]) return (this.from[i] as number) < (this.from[j] as number);
    return (this.to[i] as number) < (this.to[j] as number);
  }
  private swap(i: number, j: number) {
    for (const arr of [this.cost, this.from, this.to, this.stamp]) {
      const t = arr[i] as number;
      arr[i] = arr[j] as number;
      arr[j] = t;
    }
  }
  push(cost: number, from: number, to: number, stamp: number) {
    this.cost.push(cost);
    this.from.push(from);
    this.to.push(to);
    this.stamp.push(stamp);
    let i = this.cost.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number, number] {
    const top: [number, number, number] = [
      this.from[0] as number,
      this.to[0] as number,
      this.stamp[0] as number,
    ];
    const last = this.cost.length - 1;
    this.swap(0, last);
    for (const arr of [this.cost, this.from, this.to, this.stamp]) arr.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < this.cost.length && this.less(l, m)) m = l;
      if (r < this.cost.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
}

/** Below this cosine between a triangle's normal before and after a collapse, the collapse is refused. */
const MIN_TURN_COS = 0.2;
/** A triangle smaller than this (m²) after a collapse is degenerate. */
const MIN_AREA = 1e-12;

/** Simplifies `input` to each of its targets in turn; see the module comment. */
export function decimate(input: DecimateInput): DecimateLevel[] {
  const { frames, index, targets } = input;
  const F = frames.length;
  if (F === 0) throw new Error("decimate needs at least one frame");
  const V = (frames[0] as Float32Array).length / 3;
  for (const f of frames)
    if (f.length !== V * 3) throw new Error("every frame must have the same vertex count");
  for (let k = 1; k < targets.length; k++)
    if ((targets[k] as number) > (targets[k - 1] as number))
      throw new Error("targets must be largest first");
  const importance = input.importance ?? new Float32Array(V).fill(1);
  const borders = input.boundaryWeight ?? 4;
  const boundaryWeight = (a: number, b: number) =>
    typeof borders === "number" ? borders : ((borders[a] as number) + (borders[b] as number)) / 2;
  const T = index.length / 3;
  const tri = Int32Array.from(index);
  const alive = new Uint8Array(T).fill(1);
  let liveTriangles = T;
  // Incident triangles per vertex.
  const faces: number[][] = Array.from({ length: V }, () => []);
  for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) faces[tri[t * 3 + k] as number]?.push(t);

  const pos = (f: number, v: number, k: number) => (frames[f] as Float32Array)[v * 3 + k] as number;
  /** The (unnormalised, twice-area) normal of triangle `vs` in frame `f`. */
  const normal = (f: number, vs: readonly number[]): [number, number, number] => {
    const [a, b, c] = vs as [number, number, number];
    const ux = pos(f, b, 0) - pos(f, a, 0);
    const uy = pos(f, b, 1) - pos(f, a, 1);
    const uz = pos(f, b, 2) - pos(f, a, 2);
    const vx = pos(f, c, 0) - pos(f, a, 0);
    const vy = pos(f, c, 1) - pos(f, a, 1);
    const vz = pos(f, c, 2) - pos(f, a, 2);
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };

  // Quadrics, per vertex per frame.
  const q = new Float64Array(V * F * Q);
  const qAt = (v: number, f: number) => (v * F + f) * Q;
  const edgeCount = new Map<number, number>();
  const edgeKey = (a: number, b: number) => (a < b ? a * V + b : b * V + a);
  for (let t = 0; t < T; t++) {
    const [a, b, c] = [tri[t * 3] as number, tri[t * 3 + 1] as number, tri[t * 3 + 2] as number];
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const)
      edgeCount.set(edgeKey(x, y), (edgeCount.get(edgeKey(x, y)) ?? 0) + 1);
  }
  for (let t = 0; t < T; t++) {
    const vs = [tri[t * 3] as number, tri[t * 3 + 1] as number, tri[t * 3 + 2] as number];
    for (let f = 0; f < F; f++) {
      let [nx, ny, nz] = normal(f, vs);
      const len = Math.hypot(nx, ny, nz);
      if (len === 0) continue;
      const area = len / 2;
      nx /= len;
      ny /= len;
      nz /= len;
      const a = vs[0] as number;
      const d = -(nx * pos(f, a, 0) + ny * pos(f, a, 1) + nz * pos(f, a, 2));
      for (const v of vs) addPlane(q, qAt(v, f), nx, ny, nz, d, area);
      // Open edges: a plane through the edge at right angles to the triangle.
      for (let k = 0; k < 3; k++) {
        const i = vs[k] as number;
        const j = vs[(k + 1) % 3] as number;
        if (edgeCount.get(edgeKey(i, j)) !== 1) continue;
        const ex = pos(f, j, 0) - pos(f, i, 0);
        const ey = pos(f, j, 1) - pos(f, i, 1);
        const ez = pos(f, j, 2) - pos(f, i, 2);
        let bx = ey * nz - ez * ny;
        let by = ez * nx - ex * nz;
        let bz = ex * ny - ey * nx;
        const bl = Math.hypot(bx, by, bz);
        if (bl === 0) continue;
        bx /= bl;
        by /= bl;
        bz /= bl;
        const bd = -(bx * pos(f, i, 0) + by * pos(f, i, 1) + bz * pos(f, i, 2));
        const w = boundaryWeight(i, j) * (ex * ex + ey * ey + ez * ez);
        addPlane(q, qAt(i, f), bx, by, bz, bd, w);
        addPlane(q, qAt(j, f), bx, by, bz, bd, w);
      }
    }
  }

  const neighbours = (v: number): number[] => {
    const out = new Set<number>();
    for (const t of faces[v] as number[])
      for (let k = 0; k < 3; k++) {
        const w = tri[t * 3 + k] as number;
        if (w !== v) out.add(w);
      }
    return [...out].sort((a, b) => a - b);
  };
  /** Live triangles holding both `a` and `b`. */
  const shared = (a: number, b: number): number[] =>
    (faces[a] as number[]).filter(
      (t) => tri[t * 3] === b || tri[t * 3 + 1] === b || tri[t * 3 + 2] === b,
    );
  const isBoundaryEdge = (a: number, b: number) => shared(a, b).length === 1;
  const isBoundaryVertex = (v: number) => neighbours(v).some((w) => isBoundaryEdge(v, w));

  const cost = (u: number, v: number): number => {
    let e = 0;
    for (let f = 0; f < F; f++)
      e += error(q, qAt(u, f), qAt(v, f), pos(f, v, 0), pos(f, v, 1), pos(f, v, 2));
    return Math.max(0, e) * (importance[u] as number);
  };

  /** Whether moving `u` onto `v` keeps the surface a manifold, its borders and every triangle's facing. */
  const valid = (u: number, v: number): boolean => {
    const both = shared(u, v);
    if (both.length === 0 || both.length > 2) return false;
    // A closed tetrahedron (the last of a small closed part) would fold into two triangles.
    if (both.length === 2 && neighbours(u).length === 3 && neighbours(v).length === 3) return false;
    // A border vertex moves only along its border.
    if (isBoundaryVertex(u) && both.length !== 1) return false;
    // Link condition: the vertices next to both are exactly those across the shared triangles.
    const nu = new Set(neighbours(u));
    const common = neighbours(v).filter((w) => nu.has(w));
    const across = new Set<number>();
    for (const t of both)
      for (let k = 0; k < 3; k++) {
        const w = tri[t * 3 + k] as number;
        if (w !== u && w !== v) across.add(w);
      }
    if (common.length !== across.size || common.some((w) => !across.has(w))) return false;
    for (const t of faces[u] as number[]) {
      if (both.includes(t)) continue;
      const vs = [tri[t * 3] as number, tri[t * 3 + 1] as number, tri[t * 3 + 2] as number];
      const moved = vs.map((w) => (w === u ? v : w));
      for (let f = 0; f < F; f++) {
        const before = normal(f, vs);
        const after = normal(f, moved);
        const la = Math.hypot(after[0], after[1], after[2]);
        if (la / 2 < MIN_AREA) return false;
        const lb = Math.hypot(before[0], before[1], before[2]);
        if (lb === 0) continue;
        const cos =
          (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (la * lb);
        if (cos < MIN_TURN_COS) return false;
      }
    }
    return true;
  };

  // A candidate is current while neither end has changed since it was costed:
  // each vertex counts the collapses onto it, and a candidate keeps both counts.
  const stamp = new Int32Array(V);
  const version = (a: number, b: number) => (stamp[a] as number) * 1e6 + (stamp[b] as number);
  const heap = new CollapseHeap();
  const pushEdge = (a: number, b: number) => {
    heap.push(cost(a, b), a, b, version(a, b));
    heap.push(cost(b, a), b, a, version(b, a));
  };
  // Initial candidates: both directions of every edge, once.
  for (let v = 0; v < V; v++) for (const w of neighbours(v)) if (w > v) pushEdge(v, w);

  const parent = Int32Array.from({ length: V }, (_, i) => i);
  const root = (v: number): number => {
    let r = v;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[v] !== r) {
      const next = parent[v] as number;
      parent[v] = r;
      v = next;
    }
    return r;
  };
  const levels: DecimateLevel[] = [];
  const record = (target: number) => {
    const out: number[] = [];
    for (let t = 0; t < T; t++)
      if (alive[t])
        out.push(tri[t * 3] as number, tri[t * 3 + 1] as number, tri[t * 3 + 2] as number);
    levels.push({
      target,
      index: Uint32Array.from(out),
      owner: Int32Array.from({ length: V }, (_, i) => root(i)),
    });
  };
  let next = 0;
  const recordReached = () => {
    while (next < targets.length && liveTriangles <= (targets[next] as number))
      record(targets[next++] as number);
  };
  recordReached();
  const removed = new Uint8Array(V);
  while (next < targets.length && heap.size > 0) {
    const [u, v, s] = heap.pop();
    if (removed[u] || removed[v] || s !== version(u, v)) continue;
    if (!valid(u, v)) continue;
    // Collapse u onto v.
    const both = shared(u, v);
    for (const t of both) {
      alive[t] = 0;
      liveTriangles--;
      for (let k = 0; k < 3; k++) {
        const w = tri[t * 3 + k] as number;
        const list = faces[w] as number[];
        list.splice(list.indexOf(t), 1);
      }
    }
    for (const t of faces[u] as number[]) {
      for (let k = 0; k < 3; k++) if (tri[t * 3 + k] === u) tri[t * 3 + k] = v;
      (faces[v] as number[]).push(t);
    }
    (faces[v] as number[]).sort((a, b) => a - b);
    faces[u] = [];
    removed[u] = 1;
    parent[u] = v;
    for (let f = 0; f < F; f++) {
      const a = qAt(v, f);
      const b = qAt(u, f);
      for (let k = 0; k < Q; k++) q[a + k] = (q[a + k] as number) + (q[b + k] as number);
    }
    stamp[v] = (stamp[v] as number) + 1;
    // The kept vertex's edges are costed afresh; its neighbours' other edges keep
    // their cost but may have become legal (a refused collapse is dropped when
    // popped), so they are offered again.
    const ring = neighbours(v);
    for (const w of ring) pushEdge(v, w);
    for (const w of ring) for (const x of neighbours(w)) if (x !== v) pushEdge(w, x);
    recordReached();
  }
  // Targets the surface could not reach keep the coarsest level it allowed.
  while (next < targets.length) record(targets[next++] as number);
  return levels;
}
