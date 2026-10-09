/**
 * A renderable surface built from a quad mesh — the base body or any bound
 * attachment: subdivision stencils from its control positions, UV-seam
 * splitting into render vertices, a triangle index buffer, and interpolated
 * skin weights.
 *
 * Built once per (mesh, face subset, level); evaluated on every shape change
 * with `evaluateSurface`.
 */
import {
  applyStencil,
  catmullClarkLevel,
  catmullClarkPolygons,
  composeStencils,
  type QuadTopology,
  type Stencil,
  selectionStencil,
  subdivideUvLinear,
  subdivideUvLinearPolygons,
} from "../subdiv/catmullClark.ts";
import { type Refinement, refineGraded } from "../subdiv/gradedRefine.ts";

export interface SurfaceMesh {
  /** Control (base) vertices → surface positions. */
  stencil: Stencil;
  /** Quad topology over surface positions. */
  topology: QuadTopology;
  /** Render vertex → surface position index (render vertices split at UV seams). */
  renderToSurface: Uint32Array;
  uvs: Float32Array;
  /** Triangles over render vertices. */
  index: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /**
   * Set for a surface refined on top of a coarser one (`buildRefinedSurfaceMesh`):
   * its shading normals come from the coarser surface's, not from its own faces.
   */
  smoothNormals?: SmoothNormals;
}

/**
 * Shading normals for a refined surface: the coarse surface's vertex normals
 * (from its own quads, as the base body shades), interpolated to the refined
 * vertices by the refinement's stencil and, when the refined polygons are
 * subdivided further, carried through that stencil too. Normals from the refined
 * faces themselves would be flat across each coarse quad and band the shading.
 */
export interface SmoothNormals {
  /** Control vertices → the coarse surface's vertices. */
  control: Stencil;
  /** The coarse surface's quads, and its vertex count. */
  faces: Uint32Array;
  vertexCount: number;
  /** The coarse surface's vertices → the refined polygon mesh's. */
  interpolate: Stencil;
  /** The refined polygon mesh's vertices → the final surface's; null when they are the same. */
  smooth: Stencil | null;
}

/** A quad mesh with UVs and skin weights: the base body, or an attachment. */
export interface QuadSource {
  vertexCount: number;
  /** Four vertex indices per quad. */
  faceVerts: Uint32Array;
  /** Four UV indices per quad. */
  faceUvs: Uint32Array;
  uvs: Float32Array;
  /** Up to four bone indices and normalised weights per vertex. */
  skinIndex: Uint8Array;
  skinWeight: Float32Array;
}

/**
 * @param faces indices of the quads to include, or `null` for all of them
 * @param levels Catmull–Clark levels (0 = control mesh)
 */
export function buildSurfaceMesh(
  source: QuadSource,
  faces: Uint32Array | null,
  levels: number,
): SurfaceMesh {
  const selected = faces ?? Uint32Array.from({ length: source.faceVerts.length / 4 }, (_, i) => i);
  const built = buildSubdividedQuads(source, selected, levels);
  return finishSurface(source, built.stencil, built.topology, built.uvs, built.faceUvs);
}

/**
 * The quad mesh of `faces` subdivided `levels` times: its stencil from the
 * source's control vertices, topology and face-varying UVs.
 */
function buildSubdividedQuads(
  source: QuadSource,
  selected: Uint32Array,
  levels: number,
): { stencil: Stencil; topology: QuadTopology; uvs: Float32Array; faceUvs: Uint32Array } {
  // Compact the face subset to its own vertex numbering.
  const used = new Int32Array(source.vertexCount).fill(-1);
  const verts: number[] = [];
  const quad = new Uint32Array(selected.length * 4);
  const quadUv = new Uint32Array(selected.length * 4);
  selected.forEach((f, i) => {
    for (let k = 0; k < 4; k++) {
      const v = source.faceVerts[f * 4 + k] as number;
      let c = used[v] as number;
      if (c === -1) {
        c = verts.length;
        used[v] = c;
        verts.push(v);
      }
      quad[i * 4 + k] = c;
      quadUv[i * 4 + k] = source.faceUvs[f * 4 + k] as number;
    }
  });
  let stencil = selectionStencil(source.vertexCount, verts);
  let topology: QuadTopology = { vertexCount: verts.length, faces: quad };
  let uvs: Float32Array = source.uvs;
  let faceUvs: Uint32Array = quadUv;
  for (let l = 0; l < levels; l++) {
    const level = catmullClarkLevel(topology);
    stencil = composeStencils(stencil, level.stencil);
    topology = level.topology;
    const uvLevel = subdivideUvLinear(uvs, faceUvs);
    uvs = uvLevel.uvs;
    faceUvs = uvLevel.faceUvs;
  }
  return { stencil, topology, uvs, faceUvs };
}

/**
 * Like `buildSurfaceMesh`, with some faces refined locally: the surface of a body
 * with finer geometry where `refinement` asks for it, evaluated from the same
 * control vertices (the stencil starts at the source's, so `evaluateSurface`
 * takes the same control positions).
 *
 * The refinement is of the base's own level-1 surface, not of its control mesh:
 * each source face named in `refinement` is four faces of that surface, and
 * `refineGraded` splits those 2^level by 2^level, so the new vertices lie on the
 * surface the base already draws and refining adds detail without changing the
 * shape. (Refining the 19 mm control mesh instead, then smoothing once, leaves
 * the control polyhedron's facets showing as terraces.) A level-1 surface is the
 * refined mesh itself, its pentagon and hexagon transitions split into
 * triangles and quads; from level 2 the polygons are smoothed into quads by
 * Catmull–Clark, and the surface outside the region is the base's at every level.
 * Vertex numbering of the refined mesh is the same at every level 1 or more,
 * which is what features authored against it need.
 *
 * @param refinement source face indices and how many extra levels each gets
 *   over the level-1 surface (a source face's four children share its level)
 * @param levels Catmull–Clark levels of the whole surface, at least 1
 */
export function buildRefinedSurfaceMesh(
  source: QuadSource,
  faces: Uint32Array | null,
  refinement: Refinement,
  levels: number,
): SurfaceMesh {
  if (!Number.isInteger(levels) || levels < 1)
    throw new RangeError(`a refined surface needs subdivision level 1 or more; got ${levels}`);
  const selected = faces ?? Uint32Array.from({ length: source.faceVerts.length / 4 }, (_, i) => i);
  // The base's level-1 surface, built exactly as `buildSurfaceMesh` builds it.
  const base = buildSubdividedQuads(source, selected, 1);
  const position = new Map<number, number>();
  selected.forEach((f, i) => {
    position.set(f, i);
  });
  // Each source face is four faces of that surface, in order (catmullClarkLevel).
  const children: number[] = [];
  const childLevels: number[] = [];
  for (let i = 0; i < refinement.faces.length; i++) {
    const f = refinement.faces[i] as number;
    const p = position.get(f);
    if (p === undefined) throw new RangeError(`refinement: face ${f} is not in the mesh`);
    for (let k = 0; k < 4; k++) {
      children.push(p * 4 + k);
      childLevels.push(refinement.levels[i] as number);
    }
  }
  const fine = refineGraded(
    {
      vertexCount: base.topology.vertexCount,
      faceVerts: base.topology.faces,
      faceUvs: base.faceUvs,
      uvs: base.uvs,
    },
    Uint32Array.from({ length: base.topology.faces.length / 4 }, (_, i) => i),
    { faces: children, levels: childLevels },
  );
  let stencil = composeStencils(base.stencil, fine.stencil);
  let topology: QuadTopology;
  let uvs: Float32Array = fine.uvs;
  let faceUvs: Uint32Array;
  let smooth: Stencil | null = null;
  if (levels === 1) {
    ({ topology, faceUvs } = polygonsToQuads(fine));
  } else {
    const smoothed = catmullClarkPolygons({
      vertexCount: fine.vertexCount,
      faceStart: fine.faceStart,
      faces: fine.faces,
    });
    stencil = composeStencils(stencil, smoothed.stencil);
    smooth = smoothed.stencil;
    topology = smoothed.topology;
    const uvLevel = subdivideUvLinearPolygons(uvs, fine.faceStart, fine.faceUvs);
    uvs = uvLevel.uvs;
    faceUvs = uvLevel.faceUvs;
    for (let l = 2; l < levels; l++) {
      const level = catmullClarkLevel(topology);
      stencil = composeStencils(stencil, level.stencil);
      smooth = composeStencils(smooth, level.stencil);
      topology = level.topology;
      const next = subdivideUvLinear(uvs, faceUvs);
      uvs = next.uvs;
      faceUvs = next.faceUvs;
    }
  }
  return {
    ...finishSurface(source, stencil, topology, uvs, faceUvs),
    smoothNormals: {
      control: base.stencil,
      faces: base.topology.faces,
      vertexCount: base.topology.vertexCount,
      interpolate: fine.stencil,
      smooth,
    },
  };
}

/**
 * A polygon mesh as the quad topology a surface draws: quads as they are,
 * larger polygons fanned into triangles, each drawn as a quad with a repeated
 * corner (its normal and area come out right).
 */
function polygonsToQuads(fine: {
  faceStart: Uint32Array;
  faces: Uint32Array;
  faceUvs: Uint32Array;
  vertexCount: number;
}): { topology: QuadTopology; faceUvs: Uint32Array } {
  const quads: number[] = [];
  const quadUvs: number[] = [];
  for (let f = 0; f + 1 < fine.faceStart.length; f++) {
    const s = fine.faceStart[f] as number;
    const n = (fine.faceStart[f + 1] as number) - s;
    const corners =
      n === 4 ? [[0, 1, 2, 3]] : Array.from({ length: n - 2 }, (_, i) => [0, i + 1, i + 2, i + 2]);
    for (const corner of corners)
      for (const k of corner) {
        quads.push(fine.faces[s + k] as number);
        quadUvs.push(fine.faceUvs[s + k] as number);
      }
  }
  return {
    topology: { vertexCount: fine.vertexCount, faces: Uint32Array.from(quads) },
    faceUvs: Uint32Array.from(quadUvs),
  };
}

/** Render vertices, triangles and skin weights for a subdivided surface. */
function finishSurface(
  source: Pick<QuadSource, "skinIndex" | "skinWeight">,
  stencil: Stencil,
  topology: QuadTopology,
  uvs: Float32Array,
  faceUvs: Uint32Array,
): SurfaceMesh {
  // Render vertices: unique (surface vertex, uv) pairs, in order of first use,
  // found through a chain of the render vertices made for each surface vertex.
  const corners = topology.faces.length;
  const firstRender = new Int32Array(topology.vertexCount).fill(-1);
  const nextRender = new Int32Array(corners);
  const renderUv = new Uint32Array(corners);
  const r2s = new Uint32Array(corners);
  const ruv = new Float32Array(corners * 2);
  let renderCount = 0;
  const cornerRender = new Uint32Array(corners);
  for (let c = 0; c < corners; c++) {
    const s = topology.faces[c] as number;
    const t = faceUvs[c] as number;
    let r = firstRender[s] as number;
    while (r !== -1 && renderUv[r] !== t) r = nextRender[r] as number;
    if (r === -1) {
      r = renderCount++;
      nextRender[r] = firstRender[s] as number;
      firstRender[s] = r;
      renderUv[r] = t;
      r2s[r] = s;
      ruv[r * 2] = uvs[t * 2] as number;
      ruv[r * 2 + 1] = uvs[t * 2 + 1] as number;
    }
    cornerRender[c] = r;
  }
  const F = topology.faces.length / 4;
  const index = new Uint32Array(F * 6);
  for (let f = 0; f < F; f++) {
    const a = cornerRender[f * 4] as number;
    const b = cornerRender[f * 4 + 1] as number;
    const c = cornerRender[f * 4 + 2] as number;
    const d = cornerRender[f * 4 + 3] as number;
    index[f * 6] = a;
    index[f * 6 + 1] = b;
    index[f * 6 + 2] = c;
    index[f * 6 + 3] = a;
    index[f * 6 + 4] = c;
    index[f * 6 + 5] = d;
  }

  const skin = interpolateSkin(source, stencil);
  const renderToSurface = r2s.slice(0, renderCount);
  const skinIndex = new Uint16Array(renderToSurface.length * 4);
  const skinWeight = new Float32Array(renderToSurface.length * 4);
  renderToSurface.forEach((s, r) => {
    skinIndex.set(skin.index.subarray(s * 4, s * 4 + 4), r * 4);
    skinWeight.set(skin.weight.subarray(s * 4, s * 4 + 4), r * 4);
  });
  return {
    stencil,
    topology,
    renderToSurface,
    uvs: ruv.slice(0, renderCount * 2),
    index,
    skinIndex,
    skinWeight,
  };
}

/** Skin weights for surface vertices: stencil-weighted blend of control weights, top four kept. */
function interpolateSkin(assets: Pick<QuadSource, "skinIndex" | "skinWeight">, s: Stencil) {
  const n = s.offsets.length - 1;
  const index = new Uint16Array(n * 4);
  const weight = new Float32Array(n * 4);
  // Per bone, its weight in the current row; bones in order of first touch,
  // so equal weights keep that order through the (stable) sort.
  const acc = new Float64Array(256);
  const stamp = new Uint32Array(256);
  const bones: number[] = [];
  for (let i = 0; i < n; i++) {
    bones.length = 0;
    for (let k = s.offsets[i] as number; k < (s.offsets[i + 1] as number); k++) {
      const v = s.src[k] as number;
      const w = s.weights[k] as number;
      for (let j = 0; j < 4; j++) {
        const bw = assets.skinWeight[v * 4 + j] as number;
        if (bw > 0) {
          const b = assets.skinIndex[v * 4 + j] as number;
          if (stamp[b] !== i + 1) {
            stamp[b] = i + 1;
            acc[b] = bw * w;
            bones.push(b);
          } else acc[b] = (acc[b] as number) + bw * w;
        }
      }
    }
    const top = bones
      .filter((b) => (acc[b] as number) > 0)
      .sort((a, b) => (acc[b] as number) - (acc[a] as number))
      .slice(0, 4);
    let sum = 0;
    for (const b of top) sum += acc[b] as number;
    top.forEach((b, j) => {
      index[i * 4 + j] = b;
      weight[i * 4 + j] = sum > 0 ? (acc[b] as number) / sum : 0;
    });
  }
  return { index, weight };
}

/** Adds each quad's area-weighted normal (from its diagonals, robust for non-planar quads) to its corners'. */
function addQuadNormals(faces: Uint32Array, positions: Float32Array, out: Float32Array): void {
  for (let f = 0; f < faces.length; f += 4) {
    const a = (faces[f] as number) * 3;
    const b = (faces[f + 1] as number) * 3;
    const c = (faces[f + 2] as number) * 3;
    const d = (faces[f + 3] as number) * 3;
    const ux = (positions[c] as number) - (positions[a] as number);
    const uy = (positions[c + 1] as number) - (positions[a + 1] as number);
    const uz = (positions[c + 2] as number) - (positions[a + 2] as number);
    const vx = (positions[d] as number) - (positions[b] as number);
    const vy = (positions[d + 1] as number) - (positions[b + 1] as number);
    const vz = (positions[d + 2] as number) - (positions[b + 2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const p of [a, b, c, d]) {
      out[p] = (out[p] as number) + nx;
      out[p + 1] = (out[p + 1] as number) + ny;
      out[p + 2] = (out[p + 2] as number) + nz;
    }
  }
}

/** The shading normals of a refined surface (`SmoothNormals`), one per surface vertex, not yet normalised. */
function smoothNormals(plan: SmoothNormals, control: Float32Array, count: number): Float32Array {
  const base = applyStencil(plan.control, control, new Float32Array(plan.vertexCount * 3));
  const n = new Float32Array(plan.vertexCount * 3);
  addQuadNormals(plan.faces, base, n);
  for (let v = 0; v < plan.vertexCount; v++) {
    const l = Math.hypot(n[v * 3] as number, n[v * 3 + 1] as number, n[v * 3 + 2] as number) || 1;
    n[v * 3] = (n[v * 3] as number) / l;
    n[v * 3 + 1] = (n[v * 3 + 1] as number) / l;
    n[v * 3 + 2] = (n[v * 3 + 2] as number) / l;
  }
  const refined = applyStencil(
    plan.interpolate,
    n,
    new Float32Array(plan.interpolate.offsets.length * 3 - 3),
  );
  return plan.smooth ? applyStencil(plan.smooth, refined, new Float32Array(count * 3)) : refined;
}

/** Morphed control positions → render positions and smooth normals (normals shared across UV seams). */
export function evaluateSurface(
  mesh: SurfaceMesh,
  control: Float32Array,
  outPositions: Float32Array,
  outNormals: Float32Array,
  scratch?: { surface: Float32Array; normals: Float32Array },
): void {
  const sCount = mesh.topology.vertexCount;
  const surface = scratch?.surface ?? new Float32Array(sCount * 3);
  let sn = scratch?.normals ?? new Float32Array(sCount * 3);
  applyStencil(mesh.stencil, control, surface);
  if (mesh.smoothNormals) {
    sn = smoothNormals(mesh.smoothNormals, control, sCount);
  } else {
    sn.fill(0);
    addQuadNormals(mesh.topology.faces, surface, sn);
  }
  const r2s = mesh.renderToSurface;
  for (let r = 0; r < r2s.length; r++) {
    const s = (r2s[r] as number) * 3;
    outPositions[r * 3] = surface[s] as number;
    outPositions[r * 3 + 1] = surface[s + 1] as number;
    outPositions[r * 3 + 2] = surface[s + 2] as number;
    const x = sn[s] as number;
    const y = sn[s + 1] as number;
    const z = sn[s + 2] as number;
    const l = Math.hypot(x, y, z) || 1;
    outNormals[r * 3] = x / l;
    outNormals[r * 3 + 1] = y / l;
    outNormals[r * 3 + 2] = z / l;
  }
}
