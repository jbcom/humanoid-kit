/**
 * The graft's public types (docs/GRAFT.md): a foreign part, the cut that
 * makes room for it, the options of its fit, and what a built and an
 * evaluated graft hold.
 */

export type Vec3 = [number, number, number];

/** A graft that cannot be built or evaluated as asked: a cut or a seam that is not one simple loop, an unknown site or bone. */
export class GraftError extends Error {
  override name = "GraftError";
}

/** A plane: a point on it and its normal (towards the side a cut removes or a seam trims). */
export interface GraftPlane {
  point: Vec3;
  normal: Vec3;
}

/**
 * Where the part's seam is: detected (the longest open boundary loop, the
 * default), supplied as the part's vertex indices in order, or a plane that
 * trims the part first.
 */
export type PartSeam = { loop: readonly number[] } | { plane: GraftPlane };

/** One material group of a part: triangles `[start, start + count)` of its own index. */
export interface PartGroup {
  name: string;
  start: number;
  count: number;
}

/** A foreign part: a triangle mesh in its own units and frame. */
export interface GraftPart {
  /** xyz per vertex, in any unit (the fit finds the scale). */
  positions: ArrayLike<number>;
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  triangles: ArrayLike<number>;
  /** Unit normals per vertex; recomputed from the triangles when absent. */
  normals?: ArrayLike<number>;
  /** uv per vertex, carried to the merged surface's part vertices. */
  uvs?: ArrayLike<number>;
  /** Material groups over `triangles`; one group, `"part"`, when absent. */
  groups?: readonly PartGroup[];
  /** The part's front, in its own frame (default +z): where its rim's samples start, to meet the body's front. */
  forward?: Vec3;
  /** The part's seam; detected when absent. */
  seam?: PartSeam;
}

/**
 * Where to cut the body: a named site (`CUT_SITES`), a plane with a seed
 * point on the side it removes, or the control faces to remove. A supplied
 * cut names the bone the part is bound to.
 */
export type GraftCut =
  | string
  | { plane: GraftPlane; seed: Vec3; rootBone: string; forward?: Vec3 }
  | { faces: readonly number[]; rootBone: string; forward?: Vec3 };

/** The fit's options (docs/GRAFT.md, "The fit, on every evaluation"). */
export interface GraftOptions {
  /** Samples per loop for the fit and the band's rings (default 64). */
  samples?: number;
  /** The band's rings, from the body's loop to the part's rim (default 4, at least 2). */
  rings?: number;
  /** How far beyond the body's loop the rim sits, in units of the loop's RMS radius (default 0.3). */
  gap?: number;
  /** The rim's falloff band, in units of the rim's RMS radius at rest (default 0.5). */
  band?: number;
  /** An extra scale of the part about its rim's centre, before the fit: uniform, or per part axis. */
  scale?: number | Vec3;
  /** The fairing gate: no sample of a faired loop turns by more than this, in degrees (default 40). */
  maxTurn?: number;
}

export interface GraftSpec extends GraftOptions {
  at: GraftCut;
  part: GraftPart;
}

/** A merged surface's triangle group: triangles `[start, start + count)` of `GraftTopology.index`. */
export interface GraftGroup {
  name: string;
  start: number;
  count: number;
}

/**
 * The merged surface's static data: built once per model, cut and part. Its
 * vertices are the body's render vertices (their own ids), then the band's
 * interior rings, then the part's vertices.
 */
export interface GraftTopology {
  /** Triangles over the merged vertices: the body's kept triangles, the band's, the part's. */
  index: Uint32Array;
  /** `"body"`, `"bridge"`, then the part's groups. */
  groups: GraftGroup[];
  vertexCount: number;
  /** The body's render vertices; the band starts here. */
  bodyVertexCount: number;
  /** The first of the part's vertices. */
  partStart: number;
  /** Per merged vertex, the vertex it is welded to (the body's UV-seam copies and the part's coincident vertices share one). */
  weld: Uint32Array;
  /** Per merged vertex, uv: the body's own, the part's own (zero without), zero on the band. */
  uvs: Float32Array;
  /** Four bones and weights per merged vertex (docs/GRAFT.md, "Rig binding"). */
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** The body's loop, as merged (render) vertices, in order. */
  loop: Uint32Array;
  /** The part's rim, as merged vertices, in order. */
  rim: Uint32Array;
  /** The control faces the cut removes. */
  removedFaces: Uint32Array;
  /** The attachments inside the cut, by id. */
  droppedAttachments: string[];
  /** The bones whose heads are inside the cut (never the root bone). */
  removedBones: string[];
  /** The bone the part is bound to. */
  rootBone: string;
}

/** The fitted similarity: the part's point p lands at `scale * rotation(p) + translation` (before the rim's blend). */
export interface GraftFit {
  scale: number;
  /** A unit quaternion, xyzw. */
  rotation: [number, number, number, number];
  translation: Vec3;
  /** The body loop's RMS radius, metres. */
  loopRadius: number;
  /** The largest turn left on the faired loops, degrees. */
  turn: number;
}

/** A graft on one evaluation of the body: every merged vertex's position and normal. */
export interface GraftSurface {
  positions: Float32Array;
  normals: Float32Array;
  fit: GraftFit;
}
