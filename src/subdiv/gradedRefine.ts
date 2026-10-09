/**
 * Local refinement of a quad mesh: each chosen face is split into 2^level by
 * 2^level cells, and the points that creates on a shared edge become polygon
 * vertices of the less refined neighbour, so the mesh stays conforming (no
 * cracks, no T-junctions) without refining anything else.
 *
 * A quad mesh cannot be refined locally with quads alone: a face with one
 * hanging point has five corners, and any all-quad transition has to carry its
 * dual chord (an edge loop) on to wherever it ends, which on a body is the other
 * side of the figure (the chords through the pelvis run 156 to 900 faces).
 * Catmull–Clark is defined on polygons, so the transition faces are left as
 * pentagons and hexagons and the first subdivision level turns every polygon
 * into quads (`catmullClarkLevel`).
 *
 * Refinement is linear: a new vertex is a fixed bilinear combination of its
 * face's corners (a midpoint of an edge for one on an edge), so the refined mesh
 * follows every shape of the base through one stencil, and a refinement with
 * nothing chosen is the mesh it started from. Base vertices keep their indices;
 * new ones are appended in the order the faces are walked, so anything authored
 * against the refined vertices (a target file) stays valid.
 *
 * UVs refine face-varying like the geometry: a point on a seam gets one UV per
 * side, each bilinear in its own face's UV corners.
 */
import type { Stencil } from "./catmullClark.ts";

/** Levels past this make cells of under a thousandth of a face; refuse them. */
export const MAX_REFINEMENT_LEVEL = 4;

/** The quad mesh to refine (the base body, or any quad part). */
export interface GradedSource {
  vertexCount: number;
  /** Four vertex indices per quad. */
  faceVerts: Uint32Array;
  /** Four UV indices per quad. */
  faceUvs: Uint32Array;
  uvs: Float32Array;
}

/** Which faces to refine, and how much: `levels[i]` for face `faces[i]` (absolute face indices). */
export interface Refinement {
  faces: ArrayLike<number>;
  levels: ArrayLike<number>;
}

export interface GradedMesh {
  /** Control vertices after refinement: the source's, then the appended ones. */
  vertexCount: number;
  /** Polygon `i` is `faces[faceStart[i] .. faceStart[i + 1])`. */
  faceStart: Uint32Array;
  faces: Uint32Array;
  /** UV index per polygon corner, in the same layout as `faces`. */
  faceUvs: Uint32Array;
  /** The source's UVs, then the appended ones. */
  uvs: Float32Array;
  /** Source face each polygon came from. */
  sourceFace: Uint32Array;
  /** Source control vertices → refined control vertices (identity on the source's own). */
  stencil: Stencil;
}

const edgeKey = (a: number, b: number) => (a < b ? a * 0x200000 + b : b * 0x200000 + a);

/**
 * Refines `faces` (indices of the quads to build the mesh from, e.g. a face
 * group) by `refinement`. Throws `RangeError` for a face not among `faces`, a
 * level outside 0 to `MAX_REFINEMENT_LEVEL`, or two neighbouring faces whose
 * levels differ by more than one (a transition would need a polygon with
 * more than a handful of hanging points).
 */
export function refineGraded(
  source: GradedSource,
  faces: ArrayLike<number>,
  refinement: Refinement,
): GradedMesh {
  if (refinement.faces.length !== refinement.levels.length)
    throw new RangeError("refinement: faces and levels differ in length");
  const inMesh = new Set<number>(Array.from(faces));
  const level = new Map<number, number>();
  for (let i = 0; i < refinement.faces.length; i++) {
    const f = refinement.faces[i] as number;
    const l = refinement.levels[i] as number;
    if (!inMesh.has(f)) throw new RangeError(`refinement: face ${f} is not in the mesh`);
    if (!Number.isInteger(l) || l < 0 || l > MAX_REFINEMENT_LEVEL)
      throw new RangeError(
        `refinement: level ${l} of face ${f} is outside 0..${MAX_REFINEMENT_LEVEL}`,
      );
    level.set(f, l);
  }
  const levelOf = (f: number) => level.get(f) ?? 0;
  const fv = source.faceVerts;
  const fu = source.faceUvs;

  // Each edge is split into as many segments as its finer face needs.
  const edgeLevel = new Map<number, number>();
  const edgeSeen = new Map<number, number>();
  for (const f of Array.from(faces)) {
    for (let e = 0; e < 4; e++) {
      const key = edgeKey(fv[f * 4 + e] as number, fv[f * 4 + ((e + 1) % 4)] as number);
      const l = levelOf(f);
      const prior = edgeLevel.get(key);
      if (prior !== undefined && Math.abs(prior - l) > 1)
        throw new RangeError(
          `refinement: neighbouring faces differ by more than one level at an edge of face ${f}`,
        );
      edgeLevel.set(key, Math.max(prior ?? 0, l));
      edgeSeen.set(key, (edgeSeen.get(key) ?? 0) + 1);
    }
  }
  const segments = (key: number) => 1 << (edgeLevel.get(key) as number);

  // New control vertices, as stencil rows over the source's, and new UV points.
  const rowSrc: number[][] = [];
  const rowWeight: number[][] = [];
  const newUv: number[] = [];
  let vertexCount = source.vertexCount;
  const uvBase = source.uvs.length / 2;
  const edgePoints = new Map<number, number>();
  const uvEdgePoints = new Map<string, number>();

  const addVertex = (src: number[], weight: number[]): number => {
    rowSrc.push(src);
    rowWeight.push(weight);
    return vertexCount++;
  };
  const addUv = (u: number, v: number): number => {
    newUv.push(u, v);
    return uvBase + newUv.length / 2 - 1;
  };
  const uvAt = (i: number) => [
    i < uvBase ? (source.uvs[i * 2] as number) : (newUv[(i - uvBase) * 2] as number),
    i < uvBase ? (source.uvs[i * 2 + 1] as number) : (newUv[(i - uvBase) * 2 + 1] as number),
  ];

  /** The control vertex a fraction `k / S` along face `f`'s edge `e` (from its corner `e`). */
  const edgeVertex = (f: number, e: number, k: number, S: number): number => {
    const a = fv[f * 4 + e] as number;
    const b = fv[f * 4 + ((e + 1) % 4)] as number;
    if (k === 0) return a;
    if (k === S) return b;
    const fromLow = a < b ? k : S - k;
    const id = edgeKey(a, b) * 32 + fromLow;
    let v = edgePoints.get(id);
    if (v === undefined) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      v = addVertex([lo, hi], [1 - fromLow / S, fromLow / S]);
      edgePoints.set(id, v);
    }
    return v;
  };
  /** The UV point the same fraction along the face's UV edge (one per side of a seam). */
  const edgeUv = (f: number, e: number, k: number, S: number): number => {
    const a = fu[f * 4 + e] as number;
    const b = fu[f * 4 + ((e + 1) % 4)] as number;
    if (k === 0) return a;
    if (k === S) return b;
    const fromLow = a < b ? k : S - k;
    const id = `${Math.min(a, b)}:${Math.max(a, b)}:${S}:${fromLow}`;
    let t = uvEdgePoints.get(id);
    if (t === undefined) {
      const [ua, va] = uvAt(Math.min(a, b)) as [number, number];
      const [ub, vb] = uvAt(Math.max(a, b)) as [number, number];
      const w = fromLow / S;
      t = addUv(ua + (ub - ua) * w, va + (vb - va) * w);
      uvEdgePoints.set(id, t);
    }
    return t;
  };

  const outFaces: number[] = [];
  const outUvs: number[] = [];
  const outStart: number[] = [0];
  const outSource: number[] = [];

  for (const f of Array.from(faces)) {
    const l = levelOf(f);
    const L = 1 << l;
    const corner = [0, 1, 2, 3].map((i) => fv[f * 4 + i] as number);
    const uvCorner = [0, 1, 2, 3].map((i) => fu[f * 4 + i] as number);
    const segs = [0, 1, 2, 3].map((e) =>
      segments(edgeKey(corner[e] as number, corner[(e + 1) % 4] as number)),
    );
    // The face's interior lattice points, made on first use.
    const inner = new Map<number, [number, number]>();
    const interior = (a: number, b: number): [number, number] => {
      const id = a * (L + 1) + b;
      let p = inner.get(id);
      if (!p) {
        const s = a / L;
        const t = b / L;
        const w = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t];
        const merged = new Map<number, number>();
        corner.forEach((c, i) => {
          merged.set(c, (merged.get(c) ?? 0) + (w[i] as number));
        });
        const uv = [0, 1].map((k) =>
          uvCorner.reduce((sum, ui, i) => sum + (w[i] as number) * (uvAt(ui)[k] as number), 0),
        ) as [number, number];
        p = [addVertex([...merged.keys()], [...merged.values()]), addUv(uv[0], uv[1])];
        inner.set(id, p);
      }
      return p;
    };
    /** Lattice point (a, b) of this face: a corner, a point of an edge, or an interior point. */
    const lattice = (a: number, b: number): [number, number] => {
      if (b === 0) return a === 0 ? [corner[0] as number, uvCorner[0] as number] : onEdge(0, a);
      if (a === L) return b === L ? [corner[2] as number, uvCorner[2] as number] : onEdge(1, b);
      if (b === L) return a === 0 ? [corner[3] as number, uvCorner[3] as number] : onEdge(2, L - a);
      if (a === 0) return onEdge(3, L - b);
      return interior(a, b);
    };
    const onEdge = (e: number, p: number): [number, number] => {
      // p / L along edge e; p = 0 is its start corner, p = L its end corner (made by `lattice`'s corners).
      const S = segs[e] as number;
      const k = (p * S) / L;
      return [edgeVertex(f, e, k, S), edgeUv(f, e, k, S)];
    };
    /** Edge `e`'s points strictly between fractions p / L and (p + 1) / L, in the edge's direction. */
    const between = (e: number, p: number): [number, number][] => {
      const S = segs[e] as number;
      const out: [number, number][] = [];
      for (let k = (p * S) / L + 1; k < ((p + 1) * S) / L; k++)
        out.push([edgeVertex(f, e, k, S), edgeUv(f, e, k, S)]);
      return out;
    };

    for (let b = 0; b < L; b++)
      for (let a = 0; a < L; a++) {
        const poly: [number, number][] = [lattice(a, b)];
        if (b === 0) poly.push(...between(0, a));
        poly.push(lattice(a + 1, b));
        if (a + 1 === L) poly.push(...between(1, b));
        poly.push(lattice(a + 1, b + 1));
        if (b + 1 === L) poly.push(...between(2, L - 1 - a));
        poly.push(lattice(a, b + 1));
        if (a === 0) poly.push(...between(3, L - 1 - b));
        for (const [v, t] of poly) {
          outFaces.push(v);
          outUvs.push(t);
        }
        outStart.push(outFaces.length);
        outSource.push(f);
      }
  }

  // The stencil: the source's vertices as themselves, then the new rows.
  const rows = vertexCount;
  const offsets = new Uint32Array(rows + 1);
  let total = source.vertexCount;
  for (const r of rowSrc) total += r.length;
  const src = new Uint32Array(total);
  const weights = new Float32Array(total);
  let n = 0;
  for (let v = 0; v < source.vertexCount; v++) {
    src[n] = v;
    weights[n++] = 1;
    offsets[v + 1] = n;
  }
  rowSrc.forEach((r, i) => {
    r.forEach((s, j) => {
      src[n] = s;
      weights[n++] = (rowWeight[i] as number[])[j] as number;
    });
    offsets[source.vertexCount + i + 1] = n;
  });
  const uvs = new Float32Array(source.uvs.length + newUv.length);
  uvs.set(source.uvs);
  uvs.set(newUv, source.uvs.length);
  return {
    vertexCount,
    faceStart: Uint32Array.from(outStart),
    faces: Uint32Array.from(outFaces),
    faceUvs: Uint32Array.from(outUvs),
    uvs,
    sourceFace: Uint32Array.from(outSource),
    stencil: { inputCount: source.vertexCount, offsets, src, weights },
  };
}
