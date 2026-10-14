import { describe, expect, it } from "vitest";
import {
  evaluateBinding,
  evaluateBindingWithGrowth,
  evaluateBindingWithOffsetScale,
  resolveOffsetScaleGrowth,
  sourceCardRootFrames,
  sourceCardRoots,
} from "../src/mhclo/bound.ts";
import { parseMhclo } from "../src/mhclo/parse.ts";

const HEADER =
  "# author Jane Doe\n# license CC0\nname Knitted Sweater - Sleeveless\nobj_file sweater.obj\nz_depth 60\n";

describe("parseMhclo", () => {
  it("reads exact and weighted vertex lines and keeps multi-word metadata whole", () => {
    const b = parseMhclo(`${HEADER}verts 0\n7\n1 2 3 0.5 0.25 0.25 0.1 0.2 0.3\n\n`);
    expect(b.name).toBe("Knitted Sweater - Sleeveless");
    expect(b.author).toBe("Jane Doe");
    expect(b.licenseLine).toBe("# license CC0");
    expect(b.zDepth).toBe(60);
    expect([...b.refVerts]).toEqual([7, 7, 7, 1, 2, 3]);
    expect([...b.weights]).toEqual([1, 0, 0, 0.5, 0.25, 0.25]);
    expect([...b.offsets].map((x) => Math.round(x * 10) / 10)).toEqual([0, 0, 0, 0.1, 0.2, 0.3]);
  });

  it("reads delete_verts ranges and singles", () => {
    const b = parseMhclo(`${HEADER}verts 0\n1\n\ndelete_verts\n10 - 12 20\n`);
    expect([...b.deleteVerts]).toEqual([10, 11, 12, 20]);
  });

  it("does not lose a delete_verts section written straight after the vertex block", () => {
    const b = parseMhclo(`${HEADER}verts 0\n1\n2\ndelete_verts\n0 - 5\n`);
    expect([...b.refVerts]).toEqual([1, 1, 1, 2, 2, 2]);
    expect([...b.deleteVerts]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("accepts material lines and comments inside the vertex block", () => {
    const b = parseMhclo(`${HEADER}verts 0\nmaterial wool.mhmat\n# note\n4\n\n`);
    expect(b.material).toBe("wool.mhmat");
    expect([...b.refVerts]).toEqual([4, 4, 4]);
  });

  it("keeps reading vertices after keyword lines written between `verts` and the data", () => {
    // The system shoes put `material` and `vertexboneweights_file` there; a
    // reader that ends the block at the first keyword binds none of the mesh.
    const b = parseMhclo(
      `${HEADER}verts 0\nmaterial shoe.mhmat\nvertexboneweights_file shoe.mhw\n4\n1 2 3 0.5 0.25 0.25 0 0 0\n`,
    );
    expect(b.material).toBe("shoe.mhmat");
    expect([...b.refVerts]).toEqual([4, 4, 4, 1, 2, 3]);
  });

  it("does not end a section at a blank line, as MakeHuman's reader does not", () => {
    const b = parseMhclo(`${HEADER}verts 0\n1\n\n2\ndelete_verts\n0 - 1\n\n5 - 6\n`);
    expect([...b.refVerts]).toEqual([1, 1, 1, 2, 2, 2]);
    expect([...b.deleteVerts]).toEqual([0, 1, 5, 6]);
  });

  it("reads a delete_verts range that wraps onto the next line", () => {
    const b = parseMhclo(`${HEADER}verts 0\n1\ndelete_verts\n3 - 4 8\n- 10\n`);
    expect([...b.deleteVerts]).toEqual([3, 4, 8, 9, 10]);
  });

  it("rejects malformed vertex lines and a missing obj_file", () => {
    expect(() => parseMhclo(`${HEADER}verts 0\n1 2\n`)).toThrow(/1 or 9 fields/);
    expect(() => parseMhclo("name x\n")).toThrow(/obj_file/);
  });
});

describe("evaluateBindingWithOffsetScale", () => {
  const asset = {
    entry: { vertexCount: 1, scale: null },
    refVerts: Uint32Array.of(0, 1, 2),
    weights: Float32Array.of(0.5, 0.25, 0.25),
    offsets: Float32Array.of(0.1, -0.2, 0.3),
  } as never;
  const control = Float32Array.of(0, 0, 0, 2, 0, 0, 0, 4, 0);

  it("keeps the bound anchor and multiplies only the authored free offset", () => {
    const normal = evaluateBinding(asset, control, new Float32Array(3));
    const one = evaluateBindingWithOffsetScale(asset, control, 1, new Float32Array(3));
    const long = evaluateBindingWithOffsetScale(asset, control, 4, new Float32Array(3));
    expect(Array.from(one)).toEqual(Array.from(normal));
    expect(Array.from(long).map((value) => Number(value.toFixed(6)))).toEqual([0.9, 0.2, 1.2]);
  });

  it("refuses shrinking, infinity and NaN", () => {
    for (const scale of [0.999, Number.POSITIVE_INFINITY, Number.NaN])
      expect(() =>
        evaluateBindingWithOffsetScale(asset, control, scale, new Float32Array(3)),
      ).toThrow(RangeError);
  });

  it("rejects finite multipliers that would overflow Float32 output before writing", () => {
    const out = Float32Array.of(7, 8, 9);
    expect(() => evaluateBindingWithOffsetScale(asset, control, Number.MAX_VALUE, out)).toThrow(
      /finite Float32 output/,
    );
    expect(Array.from(out)).toEqual([7, 8, 9]);
  });

  it("derives every source-card root from its boundary edge nearest the MHCLO base surface", () => {
    const card = {
      entry: { vertexCount: 6, scale: null },
      refVerts: Uint32Array.from(Array(18).fill(0)),
      weights: Float32Array.from(Array.from({ length: 6 }, () => [1, 0, 0]).flat()),
      offsets: Float32Array.of(
        0,
        0,
        0,
        0,
        0,
        0,
        0.2,
        -0.1,
        0,
        0.2,
        -0.1,
        0,
        0.2,
        -0.2,
        0,
        0.2,
        -0.2,
        0,
      ),
      faceVerts: Uint32Array.of(0, 1, 4, 3, 1, 2, 5, 4),
    } as never;
    const control = Float32Array.of(0, 0, 0);
    const native = evaluateBinding(card, control, new Float32Array(18));
    expect(Array.from(sourceCardRoots(card, control, native))).toEqual([1, 1, 0, 0, 0, 0]);
  });

  it("keeps an attachment edge for every boundary loop in a connected source component", () => {
    const multiCard = {
      entry: { vertexCount: 8, scale: null },
      refVerts: Uint32Array.from(Array(24).fill(0)),
      weights: Float32Array.from(Array.from({ length: 8 }, () => [1, 0, 0]).flat()),
      offsets: Float32Array.of(
        0,
        0,
        0,
        0,
        0,
        0,
        0.2,
        -0.1,
        0,
        0.2,
        -0.1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0.2,
        -0.1,
        0,
        0.2,
        -0.1,
        0,
      ),
      faceVerts: Uint32Array.of(0, 1, 5, 4, 1, 2, 6, 5, 2, 3, 7, 6, 3, 0, 4, 7),
    } as never;
    const control = Float32Array.of(0, 0, 0);
    const native = evaluateBinding(multiCard, control, new Float32Array(24));
    expect(Array.from(sourceCardRoots(multiCard, control, native))).toEqual([
      1, 1, 0, 0, 1, 1, 0, 0,
    ]);
  });

  it("shrinks every source card monotonically toward its own attachment frame", () => {
    const card = {
      entry: { vertexCount: 4, scale: null },
      refVerts: Uint32Array.from(Array(12).fill(0)),
      weights: Float32Array.from(Array.from({ length: 4 }, () => [1, 0, 0]).flat()),
      offsets: Float32Array.of(0, 0, 0, 0.2, 0, 0, 0.2, -1, 0, 0, -1, 0),
      faceVerts: Uint32Array.of(0, 1, 2, 3),
    } as never;
    const control = Float32Array.of(0, 0, 0);
    const native = evaluateBinding(card, control, new Float32Array(12));
    const rootState = sourceCardRootFrames(card, control, native);
    const at = (fraction: number) => {
      const placed = evaluateBindingWithGrowth(
        card,
        control,
        resolveOffsetScaleGrowth(card, control, -2, fraction),
        new Float32Array(12),
        rootState.frames,
      );
      for (let vertex = 0; vertex < 4; vertex++) {
        if (!rootState.roots[vertex]) continue;
        placed.set(native.subarray(vertex * 3, vertex * 3 + 3), vertex * 3);
      }
      return placed;
    };
    const distanceFromFrame = (positions: Float32Array, vertex: number) => {
      const offset = vertex * 3;
      let squared = 0;
      for (let axis = 0; axis < 3; axis++)
        squared +=
          ((positions[offset + axis] as number) - (rootState.frames[offset + axis] as number)) ** 2;
      return Math.sqrt(squared);
    };
    const early = at(0.1);
    const middle = at(0.25);
    const nearNative = at(0.49);
    const source = at(0.5);
    for (const root of [0, 1])
      expect(Array.from(nearNative.slice(root * 3, root * 3 + 3))).toEqual(
        Array.from(native.slice(root * 3, root * 3 + 3)),
      );
    for (const tip of [2, 3]) {
      expect(distanceFromFrame(early, tip)).toBeLessThan(distanceFromFrame(middle, tip));
      expect(distanceFromFrame(middle, tip)).toBeLessThan(distanceFromFrame(nearNative, tip));
      expect(distanceFromFrame(nearNative, tip)).toBeLessThan(distanceFromFrame(source, tip));
      expect(source[tip * 3 + 1]).toBeLessThan(native[0 * 3 + 1] as number);
    }
  });

  it("contracts to the exact source at the native point, then extends common source depth", () => {
    const growthAsset = {
      entry: { vertexCount: 2, scale: null },
      refVerts: Uint32Array.of(0, 1, 2, 0, 1, 2),
      weights: Float32Array.of(0.5, 0.25, 0.25, 0.5, 0.25, 0.25),
      offsets: Float32Array.of(0.1, -0.2, 0.3, 0.1, -0.4, 0.3),
    } as never;
    const hidden = resolveOffsetScaleGrowth(growthAsset, control, 0, 0);
    const smaller = resolveOffsetScaleGrowth(growthAsset, control, 0, 0.25);
    const native = resolveOffsetScaleGrowth(growthAsset, control, 0, 0.5);
    const floor = resolveOffsetScaleGrowth(growthAsset, control, 0, 1);
    expect(hidden.visible).toBe(false);
    expect(hidden.sourceScale).toBe(0);
    expect(hidden.restFloorDepthScale).toBeCloseTo(4, 6);
    expect(smaller.visible).toBe(true);
    expect(smaller.sourceScale).toBeCloseTo(0.5, 6);
    const untouched = new Float32Array(6).fill(7);
    expect(() => evaluateBindingWithGrowth(growthAsset, control, smaller, untouched)).toThrow(
      "attachment-root frame",
    );
    expect(Array.from(untouched)).toEqual([7, 7, 7, 7, 7, 7]);
    expect(native.nativeFraction).toBe(0.5);
    expect(
      Array.from(evaluateBindingWithGrowth(growthAsset, control, native, new Float32Array(6))),
    ).toEqual(Array.from(evaluateBinding(growthAsset, control, new Float32Array(6))));
    expect(floor.restFloorDepthScale).toBeCloseTo(4, 6);
    expect(floor.depthScale).toBeCloseTo(4, 6);
    expect(floor.sourceScale).toBe(1);
    expect(
      Array.from(evaluateBindingWithGrowth(growthAsset, control, floor, new Float32Array(6))).map(
        (value) => Number(value.toFixed(6)),
      ),
    ).toEqual([0.6, 0.8, 0.3, 0.6, 0, 0.3]);
  });
});
