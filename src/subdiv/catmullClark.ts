/**
 * Catmull–Clark subdivision as precomputed stencils.
 *
 * The base topology never changes, only vertex positions do, so each refined
 * vertex is a fixed linear combination of control vertices. Building that
 * sparse matrix once lets every later shape edit re-evaluate the smooth
 * surface with one sparse matrix–vector product instead of re-running the
 * subdivision rules.
 *
 * UVs are subdivided face-varying and linearly (MakeHuman's UV layout has
 * seams, and smoothing UVs across a seam would smear textures).
 */

/** A pure-quad mesh: `faces` holds 4 vertex indices per quad. */
export interface QuadTopology {
  vertexCount: number;
  faces: Uint32Array;
}

/** Sparse rows: output vertex i = Σ weights[k] · input[src[k]] for k in [offsets[i], offsets[i+1]). */
export interface Stencil {
  inputCount: number;
  offsets: Uint32Array;
  src: Uint32Array;
  weights: Float32Array;
}

export interface SubdivisionLevel {
  stencil: Stencil;
  topology: QuadTopology;
}

/**
 * Builds a stencil a row at a time. Within a row, weights for the same input
 * accumulate in the order they are added (so sums are exactly those of adding
 * them one by one) and the row is stored sorted by input. A dense accumulator
 * per input, reset only where touched, keeps this free of per-row allocation:
 * stencils run to tens of thousands of rows.
 */
class StencilBuilder {
  private readonly acc: Float64Array;
  /** Per input, the row (plus one) that last touched it. */
  private readonly stamp: Uint32Array;
  private readonly touched: number[] = [];
  private row = 0;
  private src: Uint32Array;
  private weights: Float32Array;
  private readonly offsets: Uint32Array;
  private size = 0;
  private readonly inputCount: number;

  constructor(inputCount: number, rows: number, sizeHint: number) {
    this.inputCount = inputCount;
    this.acc = new Float64Array(inputCount);
    this.stamp = new Uint32Array(inputCount);
    this.offsets = new Uint32Array(rows + 1);
    this.src = new Uint32Array(Math.max(sizeHint, 16));
    this.weights = new Float32Array(this.src.length);
  }

  add(v: number, w: number): void {
    if (this.stamp[v] !== this.row + 1) {
      this.stamp[v] = this.row + 1;
      this.acc[v] = w;
      this.touched.push(v);
    } else this.acc[v] = (this.acc[v] as number) + w;
  }

  /** Ends the current row. */
  next(): void {
    const t = this.touched;
    if (t.length > 1) t.sort((a, b) => a - b);
    if (this.size + t.length > this.src.length) {
      const grown = Math.max(this.src.length * 2, this.size + t.length);
      const src = new Uint32Array(grown);
      src.set(this.src);
      const weights = new Float32Array(grown);
      weights.set(this.weights);
      this.src = src;
      this.weights = weights;
    }
    for (const v of t) {
      this.src[this.size] = v;
      this.weights[this.size] = this.acc[v] as number;
      this.size++;
    }
    t.length = 0;
    this.row++;
    this.offsets[this.row] = this.size;
  }

  build(): Stencil {
    if (this.row !== this.offsets.length - 1)
      throw new Error(`stencil: ${this.row} of ${this.offsets.length - 1} rows built`);
    return {
      inputCount: this.inputCount,
      offsets: this.offsets,
      src: this.src.slice(0, this.size),
      weights: this.weights.slice(0, this.size),
    };
  }
}

/** Compressed lists: the items of list i are `items[start[i] .. start[i + 1])`. */
interface Lists {
  start: Uint32Array;
  items: Uint32Array;
}

/** Groups `count` items by `keyOf`, keeping each list in item order. */
function groupBy(lists: number, count: number, keyOf: (i: number) => number): Lists {
  const start = new Uint32Array(lists + 1);
  for (let i = 0; i < count; i++) {
    const l = keyOf(i) + 1;
    start[l] = (start[l] as number) + 1;
  }
  for (let l = 0; l < lists; l++) start[l + 1] = (start[l + 1] as number) + (start[l] as number);
  const fill = start.slice(0, lists);
  const items = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const l = keyOf(i);
    items[fill[l] as number] = i;
    fill[l] = (fill[l] as number) + 1;
  }
  return { start, items };
}

const edgeKey = (a: number, b: number) => (a < b ? a * 0x200000 + b : b * 0x200000 + a);

/**
 * One level of Catmull–Clark. Output vertex order: original vertices, then
 * one point per edge, then one per face. Boundary edges use the crease rules
 * (midpoint; (prev + 6·v + next) / 8), so open borders such as the neck or eye
 * sockets of a separate part stay put instead of shrinking.
 */
export function catmullClarkLevel(topo: QuadTopology): SubdivisionLevel {
  const { vertexCount: V, faces } = topo;
  const F = faces.length / 4;
  // Edges numbered in order of first appearance, found through a chain per
  // lower vertex; each keeps its first two faces and its face count.
  const head = new Int32Array(V).fill(-1);
  const chain = new Int32Array(F * 4);
  const edgeVerts = new Uint32Array(F * 8);
  const edgeHigh = new Uint32Array(F * 4);
  const edgeFaceCount = new Uint32Array(F * 4);
  const edgeFace = new Uint32Array(F * 8);
  const faceEdges = new Uint32Array(F * 4);
  let E = 0;
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 4; k++) {
      const a = faces[f * 4 + k] as number;
      const b = faces[f * 4 + ((k + 1) % 4)] as number;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      let e = head[lo] as number;
      while (e !== -1 && edgeHigh[e] !== hi) e = chain[e] as number;
      if (e === -1) {
        e = E++;
        edgeHigh[e] = hi;
        chain[e] = head[lo] as number;
        head[lo] = e;
        edgeVerts[e * 2] = a;
        edgeVerts[e * 2 + 1] = b;
      }
      const seen = edgeFaceCount[e] as number;
      if (seen < 2) edgeFace[e * 2 + seen] = f;
      edgeFaceCount[e] = seen + 1;
      faceEdges[f * 4 + k] = e;
    }
  }

  const rows = new StencilBuilder(V, V + E + F, (V + E + F) * 9);
  /** A face point's row (a quarter of each corner), each vertex once, first-corner order. */
  const faceRow = (f: number, add: (s: number, w: number) => void) => {
    for (let k = 0; k < 4; k++) {
      const v = faces[f * 4 + k] as number;
      let repeat = false;
      for (let j = 0; j < k; j++) if (faces[f * 4 + j] === v) repeat = true;
      if (repeat) continue;
      let w = 0.25;
      for (let j = k + 1; j < 4; j++) if (faces[f * 4 + j] === v) w += 0.25;
      add(v, w);
    }
  };
  const isBoundaryEdge = (e: number) => edgeFaceCount[e] !== 2;

  // Per-vertex incident edges (ascending) and faces (ascending, once per corner).
  const vEdges = groupBy(V, E * 2, (i) => edgeVerts[i] as number);
  const vFaces = groupBy(V, F * 4, (c) => faces[c] as number);
  const boundary: number[] = [];
  for (let v = 0; v < V; v++) {
    const e0 = vEdges.start[v] as number;
    const eCount = (vEdges.start[v + 1] as number) - e0;
    const f0 = vFaces.start[v] as number;
    const fCount = (vFaces.start[v + 1] as number) - f0;
    boundary.length = 0;
    for (let i = 0; i < eCount; i++) {
      const e = (vEdges.items[e0 + i] as number) >> 1;
      if (isBoundaryEdge(e)) boundary.push(e);
    }
    if (eCount === 0) {
      rows.add(v, 1);
    } else if (boundary.length > 0) {
      // Two boundary edges on a single face is a corner: keep it fixed.
      if (boundary.length === 2 && fCount > 1) {
        rows.add(v, 6 / 8);
        for (const e of boundary) {
          const o =
            edgeVerts[e * 2] === v
              ? (edgeVerts[e * 2 + 1] as number)
              : (edgeVerts[e * 2] as number);
          rows.add(o, 1 / 8);
        }
      } else {
        rows.add(v, 1); // corner or non-manifold: keep it fixed
      }
    } else {
      const n = eCount;
      // (F + 2R + (n - 3)P) / n with F = mean face point, R = mean edge midpoint.
      for (let i = 0; i < fCount; i++)
        faceRow((vFaces.items[f0 + i] as number) >> 2, (s, w) => rows.add(s, w / fCount / n));
      for (let i = 0; i < eCount; i++) {
        const e = (vEdges.items[e0 + i] as number) >> 1;
        rows.add(edgeVerts[e * 2] as number, (2 * 0.5) / eCount / n);
        rows.add(edgeVerts[e * 2 + 1] as number, (2 * 0.5) / eCount / n);
      }
      rows.add(v, (n - 3) / n);
    }
    rows.next();
  }
  for (let e = 0; e < E; e++) {
    const a = edgeVerts[e * 2] as number;
    const b = edgeVerts[e * 2 + 1] as number;
    if (isBoundaryEdge(e)) {
      rows.add(a, 0.5);
      rows.add(b, 0.5);
    } else {
      rows.add(a, 0.25);
      rows.add(b, 0.25);
      for (let i = 0; i < 2; i++)
        faceRow(edgeFace[e * 2 + i] as number, (s, w) => rows.add(s, w * 0.25));
    }
    rows.next();
  }
  for (let f = 0; f < F; f++) {
    faceRow(f, (s, w) => rows.add(s, w));
    rows.next();
  }

  const out = new Uint32Array(F * 16);
  for (let f = 0; f < F; f++) {
    const fp = V + E + f;
    for (let k = 0; k < 4; k++) {
      const o = f * 16 + k * 4;
      out[o] = faces[f * 4 + k] as number;
      out[o + 1] = V + (faceEdges[f * 4 + k] as number);
      out[o + 2] = fp;
      out[o + 3] = V + (faceEdges[f * 4 + ((k + 3) % 4)] as number);
    }
  }
  return {
    stencil: rows.build(),
    topology: { vertexCount: V + E + F, faces: out },
  };
}

/** Linear (face-varying) subdivision of a UV layout matching `catmullClarkLevel`'s face order. */
export function subdivideUvLinear(
  uvs: Float32Array,
  faceUvs: Uint32Array,
): { uvs: Float32Array; faceUvs: Uint32Array } {
  const F = faceUvs.length / 4;
  const U = uvs.length / 2;
  const edgeIndex = new Map<number, number>();
  const extra: number[] = [];
  const next = new Uint32Array(F * 16);
  const mid = (a: number, b: number) => {
    const key = edgeKey(a, b);
    let e = edgeIndex.get(key);
    if (e === undefined) {
      e = U + extra.length / 2;
      edgeIndex.set(key, e);
      extra.push(
        ((uvs[a * 2] as number) + (uvs[b * 2] as number)) / 2,
        ((uvs[a * 2 + 1] as number) + (uvs[b * 2 + 1] as number)) / 2,
      );
    }
    return e;
  };
  const facePts: number[] = [];
  for (let f = 0; f < F; f++) {
    let u = 0;
    let v = 0;
    for (let k = 0; k < 4; k++) {
      const t = faceUvs[f * 4 + k] as number;
      u += (uvs[t * 2] as number) / 4;
      v += (uvs[t * 2 + 1] as number) / 4;
    }
    facePts.push(u, v);
  }
  const edgePoints: number[] = [];
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 4; k++) {
      edgePoints.push(mid(faceUvs[f * 4 + k] as number, faceUvs[f * 4 + ((k + 1) % 4)] as number));
    }
  }
  const faceBase = U + extra.length / 2;
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 4; k++) {
      next.set(
        [
          faceUvs[f * 4 + k] as number,
          edgePoints[f * 4 + k] as number,
          faceBase + f,
          edgePoints[f * 4 + ((k + 3) % 4)] as number,
        ],
        f * 16 + k * 4,
      );
    }
  }
  const out = new Float32Array(uvs.length + extra.length + facePts.length);
  out.set(uvs);
  out.set(extra, uvs.length);
  out.set(facePts, uvs.length + extra.length);
  return { uvs: out, faceUvs: next };
}

/** Sparse product: (b ∘ a) maps a's inputs straight to b's outputs. */
export function composeStencils(a: Stencil, b: Stencil): Stencil {
  const count = b.offsets.length - 1;
  const rows = new StencilBuilder(a.inputCount, count, b.src.length * 2);
  for (let i = 0; i < count; i++) {
    for (let k = b.offsets[i] as number; k < (b.offsets[i + 1] as number); k++) {
      const mid = b.src[k] as number;
      const wb = b.weights[k] as number;
      for (let j = a.offsets[mid] as number; j < (a.offsets[mid + 1] as number); j++) {
        rows.add(a.src[j] as number, wb * (a.weights[j] as number));
      }
    }
    rows.next();
  }
  return rows.build();
}

/** out[i] = Σ w · input[src] for xyz triples. */
export function applyStencil(s: Stencil, input: Float32Array, out: Float32Array): Float32Array {
  const n = s.offsets.length - 1;
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = s.offsets[i] as number; k < (s.offsets[i + 1] as number); k++) {
      const j = (s.src[k] as number) * 3;
      const w = s.weights[k] as number;
      x += (input[j] as number) * w;
      y += (input[j + 1] as number) * w;
      z += (input[j + 2] as number) * w;
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

/** Identity stencil selecting `vertices` (used for level 0 and for remapping a sub-mesh). */
export function selectionStencil(inputCount: number, vertices: ArrayLike<number>): Stencil {
  const n = vertices.length;
  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i <= n; i++) offsets[i] = i;
  return {
    inputCount,
    offsets,
    src: Uint32Array.from(vertices),
    weights: new Float32Array(n).fill(1),
  };
}
