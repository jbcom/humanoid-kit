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

type Row = Map<number, number>;

const addTo = (row: Row, v: number, w: number) => row.set(v, (row.get(v) ?? 0) + w);

function toStencil(inputCount: number, rows: Row[]): Stencil {
  const offsets = new Uint32Array(rows.length + 1);
  let n = 0;
  rows.forEach((r, i) => {
    n += r.size;
    offsets[i + 1] = n;
  });
  const src = new Uint32Array(n);
  const weights = new Float32Array(n);
  let k = 0;
  for (const r of rows) {
    for (const [s, w] of [...r].sort((a, b) => a[0] - b[0])) {
      src[k] = s;
      weights[k] = w;
      k++;
    }
  }
  return { inputCount, offsets, src, weights };
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
  const edgeIndex = new Map<number, number>();
  const edgeVerts: number[] = [];
  const edgeFaces: number[][] = [];
  const faceEdges = new Uint32Array(F * 4);
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < 4; k++) {
      const a = faces[f * 4 + k] as number;
      const b = faces[f * 4 + ((k + 1) % 4)] as number;
      const key = edgeKey(a, b);
      let e = edgeIndex.get(key);
      if (e === undefined) {
        e = edgeVerts.length / 2;
        edgeIndex.set(key, e);
        edgeVerts.push(a, b);
        edgeFaces.push([]);
      }
      edgeFaces[e]?.push(f);
      faceEdges[f * 4 + k] = e;
    }
  }
  const E = edgeVerts.length / 2;

  const faceRow = (f: number): Row => {
    const r: Row = new Map();
    for (let k = 0; k < 4; k++) addTo(r, faces[f * 4 + k] as number, 0.25);
    return r;
  };
  const faceRows: Row[] = Array.from({ length: F }, (_, f) => faceRow(f));

  const isBoundaryEdge = (e: number) => (edgeFaces[e]?.length ?? 0) !== 2;
  const edgeRows: Row[] = new Array(E);
  for (let e = 0; e < E; e++) {
    const a = edgeVerts[e * 2] as number;
    const b = edgeVerts[e * 2 + 1] as number;
    const r: Row = new Map();
    if (isBoundaryEdge(e)) {
      addTo(r, a, 0.5);
      addTo(r, b, 0.5);
    } else {
      addTo(r, a, 0.25);
      addTo(r, b, 0.25);
      for (const f of edgeFaces[e] ?? [])
        for (const [s, w] of faceRows[f] as Row) addTo(r, s, w * 0.25);
    }
    edgeRows[e] = r;
  }

  // Per-vertex incident edges and faces.
  const vEdges: number[][] = Array.from({ length: V }, () => []);
  for (let e = 0; e < E; e++) {
    vEdges[edgeVerts[e * 2] as number]?.push(e);
    vEdges[edgeVerts[e * 2 + 1] as number]?.push(e);
  }
  const vFaces: number[][] = Array.from({ length: V }, () => []);
  for (let f = 0; f < F; f++)
    for (let k = 0; k < 4; k++) vFaces[faces[f * 4 + k] as number]?.push(f);

  const vertRows: Row[] = new Array(V);
  for (let v = 0; v < V; v++) {
    const r: Row = new Map();
    const es = vEdges[v] ?? [];
    const fs = vFaces[v] ?? [];
    const boundary = es.filter(isBoundaryEdge);
    if (es.length === 0) {
      addTo(r, v, 1);
    } else if (boundary.length > 0) {
      // Two boundary edges on a single face is a corner: keep it fixed.
      if (boundary.length === 2 && fs.length > 1) {
        addTo(r, v, 6 / 8);
        for (const e of boundary) {
          const o =
            edgeVerts[e * 2] === v
              ? (edgeVerts[e * 2 + 1] as number)
              : (edgeVerts[e * 2] as number);
          addTo(r, o, 1 / 8);
        }
      } else {
        addTo(r, v, 1); // corner or non-manifold: keep it fixed
      }
    } else {
      const n = es.length;
      // (F + 2R + (n - 3)P) / n with F = mean face point, R = mean edge midpoint.
      for (const f of fs) for (const [s, w] of faceRows[f] as Row) addTo(r, s, w / fs.length / n);
      for (const e of es) {
        addTo(r, edgeVerts[e * 2] as number, (2 * 0.5) / es.length / n);
        addTo(r, edgeVerts[e * 2 + 1] as number, (2 * 0.5) / es.length / n);
      }
      addTo(r, v, (n - 3) / n);
    }
    vertRows[v] = r;
  }

  const out = new Uint32Array(F * 16);
  for (let f = 0; f < F; f++) {
    const fp = V + E + f;
    for (let k = 0; k < 4; k++) {
      const v = faces[f * 4 + k] as number;
      const eNext = V + (faceEdges[f * 4 + k] as number);
      const ePrev = V + (faceEdges[f * 4 + ((k + 3) % 4)] as number);
      out.set([v, eNext, fp, ePrev], f * 16 + k * 4);
    }
  }
  return {
    stencil: toStencil(V, [...vertRows, ...edgeRows, ...faceRows]),
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
  const rows: Row[] = [];
  for (let i = 0; i + 1 < b.offsets.length; i++) {
    const r: Row = new Map();
    for (let k = b.offsets[i] as number; k < (b.offsets[i + 1] as number); k++) {
      const mid = b.src[k] as number;
      const wb = b.weights[k] as number;
      for (let j = a.offsets[mid] as number; j < (a.offsets[mid + 1] as number); j++) {
        addTo(r, a.src[j] as number, wb * (a.weights[j] as number));
      }
    }
    rows.push(r);
  }
  return toStencil(a.inputCount, rows);
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
