/**
 * Places the reservoirs' UV islands (`AdultReservoirSpec.island`) in free space of
 * the body's UV layout, for the packer: the owner-map cells the body's triangles
 * reach, with a cell round them, and first-fit rectangles in the cells left, each
 * island then claiming its own cells and a cell round them. An island alone in its
 * cells can share an atlas channel with any layer it lies apart from (`planAtlas`).
 * Deterministic, so a repack gives the pack the same islands.
 *
 * An island is a tube's wall, a strip whose long side runs along the rings (one
 * metre of skin per UV unit as the root's skin has) and whose short side is the
 * tube's circumference, and a disc for the cap. Placed once, for the largest tube
 * the detail will draw, so a smaller one shows its texture compressed along the
 * rings; the skin layers' fields are smooth, so that costs nothing.
 */
import type { AdultReservoirSpec } from "../../src/format/assetFormat.ts";
import { OWNER_GRID } from "../../src/surface/atlasPlan.ts";

/** The atlas' grid (`buildLayerAtlas`' default size). */
export const ATLAS_SIZE = 1024;
/** Texels kept clear inside the free cells round an island: the filter's reach and a gutter. */
const GUTTER = 6;

/**
 * Marks every texel of the owner-map cells (`OWNER_GRID` to a side, whatever the
 * grid's `size`) that a box of texels reaches, and one cell round them: as the atlas
 * planner counts a footprint (`planAtlas`, `supportCells`).
 */
function markCells(
  covered: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number,
) {
  const g = OWNER_GRID;
  const cell = (t: number) => Math.min(g - 1, Math.max(0, Math.floor((t / size) * g)));
  const texel = (c: number) => Math.round((c / g) * size);
  for (let cy = Math.max(0, cell(y0) - 1); cy <= Math.min(g - 1, cell(y1) + 1); cy++)
    for (let cx = Math.max(0, cell(x0) - 1); cx <= Math.min(g - 1, cell(x1) + 1); cx++)
      for (let y = texel(cy); y < texel(cy + 1); y++)
        covered.fill(1, y * size + texel(cx), y * size + texel(cx + 1));
}

/**
 * What the body's UV layout covers: 1 where an island may not go. That is every
 * owner-map cell a body triangle reaches, and one cell round it, as the atlas planner
 * counts a footprint. An island in a cell a body triangle shares, however many texels
 * apart, cannot share a channel with that body layer: the owner map tells channel
 * members apart by cell. Placed by texels alone, the testes island lay in the cells of
 * the palms', the mouth's and the flush layers' triangles, and shared with none.
 */
export function bodyCoverage(
  uvs: Float32Array,
  index: ArrayLike<number>,
  size = ATLAS_SIZE,
): Uint8Array {
  const covered = new Uint8Array(size * size);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const us = [0, 1, 2].map((k) => (uvs[(index[t + k] as number) * 2] as number) * size);
    const vs = [0, 1, 2].map((k) => (uvs[(index[t + k] as number) * 2 + 1] as number) * size);
    markCells(covered, Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs), size);
  }
  return covered;
}

/** A rectangle of texels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The first rectangle of `width` x `height` texels (scanning rows, then columns)
 * free with `GUTTER` of clearance, its owner-map cells and a cell round them then
 * marked as taken, or null when there is none.
 */
export function takeRect(
  covered: Uint8Array,
  width: number,
  height: number,
  size = ATLAS_SIZE,
): Rect | null {
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  // A summed-area table, so a rectangle is empty when its sum is zero.
  const sat = new Int32Array((size + 1) * (size + 1));
  for (let y = 0; y < size; y++) {
    let row = 0;
    for (let x = 0; x < size; x++) {
      row += covered[y * size + x] as number;
      sat[(y + 1) * (size + 1) + x + 1] = (sat[y * (size + 1) + x + 1] as number) + row;
    }
  }
  const sum = (x0: number, y0: number, x1: number, y1: number) =>
    (sat[y1 * (size + 1) + x1] as number) -
    (sat[y0 * (size + 1) + x1] as number) -
    (sat[y1 * (size + 1) + x0] as number) +
    (sat[y0 * (size + 1) + x0] as number);
  for (let y = GUTTER; y + h + GUTTER <= size; y++)
    for (let x = GUTTER; x + w + GUTTER <= size; x++) {
      if (sum(x - GUTTER, y - GUTTER, x + w + GUTTER, y + h + GUTTER) !== 0) continue;
      markCells(covered, x, y, x + w - 1, y + h - 1, size);
      return { x, y, width: w, height: h };
    }
  return null;
}

/** The physical size (metres) an island is made for: the tube's circumference and length and the cap's radius. */
export interface IslandSize {
  circumference: number;
  length: number;
  cap: number;
}

/**
 * The specs with islands placed in free space: each reservoir, in order, gets a
 * strip (its length along u, its circumference along v) and a disc, at
 * `metresPerUv` skin per UV unit. `layers` names the skin layer of each reservoir by id.
 */
export function placeIslands(
  specs: readonly AdultReservoirSpec[],
  sizes: Readonly<Record<string, IslandSize>>,
  layers: Readonly<Record<string, string>>,
  metresPerUv: Readonly<Record<string, number>>,
  covered: Uint8Array,
  size = ATLAS_SIZE,
): AdultReservoirSpec[] {
  return specs.map((spec) => {
    const want = sizes[spec.id];
    const layer = layers[spec.id];
    // A reservoir with no island size draws inward (a canal) and keeps its skin's UVs.
    if (!want && !layer) return spec;
    const scale = metresPerUv[spec.id];
    if (!want || !layer || !scale)
      throw new Error(`reservoir ${spec.id}: no island size, layer or scale`);
    const texels = (metres: number) => (metres / scale) * size;
    const strip = takeRect(covered, texels(want.length), texels(want.circumference), size);
    const disc = takeRect(covered, 2 * texels(want.cap), 2 * texels(want.cap), size);
    if (!strip || !disc) throw new Error(`reservoir ${spec.id}: no free UV space for its island`);
    const uv = (x: number, y: number): [number, number] => [x / size, y / size];
    return {
      ...spec,
      layer,
      island: {
        origin: uv(strip.x, strip.y),
        // The wall's length along u, its circumference along v.
        along: [strip.width / size, 0],
        across: [0, strip.height / size],
        cap: {
          centre: uv(disc.x + disc.width / 2, disc.y + disc.height / 2),
          radius: disc.width / 2 / size,
        },
      },
    };
  });
}
