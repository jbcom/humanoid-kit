/**
 * Patches of a refined surface: some of the refinement's polygons replaced by a
 * mesh of the pack's own, laid out where they were (docs/ARCHITECTURE.md, "The
 * adult surface", "Patches").
 *
 * A reservoir's loop is the boundary of whole refinement polygons, so where it
 * crosses the refinement's rows it is a staircase, and the strip of skin from it to
 * the first ring a sculpt is drawn from is a row of thin teeth that showed as a
 * fringe round a shaft's root and a sac's corners. A patch puts a smooth ring of
 * vertices where the loop should go, concentric rings inside it and a strip that
 * joins it to the polygons round it, so the loop is an edge loop of the mesh.
 *
 * The base mesh's contract holds: a patch's vertices are affine combinations of the
 * refinement's own, so they follow every shape of the base through the same stencil,
 * and their skin weights, UVs and every field carried through it come with them.
 * A patch must replace a region exactly: its polygons' boundary is the removed
 * polygons' boundary, edge for edge, so the mesh stays conforming.
 */
import type { Stencil } from "../subdiv/catmullClark.ts";
import type { GradedMesh } from "../subdiv/gradedRefine.ts";

/** A weighted sum of existing entries (vertices, or UV entries): the weights sum to 1. */
export interface Combination {
  from: readonly number[];
  weights: readonly number[];
}

/**
 * A patch (`AdultSurfaceSpec.patches`). Ids at or past the count before the patch
 * name its own new vertices and UV entries, in order; ids below it existing ones.
 */
export interface SurfacePatch {
  /** Refinement polygons it replaces, by index in the refinement. */
  remove: readonly number[];
  /** Its new vertices. */
  vertices: readonly Combination[];
  /** Its new UV entries. */
  uvs: readonly Combination[];
  /**
   * Its polygons: each corner's vertex and UV entry, and `of`, a removed polygon whose
   * base face owns it (for the clothing masks and the refined region).
   */
  polygons: readonly { vertices: readonly number[]; uvs: readonly number[]; of: number }[];
}

/** Weights in a combination sum to 1 within this. */
const AFFINE = 1e-5;

/**
 * The refinement with its patches applied, one after another: each names polygons,
 * vertices and UV entries of the refinement as the patches before it left it. With
 * no patches it is the refinement itself.
 */
export function applyPatches(fine: GradedMesh, patches: readonly SurfacePatch[]): GradedMesh {
  return patches.reduce((mesh, patch, p) => applyPatch(mesh, patch, `surface patch ${p}`), fine);
}

/**
 * One patch applied: its polygons removed, its vertices (stencil rows) and UV entries
 * appended, its polygons added, and every polygon ordered by the base face that owns
 * it (a face's polygons stay together, as the clothing masks need).
 */
function applyPatch(fine: GradedMesh, patch: SurfacePatch, what: string): GradedMesh {
  const polygonCount = fine.faceStart.length - 1;
  const removed = new Set<number>();
  const rows: { src: number[]; weights: number[] }[] = [];
  for (let v = 0; v < fine.vertexCount; v++) {
    const s = fine.stencil.offsets[v] as number;
    const e = fine.stencil.offsets[v + 1] as number;
    rows.push({
      src: Array.from(fine.stencil.src.subarray(s, e)),
      weights: Array.from(fine.stencil.weights.subarray(s, e)),
    });
  }
  const uvs = Array.from(fine.uvs);
  /** Polygons as corner lists, with the base face that owns each. */
  const polygons: { vertices: number[]; uvs: number[]; source: number }[] = [];
  for (let f = 0; f < polygonCount; f++) {
    const s = fine.faceStart[f] as number;
    const e = fine.faceStart[f + 1] as number;
    polygons.push({
      vertices: Array.from(fine.faces.subarray(s, e)),
      uvs: Array.from(fine.faceUvs.subarray(s, e)),
      source: fine.sourceFace[f] as number,
    });
  }
  const added: typeof polygons = [];
  for (const f of patch.remove) {
    if (!Number.isInteger(f) || f < 0 || f >= polygonCount)
      throw new RangeError(`${what}: polygon ${f} is not in the refinement`);
    if (removed.has(f)) throw new RangeError(`${what}: polygon ${f} is removed twice`);
    removed.add(f);
  }
  const check = (c: Combination, below: number, kind: string, i: number) => {
    if (c.from.length !== c.weights.length || !c.from.length)
      throw new RangeError(`${what}: ${kind} ${i} has no combination`);
    if (c.from.some((x) => !Number.isInteger(x) || x < 0 || x >= below))
      throw new RangeError(`${what}: ${kind} ${i} combines an entry that does not exist yet`);
    const sum = c.weights.reduce((s, w) => s + w, 0);
    if (Math.abs(sum - 1) > AFFINE)
      throw new RangeError(`${what}: ${kind} ${i}'s weights sum to ${sum}, not 1`);
  };
  patch.vertices.forEach((c, i) => {
    check(c, rows.length, "vertex", i);
    // The new row is the weighted sum of the rows it combines.
    const acc = new Map<number, number>();
    c.from.forEach((v, k) => {
      const row = rows[v] as { src: number[]; weights: number[] };
      row.src.forEach((s, j) => {
        acc.set(s, (acc.get(s) ?? 0) + (c.weights[k] as number) * (row.weights[j] as number));
      });
    });
    const src = [...acc.keys()].sort((a, b) => a - b);
    rows.push({ src, weights: src.map((s) => acc.get(s) as number) });
  });
  patch.uvs.forEach((c, i) => {
    check(c, uvs.length / 2, "UV entry", i);
    let u = 0;
    let v = 0;
    c.from.forEach((x, k) => {
      u += (c.weights[k] as number) * (uvs[x * 2] as number);
      v += (c.weights[k] as number) * (uvs[x * 2 + 1] as number);
    });
    uvs.push(u, v);
  });
  const remove = new Set(patch.remove);
  for (const [i, poly] of patch.polygons.entries()) {
    if (poly.vertices.length < 3 || poly.vertices.length !== poly.uvs.length)
      throw new RangeError(`${what}: polygon ${i} needs three corners or more, a UV each`);
    if (poly.vertices.some((v) => !Number.isInteger(v) || v < 0 || v >= rows.length))
      throw new RangeError(`${what}: polygon ${i} names a vertex that does not exist`);
    if (poly.uvs.some((v) => !Number.isInteger(v) || v < 0 || v >= uvs.length / 2))
      throw new RangeError(`${what}: polygon ${i} names a UV entry that does not exist`);
    if (!remove.has(poly.of))
      throw new RangeError(`${what}: polygon ${i} is owned by a polygon it does not replace`);
    added.push({
      vertices: [...poly.vertices],
      uvs: [...poly.uvs],
      source: fine.sourceFace[poly.of] as number,
    });
  }
  const boundary = (list: readonly (readonly number[])[]) => {
    const directed = new Set<string>();
    for (const c of list)
      c.forEach((a, k) => {
        directed.add(`${a}:${c[(k + 1) % c.length]}`);
      });
    return [...directed].filter((e) => {
      const [a, b] = e.split(":");
      return !directed.has(`${b}:${a}`);
    });
  };
  const was = boundary(patch.remove.map((f) => (polygons[f] as { vertices: number[] }).vertices));
  const now = new Set(boundary(patch.polygons.map((q) => q.vertices)));
  if (was.length !== now.size || was.some((e) => !now.has(e)))
    throw new RangeError(`${what}: its polygons do not fill the region it removes, edge for edge`);
  // Every polygon, kept and added, ordered by the base face that owns it, stably.
  const all = [...polygons.filter((_, f) => !removed.has(f)), ...added];
  const order = all
    .map((_, i) => i)
    .sort((a, b) => {
      const fa = Math.floor((all[a] as { source: number }).source / 4);
      const fb = Math.floor((all[b] as { source: number }).source / 4);
      return fa - fb || a - b;
    });
  const faceStart = [0];
  const faces: number[] = [];
  const faceUvs: number[] = [];
  const sourceFace: number[] = [];
  for (const i of order) {
    const q = all[i] as (typeof all)[number];
    faces.push(...q.vertices);
    faceUvs.push(...q.uvs);
    faceStart.push(faces.length);
    sourceFace.push(q.source);
  }
  const offsets = new Uint32Array(rows.length + 1);
  rows.forEach((r, v) => {
    offsets[v + 1] = (offsets[v] as number) + r.src.length;
  });
  const stencil: Stencil = {
    inputCount: fine.stencil.inputCount,
    offsets,
    src: Uint32Array.from(rows.flatMap((r) => r.src)),
    weights: Float32Array.from(rows.flatMap((r) => r.weights)),
  };
  return {
    vertexCount: rows.length,
    faceStart: Uint32Array.from(faceStart),
    faces: Uint32Array.from(faces),
    faceUvs: Uint32Array.from(faceUvs),
    uvs: Float32Array.from(uvs),
    sourceFace: Uint32Array.from(sourceFace),
    stencil,
  };
}
