/**
 * Contact between two parts of one body mesh (docs/ARCHITECTURE.md, "The hip
 * fold"): how far a point lies from a patch of the body's skin, and on which
 * side of it.
 *
 * A part of the body (the trunk) is a patch of the whole body's triangles,
 * open at the neck, the shoulders and the hips, so it has no inside to test a
 * point against. The side is the sign of the point's offset from the nearest
 * skin along the surface's normal there: the triangle's own when the nearest
 * point is on its face, and the angle-weighted pseudo-normal of the edge or the
 * corner when it is on one (Bærentzen and Aanæs), which is what makes the sign
 * right at a ridge. A patch's triangles wind outward, like the body's. A point
 * whose nearest skin is the patch's own edge is not facing it (the body's skin
 * goes on past the edge, bending away, and a point on that skin is neither in
 * front of the patch nor behind it): it has no signed distance, and reads as
 * clear (`Infinity`).
 */

/** Where on its triangle the closest point is: the face, a corner (A, B, C) or an edge (AB, BC, CA). */
// (a plain object, not an enum: the repo's TypeScript is erasable syntax only)
const Feature = { Face: 0, A: 1, B: 2, C: 3, AB: 4, BC: 5, CA: 6 } as const;

/**
 * Squared distance from (px, py, pz) to triangle `t` of `P`, the closest point
 * left in `out` and its `Feature` returned through `which`.
 */
function closestOnTriangle(
  px: number,
  py: number,
  pz: number,
  P: Float32Array,
  tris: Uint32Array,
  t: number,
  out: Float64Array,
  which: Uint8Array,
): number {
  const i = (tris[t] as number) * 3;
  const j = (tris[t + 1] as number) * 3;
  const k = (tris[t + 2] as number) * 3;
  const ax = P[i] as number;
  const ay = P[i + 1] as number;
  const az = P[i + 2] as number;
  const abx = (P[j] as number) - ax;
  const aby = (P[j + 1] as number) - ay;
  const abz = (P[j + 2] as number) - az;
  const acx = (P[k] as number) - ax;
  const acy = (P[k + 1] as number) - ay;
  const acz = (P[k + 2] as number) - az;
  const d1 = abx * (px - ax) + aby * (py - ay) + abz * (pz - az);
  const d2 = acx * (px - ax) + acy * (py - ay) + acz * (pz - az);
  const d3 = abx * (px - ax - abx) + aby * (py - ay - aby) + abz * (pz - az - abz);
  const d4 = acx * (px - ax - abx) + acy * (py - ay - aby) + acz * (pz - az - abz);
  const d5 = abx * (px - ax - acx) + aby * (py - ay - acy) + abz * (pz - az - acz);
  const d6 = acx * (px - ax - acx) + acy * (py - ay - acy) + acz * (pz - az - acz);
  const vc = d1 * d4 - d3 * d2;
  const vb = d5 * d2 - d1 * d6;
  const va = d3 * d6 - d5 * d4;
  let u = 0;
  let v = 0;
  let f: number = Feature.Face;
  if (d1 <= 0 && d2 <= 0) {
    f = Feature.A;
  } else if (d3 >= 0 && d4 <= d3) {
    u = 1;
    f = Feature.B;
  } else if (d6 >= 0 && d5 <= d6) {
    v = 1;
    f = Feature.C;
  } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    u = d1 / (d1 - d3);
    f = Feature.AB;
  } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    v = d2 / (d2 - d6);
    f = Feature.CA;
  } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    v = (d4 - d3) / (d4 - d3 + (d5 - d6));
    u = 1 - v;
    f = Feature.BC;
  } else {
    const den = 1 / (va + vb + vc);
    u = vb * den;
    v = vc * den;
  }
  const qx = ax + abx * u + acx * v;
  const qy = ay + aby * u + acy * v;
  const qz = az + abz * u + acz * v;
  out[0] = qx;
  out[1] = qy;
  out[2] = qz;
  which[0] = f;
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

/** A patch of the body's skin: triangles (vertex index triples) over `vertexCount` vertices. */
export class SkinPatch {
  readonly tris: Uint32Array;
  readonly vertexCount: number;
  /** The number of the undirected edge each side of each triangle is: sides AB, BC, CA of triangle `t` are `edgeOf[t * 3 + k]`. */
  readonly edgeOf: Uint32Array;
  /** How many edges the patch has. */
  readonly edges: number;
  /** 1 for an edge only one triangle has: the patch's own boundary. */
  readonly boundaryEdge: Uint8Array;
  /** 1 for a vertex on the patch's boundary. */
  readonly boundaryVertex: Uint8Array;

  constructor(tris: Uint32Array, vertexCount: number) {
    this.tris = tris;
    this.vertexCount = vertexCount;
    const ids = new Map<number, number>();
    const uses: number[] = [];
    this.edgeOf = new Uint32Array(tris.length);
    for (let t = 0; t < tris.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = tris[t + k] as number;
        const b = tris[t + ((k + 1) % 3)] as number;
        const key = a < b ? a * vertexCount + b : b * vertexCount + a;
        let id = ids.get(key);
        if (id === undefined) {
          id = ids.size;
          ids.set(key, id);
          uses.push(0);
        }
        this.edgeOf[t + k] = id;
        uses[id] = (uses[id] as number) + 1;
      }
    this.edges = ids.size;
    this.boundaryEdge = Uint8Array.from(uses, (u) => (u === 1 ? 1 : 0));
    this.boundaryVertex = new Uint8Array(vertexCount);
    for (let t = 0; t < tris.length; t += 3)
      for (let k = 0; k < 3; k++)
        if (this.boundaryEdge[this.edgeOf[t + k] as number]) {
          this.boundaryVertex[tris[t + k] as number] = 1;
          this.boundaryVertex[tris[t + ((k + 1) % 3)] as number] = 1;
        }
  }

  /** The patch in the pose `P` (the body's positions). */
  pose(P: Float32Array): PosedSkin {
    return new PosedSkin(this, P);
  }
}

/** A `SkinPatch` in one pose, with the normals the side of a point is read from. */
export class PosedSkin {
  readonly patch: SkinPatch;
  readonly P: Float32Array;
  /** Unit normal per triangle. */
  private readonly face: Float32Array;
  /** Angle-weighted pseudo-normal per vertex, by vertex index (only the patch's are filled). */
  private readonly corner: Float32Array;
  /** Sum of the normals of the (one or two) triangles on each edge. */
  private readonly edge: Float32Array;
  private readonly closest = new Float64Array(3);
  private readonly which = new Uint8Array(1);

  constructor(patch: SkinPatch, P: Float32Array) {
    this.patch = patch;
    this.P = P;
    const { tris, vertexCount } = patch;
    const count = tris.length / 3;
    this.face = new Float32Array(count * 3);
    this.corner = new Float32Array(vertexCount * 3);
    this.edge = new Float32Array(patch.edges * 3);
    const p = (v: number, k: number) => P[v * 3 + k] as number;
    for (let t = 0; t < count; t++) {
      const a = tris[t * 3] as number;
      const b = tris[t * 3 + 1] as number;
      const c = tris[t * 3 + 2] as number;
      const e1 = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)] as const;
      const e2 = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)] as const;
      let nx = e1[1] * e2[2] - e1[2] * e2[1];
      let ny = e1[2] * e2[0] - e1[0] * e2[2];
      let nz = e1[0] * e2[1] - e1[1] * e2[0];
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      this.face.set([nx, ny, nz], t * 3);
      // The corner angles weight each vertex's pseudo-normal.
      const corners: [number, number, number][] = [
        [a, b, c],
        [b, c, a],
        [c, a, b],
      ];
      for (const [v, u, w] of corners) {
        const ux = p(u, 0) - p(v, 0);
        const uy = p(u, 1) - p(v, 1);
        const uz = p(u, 2) - p(v, 2);
        const wx = p(w, 0) - p(v, 0);
        const wy = p(w, 1) - p(v, 1);
        const wz = p(w, 2) - p(v, 2);
        const cos =
          (ux * wx + uy * wy + uz * wz) / (Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz) || 1);
        const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
        this.corner[v * 3] = (this.corner[v * 3] as number) + nx * angle;
        this.corner[v * 3 + 1] = (this.corner[v * 3 + 1] as number) + ny * angle;
        this.corner[v * 3 + 2] = (this.corner[v * 3 + 2] as number) + nz * angle;
      }
      for (let k = 0; k < 3; k++) {
        const e = (patch.edgeOf[t * 3 + k] as number) * 3;
        this.edge[e] = (this.edge[e] as number) + nx;
        this.edge[e + 1] = (this.edge[e + 1] as number) + ny;
        this.edge[e + 2] = (this.edge[e + 2] as number) + nz;
      }
    }
  }

  /**
   * The signed distance from (x, y, z) to the skin of the triangles
   * `candidates` (the whole patch when omitted): positive outside the skin,
   * negative behind it. The closest point is left in `point`, and the skin's
   * unit normal there (the way out) in `outward`.
   */
  signed(
    x: number,
    y: number,
    z: number,
    point: Float64Array,
    candidates?: ArrayLike<number>,
    outward?: Float64Array,
  ): number {
    const { tris, edgeOf, boundaryVertex, boundaryEdge } = this.patch;
    let best = Number.POSITIVE_INFINITY;
    let bestTri = -1;
    let bestFeature = 0;
    const n = candidates ? candidates.length : tris.length / 3;
    for (let c = 0; c < n; c++) {
      const t = candidates ? (candidates[c] as number) : c;
      const d = closestOnTriangle(x, y, z, this.P, tris, t * 3, this.closest, this.which);
      if (d < best) {
        best = d;
        bestTri = t;
        bestFeature = this.which[0] as number;
        point.set(this.closest);
      }
    }
    if (bestTri < 0) return Number.POSITIVE_INFINITY;
    const a = tris[bestTri * 3] as number;
    const b = tris[bestTri * 3 + 1] as number;
    const c = tris[bestTri * 3 + 2] as number;
    let normal: ArrayLike<number> = this.face.subarray(bestTri * 3, bestTri * 3 + 3);
    let edge = false;
    switch (bestFeature) {
      case Feature.A:
        edge = boundaryVertex[a] === 1;
        normal = this.corner.subarray(a * 3, a * 3 + 3);
        break;
      case Feature.B:
        edge = boundaryVertex[b] === 1;
        normal = this.corner.subarray(b * 3, b * 3 + 3);
        break;
      case Feature.C:
        edge = boundaryVertex[c] === 1;
        normal = this.corner.subarray(c * 3, c * 3 + 3);
        break;
      case Feature.AB:
      case Feature.BC:
      case Feature.CA: {
        const e = edgeOf[bestTri * 3 + (bestFeature - Feature.AB)] as number;
        edge = boundaryEdge[e] === 1;
        normal = this.edge.subarray(e * 3, e * 3 + 3);
        break;
      }
    }
    const nx = normal[0] as number;
    const ny = normal[1] as number;
    const nz = normal[2] as number;
    const length = Math.hypot(nx, ny, nz) || 1;
    if (outward) {
      outward[0] = nx / length;
      outward[1] = ny / length;
      outward[2] = nz / length;
    }
    // Past the patch's own edge a point has no front or back: the skin goes on, bending away, and a point on it is not behind the patch.
    if (edge) return Number.POSITIVE_INFINITY;
    const distance = Math.sqrt(best);
    const side =
      (x - (point[0] as number)) * nx +
      (y - (point[1] as number)) * ny +
      (z - (point[2] as number)) * nz;
    return side < 0 ? -distance : distance;
  }
}

/** Cells (metres) of the grid a `TriangleCrossings` finds triangles in. */
const CROSSING_CELL = 0.04;

/**
 * Where edges of the body's mesh cross a set of its triangles (docs/ARCHITECTURE.md,
 * "The hip fold"): skin through skin, a fact of the posed mesh that does not
 * depend on which side of any surface a point is judged to lie on, so it does
 * not flicker from pose to pose. The triangles are indexed by the cells their
 * boxes cover; an edge is tested against those in the cells its own box covers.
 */
export class TriangleCrossings {
  /** The triangles (vertex index triples) and the positions they are in. */
  readonly tris: Uint32Array;
  readonly P: Float32Array;
  /** The grid's lowest corner and its size in cells. */
  private readonly low: [number, number, number] = [0, 0, 0];
  private readonly size: [number, number, number] = [1, 1, 1];
  /** Triangle numbers by cell, in rows: cell `c` holds `list[start[c]..start[c + 1]]`. */
  private readonly start: Uint32Array;
  private readonly list: Uint32Array;
  /** Triangle outward unit normals, three each. */
  private readonly normals: Float32Array;
  private readonly stamp: Int32Array;
  private pass = 0;
  /** The triangles the last `find` found, and how many. */
  readonly hits: Int32Array;

  constructor(P: Float32Array, tris: Uint32Array) {
    this.tris = tris;
    this.P = P;
    const count = tris.length / 3;
    this.normals = new Float32Array(count * 3);
    this.stamp = new Int32Array(count);
    this.hits = new Int32Array(count);
    const lo = new Float64Array(count * 3);
    const hi = new Float64Array(count * 3);
    const all = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const top = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (let t = 0; t < count; t++) {
      const a = tris[t * 3] as number;
      const b = tris[t * 3 + 1] as number;
      const c = tris[t * 3 + 2] as number;
      const p = (v: number, k: number) => P[v * 3 + k] as number;
      const e1x = p(b, 0) - p(a, 0);
      const e1y = p(b, 1) - p(a, 1);
      const e1z = p(b, 2) - p(a, 2);
      const e2x = p(c, 0) - p(a, 0);
      const e2y = p(c, 1) - p(a, 1);
      const e2z = p(c, 2) - p(a, 2);
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz) || 1;
      this.normals[t * 3] = nx / len;
      this.normals[t * 3 + 1] = ny / len;
      this.normals[t * 3 + 2] = nz / len;
      for (let k = 0; k < 3; k++) {
        const l = Math.min(p(a, k), p(b, k), p(c, k));
        const h = Math.max(p(a, k), p(b, k), p(c, k));
        lo[t * 3 + k] = l;
        hi[t * 3 + k] = h;
        all[k] = Math.min(all[k] as number, l);
        top[k] = Math.max(top[k] as number, h);
      }
    }
    for (let k = 0; k < 3; k++) {
      this.low[k] = Number.isFinite(all[k]) ? (all[k] as number) : 0;
      this.size[k] = Number.isFinite(top[k])
        ? Math.floor(((top[k] as number) - (this.low[k] as number)) / CROSSING_CELL) + 1
        : 1;
    }
    const cells = this.size[0] * this.size[1] * this.size[2];
    // The triangles in each cell their box covers: counted, then filled.
    const start = new Uint32Array(cells + 1);
    const list: number[][] = [];
    const [sx, sy] = this.size;
    for (let t = 0; t < count; t++) {
      const [i0, j0, k0] = this.cellOf(
        lo[t * 3] as number,
        lo[t * 3 + 1] as number,
        lo[t * 3 + 2] as number,
      );
      const [i1, j1, k1] = this.cellOf(
        hi[t * 3] as number,
        hi[t * 3 + 1] as number,
        hi[t * 3 + 2] as number,
      );
      for (let k = k0; k <= k1; k++)
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const c = i + sx * (j + sy * k);
            start[c + 1] = (start[c + 1] as number) + 1;
            const row = list[c];
            if (row) row.push(t);
            else list[c] = [t];
          }
    }
    for (let c = 0; c < cells; c++) start[c + 1] = (start[c + 1] as number) + (start[c] as number);
    this.start = start;
    this.list = new Uint32Array(start[cells] as number);
    for (let c = 0; c < cells; c++) this.list.set(list[c] ?? [], start[c] as number);
  }

  /** The cell a point is in, clamped to the grid. */
  private cellOf(x: number, y: number, z: number): [number, number, number] {
    const f = (v: number, axis: 0 | 1 | 2) =>
      Math.min(
        (this.size[axis] as number) - 1,
        Math.max(0, Math.floor((v - (this.low[axis] as number)) / CROSSING_CELL)),
      );
    return [f(x, 0), f(y, 1), f(z, 2)];
  }

  /** How far (metres) vertex `v` lies in front of triangle `t`'s plane: negative behind it. */
  side(t: number, v: number): number {
    const { P, tris, normals } = this;
    const a = tris[t * 3] as number;
    return (
      ((P[v * 3] as number) - (P[a * 3] as number)) * (normals[t * 3] as number) +
      ((P[v * 3 + 1] as number) - (P[a * 3 + 1] as number)) * (normals[t * 3 + 1] as number) +
      ((P[v * 3 + 2] as number) - (P[a * 3 + 2] as number)) * (normals[t * 3 + 2] as number)
    );
  }

  /** Triangle `t`'s outward unit normal, into `out`. */
  normal(t: number, out: ArrayLike<number> & { [i: number]: number }): void {
    for (let k = 0; k < 3; k++) out[k] = this.normals[t * 3 + k] as number;
  }

  /**
   * Finds the triangles edge a-b crosses, except those with a or b as a
   * corner: the surface's own. They are left in `hits`, and how many is returned.
   * The positions `P` may have moved since the triangles were indexed.
   */
  find(a: number, b: number): number {
    const { P, tris, hits, stamp } = this;
    const [sx, sy] = this.size;
    const x0 = P[a * 3] as number;
    const y0 = P[a * 3 + 1] as number;
    const z0 = P[a * 3 + 2] as number;
    const x1 = P[b * 3] as number;
    const y1 = P[b * 3 + 1] as number;
    const z1 = P[b * 3 + 2] as number;
    const [i0, j0, k0] = this.cellOf(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    const [i1, j1, k1] = this.cellOf(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
    this.pass++;
    let found = 0;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const c = i + sx * (j + sy * k);
          for (let e = this.start[c] as number; e < (this.start[c + 1] as number); e++) {
            const t = this.list[e] as number;
            if (stamp[t] === this.pass) continue;
            stamp[t] = this.pass;
            const p = tris[t * 3] as number;
            const q = tris[t * 3 + 1] as number;
            const r = tris[t * 3 + 2] as number;
            if (p === a || q === a || r === a || p === b || q === b || r === b) continue;
            if (this.crosses(a, b, p, q, r)) hits[found++] = t;
          }
        }
    return found;
  }

  /** Whether segment a-b passes through triangle i, j, k (Möller–Trumbore along the segment). */
  private crosses(a: number, b: number, i: number, j: number, k: number): boolean {
    const P = this.P;
    const ox = P[i * 3] as number;
    const oy = P[i * 3 + 1] as number;
    const oz = P[i * 3 + 2] as number;
    const e1x = (P[j * 3] as number) - ox;
    const e1y = (P[j * 3 + 1] as number) - oy;
    const e1z = (P[j * 3 + 2] as number) - oz;
    const e2x = (P[k * 3] as number) - ox;
    const e2y = (P[k * 3 + 1] as number) - oy;
    const e2z = (P[k * 3 + 2] as number) - oz;
    const dx = (P[b * 3] as number) - (P[a * 3] as number);
    const dy = (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number);
    const dz = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-14) return false;
    const sx = (P[a * 3] as number) - ox;
    const sy = (P[a * 3 + 1] as number) - oy;
    const sz = (P[a * 3 + 2] as number) - oz;
    const u = (sx * hx + sy * hy + sz * hz) / det;
    if (u < 0 || u > 1) return false;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) / det;
    if (v < 0 || u + v > 1) return false;
    const along = (e2x * qx + e2y * qy + e2z * qz) / det;
    return along >= 0 && along <= 1;
  }
}
