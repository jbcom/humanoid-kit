/**
 * Places the reservoirs' UV islands (`AdultReservoirSpec.island`) in free space of
 * the body's UV layout, for the packer: the coverage of the body's triangles in the
 * layer atlas' grid, dilated by a gutter, and first-fit rectangles in what is left.
 * Deterministic, so a repack gives the pack the same islands.
 *
 * An island is a tube's wall, a strip whose long side runs along the rings (one
 * metre of skin per UV unit as the root's skin has) and whose short side is the
 * tube's circumference, and a disc for the cap. Placed once, for the largest tube
 * the detail will draw, so a smaller one shows its texture compressed along the
 * rings; the skin layers' fields are smooth, so that costs nothing.
 */
import type { AdultReservoirSpec } from "../../src/format/assetFormat.ts";

/** The atlas' grid (`buildLayerAtlas`' default size). */
export const ATLAS_SIZE = 1024;
/** Texels kept clear round a body island and round each island placed: the filter's reach and a gutter. */
const GUTTER = 6;

/** What the body's UV layout covers, dilated by `GUTTER` texels: 1 where an island may not go. */
export function bodyCoverage(
  uvs: Float32Array,
  index: ArrayLike<number>,
  size = ATLAS_SIZE,
): Uint8Array {
  const covered = new Uint8Array(size * size);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const p = [0, 1, 2].map((k) => [
      (uvs[(index[t + k] as number) * 2] as number) * size,
      (uvs[(index[t + k] as number) * 2 + 1] as number) * size,
    ]) as [number, number][];
    const x0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q[0])) - GUTTER));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(...p.map((q) => q[0])) + GUTTER));
    const y0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q[1])) - GUTTER));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(...p.map((q) => q[1])) + GUTTER));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (covered[y * size + x]) continue;
        const px = x + 0.5;
        const py = y + 0.5;
        // Within GUTTER of the triangle: inside it, or within that of one of its edges.
        let sign = 0;
        let inside = true;
        let near = false;
        for (let e = 0; e < 3; e++) {
          const a = p[e] as [number, number];
          const b = p[(e + 1) % 3] as [number, number];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const side = ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])) / len;
          if (sign === 0 && Math.abs(side) > 1e-9) sign = Math.sign(side);
          if (side * sign < 0) inside = false;
          const along = ((px - a[0]) * (b[0] - a[0]) + (py - a[1]) * (b[1] - a[1])) / (len * len);
          const t = Math.min(1, Math.max(0, along));
          if (
            Math.hypot(px - (a[0] + t * (b[0] - a[0])), py - (a[1] + t * (b[1] - a[1]))) <= GUTTER
          )
            near = true;
        }
        if (inside || near) covered[y * size + x] = 1;
      }
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
 * The first free rectangle of `width` x `height` texels (scanning rows, then
 * columns), marked as taken with `GUTTER` of clearance, or null when there is none.
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
      if (sum(x, y, x + w, y + h) !== 0) continue;
      for (let j = Math.max(0, y - GUTTER); j < Math.min(size, y + h + GUTTER); j++)
        for (let i = Math.max(0, x - GUTTER); i < Math.min(size, x + w + GUTTER); i++)
          covered[j * size + i] = 1;
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
