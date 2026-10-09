/**
 * Where each skin layer's fields lie in the field atlas (src/render/layerAtlas.ts):
 * which of its channels (four to a page) holds a layer's mask, and which its
 * coordinate. Pure data, so the model, the worker and the renderer agree on it.
 */
import { layerUsesCoordinate, type SkinLayer } from "./layers.ts";

/**
 * Which atlas channel holds what: for each layer, the channel of its mask and
 * of its coordinate (-1: the shader reads none). Layers of one `coordGroup`
 * share a coordinate channel.
 */
export interface AtlasPlan {
  mask: Int16Array;
  coord: Int16Array;
  channels: number;
  pages: number;
}

const planOf = (mask: Int16Array, coord: Int16Array, channels: number): AtlasPlan => ({
  mask,
  coord,
  channels,
  // At least one page, so the sampler is always valid.
  pages: Math.max(1, Math.ceil(channels / 4)),
});

/**
 * The shipped layout: a channel for each mask, one for each coordinate a
 * layer's shader reads, and one coordinate between the layers of a group
 * (the joint creases are twelve layers on one coordinate).
 */
export function planAtlas(layers: readonly SkinLayer[]): AtlasPlan {
  const mask = new Int16Array(layers.length);
  const coord = new Int16Array(layers.length).fill(-1);
  const groups = new Map<string, number>();
  let next = 0;
  layers.forEach((layer, l) => {
    mask[l] = next++;
    if (!layerUsesCoordinate(layer)) return;
    const shared = layer.coordGroup === undefined ? undefined : groups.get(layer.coordGroup);
    if (shared !== undefined) {
      coord[l] = shared;
      return;
    }
    coord[l] = next++;
    if (layer.coordGroup !== undefined) groups.set(layer.coordGroup, coord[l] as number);
  });
  return planOf(mask, coord, next);
}

/** Two channels a layer, its mask then its coordinate: for a source that has no layer definitions. */
export function densePlan(count: number): AtlasPlan {
  const mask = Int16Array.from({ length: count }, (_, l) => 2 * l);
  const coord = Int16Array.from({ length: count }, (_, l) => 2 * l + 1);
  return planOf(mask, coord, 2 * count);
}
