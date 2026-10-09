/**
 * Where each skin layer's fields lie in the field atlas (src/render/layerAtlas.ts):
 * which of its channels (four to a page) holds a layer's mask, and which its
 * coordinate. Pure data, so the model, the worker and the renderer agree on it.
 *
 * Layers whose supports (the skin their mask reaches, on the UV plane) lie
 * apart share their channels: a joint's creases, the lips and the areolae, and
 * whatever an area lane adds that sits on its own patch of the body. A layer
 * that shares reads its channels only in its own cells, which an owner map
 * (one id per cell of a coarse grid, read exactly) says. Layers that overlap
 * never share, so the broad state layers keep a channel each.
 */
import { layerUsesCoordinate, type SkinLayer } from "./layers.ts";

/** Cells along each side of the owner map. */
export const OWNER_GRID = 64;
/** An owner map's value for a cell no member of the channel lies in. */
export const NO_OWNER = 255;
/** A mask below this reaches no skin (the atlas keeps 8 bits). */
const SUPPORT_FLOOR = 1 / 512;

/**
 * Which atlas channel holds what: for each layer, the channel of its mask
 * (`value`, -1: none, the layer is on all the skin) and of its coordinate
 * (`coord`, -1: the shader reads none), and,
 * for a layer that shares its channels, the owner map it reads (`owner`, -1:
 * none) and its id in it.
 */
export interface AtlasPlan {
  value: Int16Array;
  coord: Int16Array;
  owner: Int16Array;
  ownerId: Uint8Array;
  channels: number;
  pages: number;
  /** `ownerChannels` maps of `OWNER_GRID²` cells (row `v`, column `u`), each cell an owner id or `NO_OWNER`. */
  ownerMaps: Uint8Array;
  ownerChannels: number;
}

/** What the plan needs of the body: its UV layout and the layers' fields per render vertex. */
export interface AtlasSurface {
  uvs: Float32Array;
  index: Uint32Array | Uint16Array;
  vertexCount: number;
  /** `layers.length` blocks of `vertexCount` (mask, coord) pairs. */
  layerFields: Float32Array;
}

const pagesFor = (channels: number) => Math.max(1, Math.ceil(channels / 4));

/** Two channels a layer, its mask then its coordinate, and no sharing: a source that has no layer definitions. */
export function densePlan(count: number): AtlasPlan {
  return {
    value: Int16Array.from({ length: count }, (_, l) => 2 * l),
    coord: Int16Array.from({ length: count }, (_, l) => 2 * l + 1),
    owner: new Int16Array(count).fill(-1),
    ownerId: new Uint8Array(count),
    channels: 2 * count,
    pages: pagesFor(2 * count),
    ownerMaps: new Uint8Array(0),
    ownerChannels: 0,
  };
}

/** Whether layer `l` reaches the skin of triangle `t`: any of its corners has mask. */
function reaches(surface: AtlasSurface, l: number, a: number, b: number, c: number): boolean {
  const base = l * surface.vertexCount * 2;
  const f = surface.layerFields;
  return (
    (f[base + a * 2] as number) > SUPPORT_FLOOR ||
    (f[base + b * 2] as number) > SUPPORT_FLOOR ||
    (f[base + c * 2] as number) > SUPPORT_FLOOR
  );
}

/**
 * The cells of the owner grid layer `l`'s support covers, and one cell round
 * them (a filter's reach and a gutter are less than a cell): the cells of the
 * bounding box of each triangle that has mask at a corner.
 */
function supportCells(surface: AtlasSurface, l: number): Uint8Array {
  const grid = OWNER_GRID;
  const out = new Uint8Array(grid * grid);
  const { uvs, index } = surface;
  const cell = (x: number) => Math.min(grid - 1, Math.max(0, Math.floor(x * grid)));
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] as number;
    const b = index[t + 1] as number;
    const c = index[t + 2] as number;
    if (!reaches(surface, l, a, b, c)) continue;
    const us = [a, b, c].map((v) => uvs[v * 2] as number);
    const vs = [a, b, c].map((v) => uvs[v * 2 + 1] as number);
    const x0 = cell(Math.min(...us)) - 1;
    const x1 = cell(Math.max(...us)) + 1;
    const y0 = cell(Math.min(...vs)) - 1;
    const y1 = cell(Math.max(...vs)) + 1;
    for (let y = Math.max(0, y0); y <= Math.min(grid - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(grid - 1, x1); x++) out[y * grid + x] = 1;
  }
  return out;
}

interface Group {
  members: number[];
  /** Cells any member covers; null for a group that takes no more (a layer that cannot be placed). */
  cells: Uint8Array | null;
  /** Whether a member reads a coordinate, which gives the group a channel for it. */
  reads: boolean;
}

/**
 * The layout: layers are placed in order, each in the first group whose layers
 * it lies apart from and which costs it no channel, else the first it lies apart
 * from (or in a group of its own). A layer that reads a coordinate costs a group
 * that has no coordinate channel one more channel, so it goes first to a group that
 * has one. A group has a value channel,
 * a coordinate channel if any member reads one, and, with two or more members,
 * an owner map. Without a surface, or for an adult layer (whose fields arrive
 * after the plan) or one that reaches nothing, a layer is its own group. A
 * layer on all the skin (`everywhere`) takes no channel at all: its `value` is
 * -1, and the shader reads its mask as 1.
 */
export function planAtlas(layers: readonly SkinLayer[], surface?: AtlasSurface): AtlasPlan {
  const groups: Group[] = [];
  layers.forEach((layer, l) => {
    // A layer on all the skin has no field to store: the shader reads its mask as 1.
    if (layer.everywhere) return;
    const cells = surface && !layer.adult ? supportCells(surface, l) : null;
    const reads = layerUsesCoordinate(layer);
    if (cells?.some((c) => c === 1)) {
      const apart = groups.filter((g) => {
        const union = g.cells;
        return union && !cells.some((c, i) => c === 1 && union[i] === 1);
      });
      // A group with what the layer reads costs nothing; otherwise the first one apart.
      const g = apart.find((x) => x.reads || !reads) ?? apart[0];
      if (g?.cells) {
        const union = g.cells;
        g.members.push(l);
        g.reads ||= reads;
        cells.forEach((c, i) => {
          if (c === 1) union[i] = 1;
        });
        return;
      }
      groups.push({ members: [l], cells: Uint8Array.from(cells), reads });
      return;
    }
    groups.push({ members: [l], cells: null, reads });
  });

  const value = new Int16Array(layers.length).fill(-1);
  const coord = new Int16Array(layers.length).fill(-1);
  const owner = new Int16Array(layers.length).fill(-1);
  const ownerId = new Uint8Array(layers.length);
  const maps: Uint8Array[] = [];
  let channels = 0;
  for (const g of groups) {
    const v = channels++;
    const c = g.reads ? channels++ : -1;
    const shared = g.members.length > 1;
    const map = shared ? new Uint8Array(OWNER_GRID * OWNER_GRID).fill(NO_OWNER) : null;
    if (map) maps.push(map);
    g.members.forEach((l, k) => {
      value[l] = v;
      if (layerUsesCoordinate(layers[l] as SkinLayer)) coord[l] = c;
      if (map && surface) {
        owner[l] = maps.length - 1;
        ownerId[l] = k;
        const mine = supportCells(surface, l);
        mine.forEach((cell, i) => {
          if (cell === 1) map[i] = k;
        });
      }
    });
  }
  const ownerMaps = new Uint8Array(maps.length * OWNER_GRID * OWNER_GRID);
  maps.forEach((m, i) => {
    ownerMaps.set(m, i * OWNER_GRID * OWNER_GRID);
  });
  return {
    value,
    coord,
    owner,
    ownerId,
    channels,
    pages: pagesFor(channels),
    ownerMaps,
    ownerChannels: maps.length,
  };
}

/**
 * For layers that share a channel, which of them each vertex belongs to: the
 * one whose support has a triangle at the vertex (their supports are apart,
 * so at most one does), or -1. The atlas rasterises a shared channel from it.
 */
export function vertexOwners(surface: AtlasSurface, members: readonly number[]): Int16Array {
  const out = new Int16Array(surface.vertexCount).fill(-1);
  const { index } = surface;
  members.forEach((l, k) => {
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] as number;
      const b = index[t + 1] as number;
      const c = index[t + 2] as number;
      if (!reaches(surface, l, a, b, c)) continue;
      out[a] = k;
      out[b] = k;
      out[c] = k;
    }
  });
  return out;
}
