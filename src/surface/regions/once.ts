/**
 * Fields an area works out once per set of assets: a layer's `fields` is called
 * every time the stack is built, and an area's layers (the hands', the feet's,
 * the torso's) share measurements, so each is made on first use and kept.
 */
import type { HumanoidAssets } from "../../format/assetFormat.ts";

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
