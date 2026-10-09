import { describe, expect, it } from "vitest";
import {
  faceVisibility,
  GARMENT_LAYERS,
  layerOrder,
  maskIndex,
  OutfitError,
  stackVisibility,
  transferVisibility,
} from "../src/model/outfit.ts";

/** A garment whose vertex v is bound exactly to base vertex `refs[v]`. */
const garment = (
  id: string,
  kind: string,
  deleteVerts: number[],
  refs: number[] = [],
  zDepth = 50,
) => ({
  entry: { id, kind, zDepth },
  refVerts: Uint32Array.from(refs.flatMap((r) => [r, r, r])),
  weights: Float32Array.from(refs.flatMap(() => [1, 0, 0])),
  deleteVerts: Uint32Array.from(deleteVerts),
});

describe("layerOrder", () => {
  it("orders by the asset's own z_depth first, innermost (lowest) first", () => {
    // The system shoes declare z_depth 5, the system suits 50: the trousers hang
    // over the shoes, which is what MakeHuman shows and what a hem does.
    const ids = layerOrder([
      { id: "suit", kind: "clothes", zDepth: 50 },
      { id: "shoes", kind: "shoes", zDepth: 5 },
    ]);
    expect(ids).toEqual(["shoes", "suit"]);
    // The category does not override what a file says.
    expect(
      layerOrder([
        { id: "coat", kind: "coat", zDepth: 40 },
        { id: "shirt", kind: "clothes", zDepth: 60 },
      ]),
    ).toEqual(["coat", "shirt"]);
  });

  it("breaks a z_depth tie by the category table, then by id", () => {
    // MakeHuman ties on a random uuid; a category says which of two equally deep garments is over.
    const ids = layerOrder([
      { id: "coat", kind: "coat", zDepth: 50 },
      { id: "shirt", kind: "clothes", zDepth: 50 },
      { id: "underwear", kind: "underwear", zDepth: 50 },
      { id: "jacket", kind: "jacket", zDepth: 50 },
    ]);
    expect(ids).toEqual(["underwear", "shirt", "jacket", "coat"]);
    const a = { id: "a", kind: "clothes", zDepth: 50 };
    const b = { id: "b", kind: "clothes", zDepth: 50 };
    expect(layerOrder([b, a])).toEqual(["a", "b"]);
  });

  it("follows MakeHuman's convention for the categories it names", () => {
    expect(GARMENT_LAYERS).toMatchObject({
      underwear: 39,
      socks: 43,
      clothes: 47,
      sweater: 50,
      jacket: 53,
      shoes: 57,
      coat: 61,
      backpack: 69,
    });
  });

  it("gives the same order whatever order the garments arrive in", () => {
    const a = { id: "a", kind: "clothes", zDepth: 50 };
    const b = { id: "b", kind: "clothes", zDepth: 50 };
    const deep = { id: "z", kind: "clothes", zDepth: 60 };
    expect(layerOrder([deep, b, a])).toEqual(["a", "b", "z"]);
    expect(layerOrder([a, deep, b])).toEqual(["a", "b", "z"]);
  });

  it("refuses a category it has no place for, and a worn id twice", () => {
    expect(() => layerOrder([{ id: "x", kind: "eyes", zDepth: 5 }])).toThrow(OutfitError);
    const a = { id: "a", kind: "clothes", zDepth: 50 };
    expect(() => layerOrder([a, a])).toThrow(/twice/);
  });
});

describe("transferVisibility", () => {
  it("copies the visibility of a vertex bound exactly to one base vertex", () => {
    const g = garment("g", "clothes", [], [0, 1, 2]);
    expect([...transferVisibility(Uint8Array.from([1, 0, 1]), g)]).toEqual([1, 0, 1]);
  });

  it("hides a weighted vertex unless at least two of its three references are visible", () => {
    const g = {
      ...garment("g", "clothes", []),
      refVerts: Uint32Array.from([0, 1, 2, 0, 1, 2, 0, 1, 2]),
      weights: Float32Array.from([0.4, 0.3, 0.3, 0.4, 0.3, 0.3, 0.4, 0.3, 0.3]),
    };
    // Vertices 0, 1, 2 of the garment all bind to the same three base vertices;
    // vary the base visibility and read vertex 0 each time.
    const at = (vis: number[]) => transferVisibility(Uint8Array.from(vis), g)[0];
    expect(at([1, 1, 1])).toBe(1);
    expect(at([1, 1, 0])).toBe(1);
    expect(at([0, 1, 1])).toBe(1);
    expect(at([1, 0, 0])).toBe(0);
    expect(at([0, 0, 0])).toBe(0);
  });
});

describe("stackVisibility", () => {
  // Base vertices 0..5. Each garment vertex v is bound to base vertex v.
  const six = [0, 1, 2, 3, 4, 5];

  it("hides what a garment deletes from the body", () => {
    const shirt = garment("shirt", "clothes", [1, 2], six);
    const { base } = stackVisibility(6, [shirt]);
    expect([...base]).toEqual([1, 0, 0, 1, 1, 1]);
  });

  it("hides a garment under another only by the garments above it", () => {
    const shirt = garment("shirt", "clothes", [1, 2], six);
    const coat = garment("coat", "coat", [2, 3], six);
    const { base, garments } = stackVisibility(6, [shirt, coat]);
    // The body loses the union.
    expect([...base]).toEqual([1, 0, 0, 0, 1, 1]);
    // The coat is on top: nothing hides it, not even what the shirt deletes.
    expect([...(garments.get("coat") as Uint8Array)]).toEqual([1, 1, 1, 1, 1, 1]);
    // The shirt is hidden where the coat deletes, never where it deletes itself.
    expect([...(garments.get("shirt") as Uint8Array)]).toEqual([1, 1, 0, 0, 1, 1]);
  });

  it("gives the same masks whatever order the garments are listed in", () => {
    const shirt = garment("shirt", "clothes", [1, 2], six);
    const coat = garment("coat", "coat", [2, 3], six);
    const one = stackVisibility(6, [shirt, coat]);
    const two = stackVisibility(6, [coat, shirt]);
    expect([...one.base]).toEqual([...two.base]);
    expect([...(one.garments.get("shirt") as Uint8Array)]).toEqual([
      ...(two.garments.get("shirt") as Uint8Array),
    ]);
  });

  it("starts from the visibility it is given, without changing it", () => {
    const given = Uint8Array.from([0, 1, 1, 1, 1, 1]);
    const shirt = garment("shirt", "clothes", [4], six);
    const { base } = stackVisibility(6, [shirt], given);
    expect([...base]).toEqual([0, 1, 1, 1, 0, 1]);
    expect([...given]).toEqual([0, 1, 1, 1, 1, 1]);
  });

  it("lets a tied garment mask the one below it in id order", () => {
    // Same category and z_depth: `b` is outer (larger id), so only `b` masks `a`.
    const a = garment("a", "clothes", [0], six);
    const b = garment("b", "clothes", [5], six);
    const { garments } = stackVisibility(6, [a, b]);
    expect((garments.get("a") as Uint8Array)[5]).toBe(0);
    expect((garments.get("b") as Uint8Array)[0]).toBe(1);
  });
});

describe("faceVisibility", () => {
  // Two quads sharing an edge: 0 1 2 3 and 2 3 4 5.
  const quads = Uint32Array.from([0, 1, 2, 3, 2, 3, 4, 5]);

  it("hides a face only when every corner is hidden", () => {
    expect([...faceVisibility(quads, null, Uint8Array.from([0, 0, 0, 0, 1, 1]))]).toEqual([0, 1]);
    // One visible corner keeps the face: no gap ring at a garment's edge.
    expect([...faceVisibility(quads, null, Uint8Array.from([0, 0, 0, 1, 1, 1]))]).toEqual([1, 1]);
    expect([...faceVisibility(quads, null, Uint8Array.from([0, 0, 0, 0, 0, 0]))]).toEqual([0, 0]);
  });

  it("keeps a face whichever single corner is the visible one", () => {
    for (let corner = 0; corner < 4; corner++) {
      const visible = new Uint8Array(6);
      visible[corner] = 1;
      expect(faceVisibility(quads, null, visible)[0]).toBe(1);
    }
  });

  it("reads only the faces it is given, in that order", () => {
    const hidden = Uint8Array.from([0, 0, 0, 0, 1, 1]);
    expect([...faceVisibility(quads, Uint32Array.from([1, 0]), hidden)]).toEqual([1, 0]);
  });
});

describe("maskIndex", () => {
  it("drops the triangles of a hidden face and keeps the others in order", () => {
    // Two faces of two triangles each (one subdivision level 0).
    const index = Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
    expect([...maskIndex(index, Uint8Array.from([1, 0, 1]), 2)]).toEqual([
      0, 1, 2, 0, 2, 3, 8, 9, 10, 8, 10, 11,
    ]);
  });

  it("returns the whole index when every face is visible", () => {
    const index = Uint32Array.from([0, 1, 2, 0, 2, 3]);
    expect(maskIndex(index, Uint8Array.from([1]), 2)).toBe(index);
  });

  it("groups a subdivided face's triangles with their control face", () => {
    // One control face at level 1 owns 4 quads = 8 triangles.
    const index = Uint32Array.from({ length: 2 * 8 * 3 }, (_, i) => i);
    const kept = maskIndex(index, Uint8Array.from([0, 1]), 8);
    expect(kept.length).toBe(8 * 3);
    expect(kept[0]).toBe(24);
  });
});
