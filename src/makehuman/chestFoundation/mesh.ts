/**
 * Mesh utilities for the source-derived chest foundation: the body's vertex set and
 * quad adjacency, normals, and the fixed-boundary source interpolation.
 */
import type { BodyManifest, HumanoidAssets } from "../../format/assetFormat.ts";

export interface BodyMesh {
  /** Quad corner indices of the drawn body, four per face. */
  faces: Uint32Array;
  /** Every vertex the body's faces use, ascending. */
  vertices: Uint32Array;
  /** CSR neighbour lists over `vertexCount` base vertices (empty for unused ones). */
  start: Uint32Array;
  items: Uint32Array;
  vertexCount: number;
}

export function bodyMesh(assets: HumanoidAssets, manifest: BodyManifest): BodyMesh {
  const group = manifest.groups.find((g) => g.name === "body");
  if (!group) throw new Error("body face group missing");
  const faces = assets.faceVerts.slice(
    group.faceStart * 4,
    (group.faceStart + group.faceCount) * 4,
  );
  const n = manifest.vertexCount;
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set());
  const used = new Set<number>();
  for (let f = 0; f < faces.length; f += 4)
    for (let k = 0; k < 4; k++) {
      const a = faces[f + k] as number;
      const b = faces[f + ((k + 1) % 4)] as number;
      used.add(a);
      sets[a]?.add(b);
      sets[b]?.add(a);
    }
  const start = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) start[v + 1] = (start[v] as number) + (sets[v]?.size ?? 0);
  const items = new Uint32Array(start[n] as number);
  for (let v = 0; v < n; v++) {
    let k = start[v] as number;
    for (const w of sets[v] ?? []) items[k++] = w;
  }
  return {
    faces,
    vertices: Uint32Array.from([...used].sort((a, b) => a - b)),
    start,
    items,
    vertexCount: n,
  };
}

export const neighbours = (m: BodyMesh, v: number): Uint32Array =>
  m.items.subarray(m.start[v] as number, m.start[v + 1] as number);

/** Area-weighted vertex normals over the body's quads (split into two triangles each). */
export function vertexNormals(m: BodyMesh, positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length);
  const tri = (a: number, b: number, c: number) => {
    const ux = (positions[b * 3] as number) - (positions[a * 3] as number);
    const uy = (positions[b * 3 + 1] as number) - (positions[a * 3 + 1] as number);
    const uz = (positions[b * 3 + 2] as number) - (positions[a * 3 + 2] as number);
    const vx = (positions[c * 3] as number) - (positions[a * 3] as number);
    const vy = (positions[c * 3 + 1] as number) - (positions[a * 3 + 1] as number);
    const vz = (positions[c * 3 + 2] as number) - (positions[a * 3 + 2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      out[v * 3] = (out[v * 3] as number) + nx;
      out[v * 3 + 1] = (out[v * 3 + 1] as number) + ny;
      out[v * 3 + 2] = (out[v * 3 + 2] as number) + nz;
    }
  };
  for (let f = 0; f < m.faces.length; f += 4) {
    const [a, b, c, d] = [m.faces[f], m.faces[f + 1], m.faces[f + 2], m.faces[f + 3]] as [
      number,
      number,
      number,
      number,
    ];
    tri(a, b, c);
    tri(a, c, d);
  }
  for (let v = 0; v < out.length / 3; v++) {
    const l = Math.hypot(out[v * 3] as number, out[v * 3 + 1] as number, out[v * 3 + 2] as number);
    if (l > 0) for (let k = 0; k < 3; k++) out[v * 3 + k] = (out[v * 3 + k] as number) / l;
  }
  return out;
}

/** Breadth-first hop distance from `seeds`, capped at `limit` (unreached = limit + 1). */
export function hopDistance(m: BodyMesh, seeds: Iterable<number>, limit: number): Uint8Array {
  const d = new Uint8Array(m.vertexCount).fill(limit + 1);
  let frontier: number[] = [];
  for (const s of seeds) {
    d[s] = 0;
    frontier.push(s);
  }
  for (let hop = 1; hop <= limit; hop++) {
    const next: number[] = [];
    for (const v of frontier)
      for (const w of neighbours(m, v))
        if ((d[w] as number) > hop) {
          d[w] = hop;
          next.push(w);
        }
    frontier = next;
  }
  return d;
}

/**
 * Biharmonic fill: for the interior vertices `free`, solves `L²x = 0` with every
 * other vertex fixed (two fixed rings give a position-and-slope clamp), where `L`
 * is the graph Laplacian with inverse-edge-length weights. Returns the filled positions for `values`'
 * three channels (a copy; fixed vertices unchanged). Dense Cholesky: `free` is a
 * few thousand at most. `weightsFrom` is the geometry the edge lengths are read
 * from (default: `values` itself); passing a fixed rest mesh makes the fill one
 * fixed linear map of the ring, the same for every figure.
 */
export function biharmonicFill(
  m: BodyMesh,
  values: Float32Array,
  free: readonly number[],
  weightsFrom: Float32Array = values,
): Float32Array {
  const idx = new Map<number, number>();
  free.forEach((v, i) => {
    idx.set(v, i);
  });
  const n = free.length;
  // L² restricted to free rows/cols; fixed columns go to the right-hand side.
  // Row r of L: (deg · e_r − Σ neighbours); (L²)_{r,c} = Σ_k L_{r,k} L_{k,c}.
  // Edge weights are 1/length of the figure's own geometry (not 1 per edge): the
  // nipple's 1 to 5 mm micro-cluster would otherwise be treated like 10 mm chest quads.
  const weight = (a: number, b: number) =>
    1 /
    Math.max(
      1e-4,
      Math.hypot(
        (weightsFrom[a * 3] as number) - (weightsFrom[b * 3] as number),
        (weightsFrom[a * 3 + 1] as number) - (weightsFrom[b * 3 + 1] as number),
        (weightsFrom[a * 3 + 2] as number) - (weightsFrom[b * 3 + 2] as number),
      ),
    );
  const lrow = (v: number): [number, number][] => {
    const row: [number, number][] = [[v, 0]];
    let d = 0;
    for (const w of neighbours(m, v)) {
      const k = weight(v, w);
      d += k;
      row.push([w, -k]);
    }
    (row[0] as [number, number])[1] = d;
    return row;
  };
  const A = new Float64Array(n * n);
  const rhs = new Float64Array(n * 3);
  const rowsCache = new Map<number, [number, number][]>();
  const row = (v: number) => {
    const hit = rowsCache.get(v);
    if (hit) return hit;
    const made = lrow(v);
    rowsCache.set(v, made);
    return made;
  };
  // Row r of L² : Σ_k L[r][k]·L[k][c]; k ranges over r and its neighbours.
  for (const v of free) {
    const r = idx.get(v) as number;
    const acc = new Map<number, number>();
    for (const [k, lk] of row(v))
      for (const [c, lc] of row(k)) acc.set(c, (acc.get(c) ?? 0) + lk * lc);
    for (const [c, val] of acc) {
      const ci = idx.get(c);
      if (ci === undefined) {
        for (let a = 0; a < 3; a++)
          rhs[r * 3 + a] = (rhs[r * 3 + a] as number) - val * (values[c * 3 + a] as number);
      } else A[r * n + ci] = (A[r * n + ci] as number) + val;
    }
  }
  // In-place Cholesky A = LLᵀ (A is symmetric positive definite once the ring is fixed).
  for (let j = 0; j < n; j++) {
    let s = A[j * n + j] as number;
    for (let k = 0; k < j; k++) s -= (A[j * n + k] as number) ** 2;
    if (s <= 0) throw new Error(`biharmonic system not positive definite at ${j}`);
    const d = Math.sqrt(s);
    A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let t = A[i * n + j] as number;
      for (let k = 0; k < j; k++) t -= (A[i * n + k] as number) * (A[j * n + k] as number);
      A[i * n + j] = t / d;
    }
  }
  const out = new Float32Array(values);
  for (let a = 0; a < 3; a++) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = rhs[i * 3 + a] as number;
      for (let k = 0; k < i; k++) s -= (A[i * n + k] as number) * (y[k] as number);
      y[i] = s / (A[i * n + i] as number);
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i] as number;
      for (let k = i + 1; k < n; k++) s -= (A[k * n + i] as number) * (x[k] as number);
      x[i] = s / (A[i * n + i] as number);
    }
    free.forEach((v, i) => {
      out[v * 3 + a] = x[i] as number;
    });
  }
  return out;
}

/**
 * Diffuses a per-vertex vector field over the surface: each free vertex moves toward
 * the inverse-length-weighted mean of its neighbours (`alpha` per step), everything
 * outside `free` staying as given (zero for a displacement). Evened-out samples on an
 * irregular mesh, and tightly spaced clusters (the nipple) move as one piece.
 */
export function diffuse(
  m: BodyMesh,
  positions: Float32Array,
  field: Float32Array,
  free: readonly number[],
  steps: number,
  alpha: number,
): Float32Array {
  let cur = new Float32Array(field);
  let next = new Float32Array(field);
  const w = new Map<number, [number[], number[]]>();
  for (const v of free) {
    const ns: number[] = [];
    const ws: number[] = [];
    for (const nb of neighbours(m, v)) {
      ns.push(nb);
      ws.push(
        1 /
          Math.max(
            1e-4,
            Math.hypot(
              (positions[v * 3] as number) - (positions[nb * 3] as number),
              (positions[v * 3 + 1] as number) - (positions[nb * 3 + 1] as number),
              (positions[v * 3 + 2] as number) - (positions[nb * 3 + 2] as number),
            ),
          ),
      );
    }
    w.set(v, [ns, ws]);
  }
  for (let s = 0; s < steps; s++) {
    for (const v of free) {
      const [ns, ws] = w.get(v) as [number[], number[]];
      let tw = 0;
      const acc = [0, 0, 0];
      ns.forEach((nb, i) => {
        const k = ws[i] as number;
        tw += k;
        for (let a = 0; a < 3; a++) acc[a] = (acc[a] as number) + k * (cur[nb * 3 + a] as number);
      });
      for (let a = 0; a < 3; a++)
        next[v * 3 + a] =
          (1 - alpha) * (cur[v * 3 + a] as number) + alpha * ((acc[a] as number) / tw);
    }
    [cur, next] = [next, cur];
  }
  return cur;
}
