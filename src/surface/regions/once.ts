/**
 * Fields an area works out once per set of assets: a layer's `fields` is called
 * every time the stack is built, and an area's layers (the hands', the feet's,
 * the torso's) share measurements, so each is made on first use and kept.
 */
import { groupFaces, type HumanoidAssets } from "../../format/assetFormat.ts";

const cache = new WeakMap<object, Map<string, unknown>>();

/** `make()`'s result for `key` on these assets, made the first time it is asked for. */
export function once<T>(assets: HumanoidAssets, key: string, make: () => T): T {
  let m = cache.get(assets);
  if (!m) {
    m = new Map();
    cache.set(assets, m);
  }
  if (!m.has(key)) m.set(key, make());
  return m.get(key) as T;
}

/**
 * The vertices of the body surface (1, else 0): the base mesh also carries
 * helper geometry (the tights proxy garments are bound to, joints, ...) with
 * skin weights of its own, whose vertices lie a little off the skin and would
 * move a frame's extent or take a layer's mask where no skin is.
 */
export function bodySurface(assets: HumanoidAssets): Uint8Array {
  return once(assets, "body-surface", () => {
    const out = new Uint8Array(assets.manifest.vertexCount);
    for (const f of groupFaces(assets, "body"))
      for (let k = 0; k < 4; k++) out[assets.faceVerts[f * 4 + k] as number] = 1;
    return out;
  });
}
