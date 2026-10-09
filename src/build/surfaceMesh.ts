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
  composeStencils,
  type QuadTopology,
  type Stencil,
  selectionStencil,
  subdivideUvLinear,
} from "../subdiv/catmullClark.ts";

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
  const used = new Map<number, number>();
  const verts: number[] = [];
  const quad = new Uint32Array(selected.length * 4);
  const quadUv = new Uint32Array(selected.length * 4);
  selected.forEach((f, i) => {
    for (let k = 0; k < 4; k++) {
      const v = source.faceVerts[f * 4 + k] as number;
      let c = used.get(v);
      if (c === undefined) {
        c = verts.length;
        used.set(v, c);
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

  // Render vertices: unique (surface vertex, uv) pairs.
  const key = new Map<string, number>();
  const r2s: number[] = [];
  const ruv: number[] = [];
  const cornerRender = new Uint32Array(topology.faces.length);
  for (let c = 0; c < topology.faces.length; c++) {
    const s = topology.faces[c] as number;
    const t = faceUvs[c] as number;
    const k = `${s}:${t}`;
    let r = key.get(k);
    if (r === undefined) {
      r = r2s.length;
      key.set(k, r);
      r2s.push(s);
      ruv.push(uvs[t * 2] as number, uvs[t * 2 + 1] as number);
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
    index.set([a, b, c, a, c, d], f * 6);
  }

  const skin = interpolateSkin(source, stencil);
  const renderToSurface = Uint32Array.from(r2s);
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
    uvs: Float32Array.from(ruv),
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
  const acc = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    acc.clear();
    for (let k = s.offsets[i] as number; k < (s.offsets[i + 1] as number); k++) {
      const v = s.src[k] as number;
      const w = s.weights[k] as number;
      for (let j = 0; j < 4; j++) {
        const bw = assets.skinWeight[v * 4 + j] as number;
        if (bw > 0) {
          const b = assets.skinIndex[v * 4 + j] as number;
          acc.set(b, (acc.get(b) ?? 0) + bw * w);
        }
      }
    }
    const top = [...acc]
      .filter((e) => e[1] > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const sum = top.reduce((t, e) => t + e[1], 0);
    top.forEach(([b, w], j) => {
      index[i * 4 + j] = b;
      weight[i * 4 + j] = sum > 0 ? w / sum : 0;
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
