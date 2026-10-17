/**
 * MakeHuman proxy bodies (docs/MINIATURES.md): other topologies for the whole
 * body, bound to the base mesh exactly as garments are, so a proxy follows
 * every morph the figure has. The kit fits them as MakeHuman does: each vertex
 * is a weighted sum of three morphed base vertices plus a scaled offset
 * (`evaluateBinding`), its skin blends those base vertices' skin weights
 * (`bindingSkin`), and under clothes it shows where at least two of its base
 * vertices still show (`transferVisibility`).
 */
import { type BoundProxy, type HumanoidAssets, SKIN_INFLUENCES } from "../format/assetFormat.ts";
import { bindingSkin, evaluateBinding } from "../mhclo/bound.ts";
import { faceVisibility, transferVisibility } from "./outfit.ts";

/** The proxies MakeHuman's system assets ship that the body pack carries, by MakeHuman's names. */
export const PROXY_IDS = ["proxy741", "male1591", "female1605"] as const;

export class ProxyError extends Error {
  override name = "ProxyError";
}

/** A proxy's static data: its triangles, its faces and its skin on the rig. */
export interface ProxyTopology {
  id: string;
  vertexCount: number;
  /** Quad corners per face (a triangle repeats its last corner), as the asset has them. */
  faceVerts: Uint32Array;
  /** Two triangles per quad face, one per triangle face, three indices each, wound as the body's. */
  index: Uint32Array;
  /** The face each triangle of `index` comes from. */
  triangleFace: Uint32Array;
  /** `SKIN_INFLUENCES` bone indices and weights per vertex, from the base vertices it is bound to. */
  skinIndex: Uint8Array;
  skinWeight: Float32Array;
}

/** The bound proxy `id`, or `ProxyError` when the pack has no such proxy or the proxies have not been added. */
export function boundProxy(assets: HumanoidAssets, id: string): BoundProxy {
  const p = assets.proxies.get(id);
  if (p) return p;
  if (!assets.manifest.proxies?.entries.some((e) => e.id === id))
    throw new ProxyError(`the body pack has no proxy ${id}`);
  throw new ProxyError(`proxy ${id} has not loaded: add the proxy file first (loadProxies)`);
}

const topologies = new WeakMap<BoundProxy, ProxyTopology>();

/** The static data of proxy `id`, built once per loaded proxy. */
export function proxyTopology(assets: HumanoidAssets, id: string): ProxyTopology {
  const proxy = boundProxy(assets, id);
  let t = topologies.get(proxy);
  if (!t) {
    const { faceVerts } = proxy;
    const tris: number[] = [];
    const faces: number[] = [];
    for (let f = 0; f < faceVerts.length / 4; f++) {
      const a = faceVerts[f * 4] as number;
      const b = faceVerts[f * 4 + 1] as number;
      const c = faceVerts[f * 4 + 2] as number;
      const d = faceVerts[f * 4 + 3] as number;
      tris.push(a, b, c);
      faces.push(f);
      if (d !== c && d !== a) {
        tris.push(a, c, d);
        faces.push(f);
      }
    }
    const skin = bindingSkin(proxy, assets.skinIndex, assets.skinWeight);
    t = {
      id,
      vertexCount: proxy.entry.vertexCount,
      faceVerts,
      index: Uint32Array.from(tris),
      triangleFace: Uint32Array.from(faces),
      skinIndex: skin.index,
      skinWeight: skin.weight,
    };
    topologies.set(proxy, t);
  }
  return t;
}

/** The proxy's vertex positions on a figure whose morphed base control positions are `control`. */
export function fitProxy(
  assets: HumanoidAssets,
  id: string,
  control: Float32Array,
  out: Float32Array = new Float32Array(boundProxy(assets, id).entry.vertexCount * 3),
): Float32Array {
  return evaluateBinding(boundProxy(assets, id), control, out);
}

/**
 * The proxy's triangles that show over `bodyVisible` (per base vertex, 1 where
 * the body shows: `Outfit.bodyVisible`): a vertex shows where at least two of
 * its three base vertices do, and a face unless all its corners are hidden.
 */
export function proxyIndex(
  assets: HumanoidAssets,
  id: string,
  bodyVisible: Uint8Array | null,
): Uint32Array {
  const t = proxyTopology(assets, id);
  if (!bodyVisible) return t.index;
  const visible = transferVisibility(bodyVisible, boundProxy(assets, id));
  const faceShows = faceVisibility(t.faceVerts, null, visible);
  const out: number[] = [];
  for (let k = 0; k < t.triangleFace.length; k++) {
    if (faceShows[t.triangleFace[k] as number])
      out.push(
        t.index[k * 3] as number,
        t.index[k * 3 + 1] as number,
        t.index[k * 3 + 2] as number,
      );
  }
  return Uint32Array.from(out);
}

/** A source proxy represented in render order, split only by authored UV entry identity. */
export interface ProxyRenderTopology {
  id: string;
  vertexCount: number;
  /** Triangles in the original `proxyTopology().index` order and winding. */
  index: Uint32Array;
  /** Authored UV coordinates, two floats per render vertex, without flipping. */
  uvs: Float32Array;
  /** The original proxy vertex of each render vertex. */
  renderToProxy: Uint32Array;
  /** The authored UV entry of each render vertex (identity, not coordinate equality). */
  renderToUv: Uint32Array;
  /** Original authored face per triangle. */
  triangleFace: Uint32Array;
  /** Triangle ordinal in the unchanged original `proxyTopology().index`. */
  sourceTriangle: Uint32Array;
  /** Exact copies of all `SKIN_INFLUENCES` source skin entries per render vertex. */
  skinIndex: Uint8Array;
  skinWeight: Float32Array;
}

const renderTopologies = new WeakMap<BoundProxy, ProxyRenderTopology>();

/** Validate the source arrays this render representation reads, before caching it. */
function validateRenderSource(proxy: BoundProxy, assets: HumanoidAssets): void {
  const { vertexCount, faceCount } = proxy.entry;
  const fail = (field: string): never => {
    throw new ProxyError(`proxy ${proxy.entry.id}: invalid ${field}`);
  };
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 0) fail("vertexCount");
  if (!Number.isSafeInteger(faceCount) || faceCount < 0) fail("faceCount");
  if (proxy.faceVerts.length !== faceCount * 4) fail("faceVerts length");
  if (proxy.faceUvs.length !== faceCount * 4) fail("faceUvs length");
  if (proxy.uvs.length % 2 !== 0) fail("uvs length");
  for (const v of proxy.faceVerts) if (v >= vertexCount) fail("faceVerts range");
  for (const uv of proxy.faceUvs) if (uv >= proxy.uvs.length / 2) fail("faceUvs range");
  for (const value of proxy.uvs) if (!Number.isFinite(value)) fail("uvs coordinate");
  if (
    assets.skinIndex.length % SKIN_INFLUENCES !== 0 ||
    assets.skinWeight.length !== assets.skinIndex.length
  )
    fail("base skin rows");
  if (proxy.refVerts.length !== vertexCount * 3 || proxy.weights.length !== vertexCount * 3)
    fail("binding length");
  for (const v of proxy.refVerts)
    if (v >= assets.skinIndex.length / SKIN_INFLUENCES) fail("binding reference range");
}

/**
 * Authored proxy topology in render order, cached once per loaded proxy.
 * Callers must treat the shared arrays as read-only, like `proxyTopology`.
 */
export function proxyRenderTopology(assets: HumanoidAssets, id: string): ProxyRenderTopology {
  const proxy = boundProxy(assets, id);
  const cached = renderTopologies.get(proxy);
  if (cached) return cached;
  validateRenderSource(proxy, assets);
  const source = proxyTopology(assets, id);
  const vertices: number[] = [];
  const uvEntries: number[] = [];
  const index = new Uint32Array(source.index.length);
  const pairs = new Map<number, Map<number, number>>();
  for (let t = 0; t < source.triangleFace.length; t++) {
    const face = source.triangleFace[t] as number;
    const second = t > 0 && source.triangleFace[t - 1] === face;
    const corners = second ? [0, 2, 3] : [0, 1, 2];
    for (let c = 0; c < 3; c++) {
      const vertex = source.index[t * 3 + c] as number;
      const uv = proxy.faceUvs[face * 4 + (corners[c] as number)] as number;
      let byUv = pairs.get(vertex);
      if (!byUv) {
        byUv = new Map();
        pairs.set(vertex, byUv);
      }
      let render = byUv.get(uv);
      if (render === undefined) {
        render = vertices.length;
        byUv.set(uv, render);
        vertices.push(vertex);
        uvEntries.push(uv);
      }
      index[t * 3 + c] = render;
    }
  }
  const vertexCount = vertices.length;
  const uvs = new Float32Array(vertexCount * 2);
  const skinIndex = new Uint8Array(vertexCount * SKIN_INFLUENCES);
  const skinWeight = new Float32Array(vertexCount * SKIN_INFLUENCES);
  for (let v = 0; v < vertexCount; v++) {
    const uv = (uvEntries[v] as number) * 2;
    uvs.set(proxy.uvs.subarray(uv, uv + 2), v * 2);
    const skin = (vertices[v] as number) * SKIN_INFLUENCES;
    skinIndex.set(source.skinIndex.subarray(skin, skin + SKIN_INFLUENCES), v * SKIN_INFLUENCES);
    skinWeight.set(source.skinWeight.subarray(skin, skin + SKIN_INFLUENCES), v * SKIN_INFLUENCES);
  }
  const topology: ProxyRenderTopology = {
    id,
    vertexCount,
    index,
    uvs,
    renderToProxy: Uint32Array.from(vertices),
    renderToUv: Uint32Array.from(uvEntries),
    triangleFace: source.triangleFace,
    sourceTriangle: Uint32Array.from(source.triangleFace, (_, t) => t),
    skinIndex,
    skinWeight,
  };
  renderTopologies.set(proxy, topology);
  return topology;
}

/**
 * Expand a source-order `fitProxy` result into render order. Lengths must match
 * exactly; overlapping views are refused before writing (disjoint views work).
 */
export function expandProxyPositions(
  assets: HumanoidAssets,
  id: string,
  sourcePositions: Float32Array,
  out?: Float32Array,
): Float32Array {
  if (sourcePositions.length !== boundProxy(assets, id).entry.vertexCount * 3)
    throw new ProxyError(`proxy ${id}: invalid source positions length`);
  const topology = proxyRenderTopology(assets, id);
  const positions = out ?? new Float32Array(topology.vertexCount * 3);
  if (positions.length !== topology.vertexCount * 3)
    throw new ProxyError(`proxy ${id}: invalid render positions length`);
  if (
    sourcePositions.buffer === positions.buffer &&
    sourcePositions.byteOffset < positions.byteOffset + positions.byteLength &&
    positions.byteOffset < sourcePositions.byteOffset + sourcePositions.byteLength
  )
    throw new ProxyError(`proxy ${id}: source and render positions overlap`);
  for (let v = 0; v < topology.vertexCount; v++) {
    const source = (topology.renderToProxy[v] as number) * 3;
    positions.set(sourcePositions.subarray(source, source + 3), v * 3);
  }
  return positions;
}

/**
 * `proxyIndex` visibility in render indices. Surviving triangles retain their
 * original relative order; a null mask returns the cached render index itself.
 */
export function proxyRenderIndex(
  assets: HumanoidAssets,
  id: string,
  bodyVisible: Uint8Array | null,
): Uint32Array {
  const topology = proxyRenderTopology(assets, id);
  if (!bodyVisible) return topology.index;
  const proxy = boundProxy(assets, id);
  const visible = transferVisibility(bodyVisible, proxy);
  const shows = faceVisibility(proxy.faceVerts, null, visible);
  const index: number[] = [];
  for (let t = 0; t < topology.triangleFace.length; t++)
    if (shows[topology.triangleFace[t] as number])
      index.push(
        topology.index[t * 3] as number,
        topology.index[t * 3 + 1] as number,
        topology.index[t * 3 + 2] as number,
      );
  return Uint32Array.from(index);
}
