import { describe, expect, it } from "vitest";
import { type LayerAtlasSource, withExtra } from "../src/render/layerAtlas.ts";
import { densePlan } from "../src/surface/atlasPlan.ts";

/**
 * The atlas draws an update's extra triangles (the adult surface's islands) with
 * the body's: `withExtra` is how they are joined, vertex numbering and per-layer
 * blocks of fields included. Rasterising them needs a GL context and is held by
 * the browser tests. The numbers are halves and quarters, exact in 32 bits.
 */
const source: LayerAtlasSource = {
  uvs: Float32Array.of(0, 0, 1, 0, 0, 1),
  index: Uint16Array.of(0, 1, 2),
  vertexCount: 3,
  // Two layers, a block of (mask, coordinate) per vertex each.
  layerFields: Float32Array.of(
    ...[1, 0.25, 1, 0.5, 1, 0.75], // layer a
    ...[0.5, 0.125, 0.5, 0.375, 0.5, 0.625], // layer b
  ),
  layers: ["a", "b"],
  plan: densePlan(2),
};
const extra = {
  uvs: Float32Array.of(0.5, 0.5, 0.75, 0.5, 0.5, 0.75, 0.75, 0.75),
  index: Uint32Array.of(0, 1, 2, 1, 3, 2),
  // The update holds layer b alone.
  layerFields: Float32Array.of(1, 0, 1, 0.5, 1, 0.5, 1, 1),
};

describe("a source with extra triangles", () => {
  const joined = withExtra(source, [1], extra);

  it("numbers the extra vertices after the body's and keeps both triangle lists", () => {
    expect(joined.vertexCount).toBe(7);
    expect(Array.from(joined.uvs)).toEqual([
      0, 0, 1, 0, 0, 1, 0.5, 0.5, 0.75, 0.5, 0.5, 0.75, 0.75, 0.75,
    ]);
    expect(Array.from(joined.index)).toEqual([0, 1, 2, 3, 4, 5, 4, 6, 5]);
    expect(joined.index).toBeInstanceOf(Uint32Array);
  });

  it("lays each layer's fields as the body's block and then the extra's, zero for a layer not updated", () => {
    const block = (l: number) => Array.from(joined.layerFields.subarray(l * 14, (l + 1) * 14));
    // Layer a: the body's fields, then nothing on the islands.
    expect(block(0)).toEqual([1, 0.25, 1, 0.5, 1, 0.75, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Layer b: the body's fields, then the update's.
    expect(block(1)).toEqual([0.5, 0.125, 0.5, 0.375, 0.5, 0.625, 1, 0, 1, 0.5, 1, 0.5, 1, 1]);
  });

  it("leaves the source as it was", () => {
    expect(source.vertexCount).toBe(3);
    expect(source.layerFields.length).toBe(12);
    expect(source.index.length).toBe(3);
  });
});
