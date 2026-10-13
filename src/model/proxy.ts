/**
 * MakeHuman proxy bodies (docs/MINIATURES.md): other topologies for the whole
 * body, bound to the base mesh exactly as garments are, so a proxy follows
 * every morph the figure has. The kit fits them as MakeHuman does: each vertex
 * is a weighted sum of three morphed base vertices plus a scaled offset
 * (`evaluateBinding`), its skin blends those base vertices' skin weights
 * (`bindingSkin`), and under clothes it shows where at least two of its base
 * vertices still show (`transferVisibility`).
 */
import type { BoundProxy, HumanoidAssets } from "../format/assetFormat.ts";
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
  /** Four bone indices and weights per vertex, from the base vertices it is bound to. */
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
