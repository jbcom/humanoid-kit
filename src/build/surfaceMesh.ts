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
  return finishSurface(source, stencil, topology, uvs, faceUvs);
}

/**
 * Like `buildSurfaceMesh`, with some faces refined locally first
 * (`refineGraded`): the surface of a body with finer geometry where `refinement`
 * asks for it, evaluated from the same control vertices (the stencil starts at
 * the source's, so `evaluateSurface` takes the same control positions). The
 * refined control mesh has pentagon and hexagon transitions, so level 0 draws
 * each polygon as a fan of triangles and level 1 or more is quads throughout.
 */
export function buildRefinedSurfaceMesh(
  source: QuadSource,
  faces: Uint32Array | null,
  refinement: Refinement,
  levels: number,
): SurfaceMesh {
  const selected = faces ?? Uint32Array.from({ length: source.faceVerts.length / 4 }, (_, i) => i);
  const fine = refineGraded(source, selected, refinement);
  // Compact the refined mesh to the vertices its polygons use.
  const used = new Int32Array(fine.vertexCount).fill(-1);
  const verts: number[] = [];
  const polygons = new Uint32Array(fine.faces.length);
  fine.faces.forEach((v, i) => {
    let c = used[v] as number;
    if (c === -1) {
      c = verts.length;
      used[v] = c;
      verts.push(v);
    }
    polygons[i] = c;
  });
  let stencil = composeStencils(fine.stencil, selectionStencil(fine.vertexCount, verts));
  let topology: QuadTopology;
  let uvs: Float32Array = fine.uvs;
  let faceUvs: Uint32Array;
  if (levels === 0) {
    // The control polygons as they are: each fanned into triangles, drawn as
    // quads with a repeated corner (a triangle's normal and area come out right).
    const quads: number[] = [];
    const quadUvs: number[] = [];
    for (let f = 0; f + 1 < fine.faceStart.length; f++) {
      const s = fine.faceStart[f] as number;
      const n = (fine.faceStart[f + 1] as number) - s;
      if (n === 4) {
        for (let k = 0; k < 4; k++) {
          quads.push(polygons[s + k] as number);
          quadUvs.push(fine.faceUvs[s + k] as number);
        }
        continue;
      }
      for (let i = 1; i + 1 < n; i++)
        for (const k of [0, i, i + 1, i + 1]) {
          quads.push(polygons[s + k] as number);
          quadUvs.push(fine.faceUvs[s + k] as number);
        }
    }
    topology = { vertexCount: verts.length, faces: Uint32Array.from(quads) };
    faceUvs = Uint32Array.from(quadUvs);
  } else {
    const first = catmullClarkPolygons({
      vertexCount: verts.length,
      faceStart: fine.faceStart,
      faces: polygons,
    });
    stencil = composeStencils(stencil, first.stencil);
    topology = first.topology;
    const uvLevel = subdivideUvLinearPolygons(uvs, fine.faceStart, fine.faceUvs);
    uvs = uvLevel.uvs;
    faceUvs = uvLevel.faceUvs;
    for (let l = 1; l < levels; l++) {
      const level = catmullClarkLevel(topology);
      stencil = composeStencils(stencil, level.stencil);
      topology = level.topology;
      const next = subdivideUvLinear(uvs, faceUvs);
      uvs = next.uvs;
      faceUvs = next.faceUvs;
    }
  }
  return finishSurface(source, stencil, topology, uvs, faceUvs);
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
  const sn = scratch?.normals ?? new Float32Array(sCount * 3);
  applyStencil(mesh.stencil, control, surface);
  sn.fill(0);
  const fv = mesh.topology.faces;
  for (let f = 0; f < fv.length; f += 4) {
    const a = (fv[f] as number) * 3;
    const b = (fv[f + 1] as number) * 3;
    const c = (fv[f + 2] as number) * 3;
    const d = (fv[f + 3] as number) * 3;
    // Quad normal from its diagonals (area-weighted, robust for non-planar quads).
    const ux = (surface[c] as number) - (surface[a] as number);
    const uy = (surface[c + 1] as number) - (surface[a + 1] as number);
    const uz = (surface[c + 2] as number) - (surface[a + 2] as number);
    const vx = (surface[d] as number) - (surface[b] as number);
    const vy = (surface[d + 1] as number) - (surface[b + 1] as number);
    const vz = (surface[d + 2] as number) - (surface[b + 2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const p of [a, b, c, d]) {
      sn[p] = (sn[p] as number) + nx;
      sn[p + 1] = (sn[p + 1] as number) + ny;
      sn[p + 2] = (sn[p + 2] as number) + nz;
    }
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
