import { describe, expect, it } from "vitest";
import { encodeBodyOcclusion } from "../scripts/lib/packWriter.ts";
import {
  AssetFormatError,
  type BodyManifest,
  type BodyOcclusion,
  type BodyOcclusionEntry,
  parseBodyOcclusion,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { OCCLUSION_KEYS, occlusionCorners } from "../src/rig/occlusionKeys.ts";
import {
  cavityCandidates,
  cavityOcclusion,
  expandBodyOcclusion,
  OPEN_VISIBILITY,
  selectCavity,
} from "../src/surface/bodyOcclusion.ts";
import { bodyManifest, bodyPackData, loadFixtureAssets } from "./fixtures.ts";

const CORNERS = occlusionCorners(OCCLUSION_KEYS.length);

describe("cavityOcclusion", () => {
  it("counts visibility at or above the open level as fully open, and scales linearly below it", () => {
    expect(cavityOcclusion(1)).toBe(1);
    expect(cavityOcclusion(OPEN_VISIBILITY)).toBe(1);
    expect(cavityOcclusion(OPEN_VISIBILITY / 2)).toBeCloseTo(0.5, 6);
    expect(cavityOcclusion(0)).toBe(0);
    // Continuous at the edge of the set, so no step shows where a vertex stops being stored.
    expect(cavityOcclusion(OPEN_VISIBILITY - 1e-4)).toBeGreaterThan(0.999);
  });
});

describe("selectCavity", () => {
  // Four candidates at the eight corners (rows are corners): 10 is open everywhere,
  // 11 is enclosed at rest only, 12 only in the last corner, 13 is exactly at the open level.
  const candidates = Uint32Array.from([10, 11, 12, 13]);
  const bakes = Array.from({ length: CORNERS }, (_, m) =>
    Float32Array.from([1, m === 0 ? 0.2 : 1, m === CORNERS - 1 ? 0.34 : 1, OPEN_VISIBILITY]),
  );

  it("keeps the candidates enclosed at some corner, in ascending order, with every corner's value", () => {
    const sparse = selectCavity(candidates, bakes);
    expect(Array.from(sparse.vertices)).toEqual([11, 12]);
    expect(sparse.values.length).toBe(2 * CORNERS);
    // Layout: corner by corner, each `vertices.length` long.
    expect(sparse.values[0]).toBe(Math.round((0.2 / OPEN_VISIBILITY) * 255));
    expect(sparse.values[1]).toBe(255);
    expect(sparse.values[(CORNERS - 1) * 2 + 1]).toBe(Math.round((0.34 / OPEN_VISIBILITY) * 255));
    expect(sparse.values[2]).toBe(255);
  });

  it("refuses bakes that do not match the candidates", () => {
    expect(() => selectCavity(candidates, [new Float32Array(3)])).toThrow(
      /one value per candidate/,
    );
  });
});

describe("expandBodyOcclusion", () => {
  it("lays one corner's values on their vertices and leaves every other vertex open", () => {
    const sparse: BodyOcclusion = {
      vertices: Uint32Array.from([1, 3]),
      values: Uint8Array.from({ length: 2 * CORNERS }, (_, i) => (i < 2 ? 51 : 255)),
    };
    expect(Array.from(expandBodyOcclusion(sparse, 5, 0))).toEqual(
      Array.from(Float32Array.of(1, 0.2, 1, 0.2, 1)),
    );
    expect(Array.from(expandBodyOcclusion(sparse, 5, 1))).toEqual([1, 1, 1, 1, 1]);
    expect(() => expandBodyOcclusion(sparse, 5, CORNERS)).toThrow(RangeError);
    expect(() => expandBodyOcclusion(sparse, 3, 0)).toThrow(RangeError);
  });
});

describe("the body occlusion file", () => {
  const sparse: BodyOcclusion = {
    vertices: Uint32Array.from([2, 5, 9]),
    values: Uint8Array.from({ length: 3 * CORNERS }, (_, i) => (i * 7) % 256),
  };
  const keys = OCCLUSION_KEYS.map((k) => k.id);
  const written = encodeBodyOcclusion(sparse, keys);
  const raw = () => written.raw.slice().buffer as ArrayBuffer;

  it("reads back what the packer wrote", () => {
    expect(written.entry).toEqual({ keys, count: 3 });
    const back = parseBodyOcclusion(written.entry, raw(), 20);
    expect(Array.from(back.vertices)).toEqual([2, 5, 9]);
    expect(Array.from(back.values)).toEqual(Array.from(sparse.values));
  });

  it("names what is wrong with a file that does not fit its entry", () => {
    expect(() => parseBodyOcclusion({ ...written.entry, count: 4 }, raw(), 20)).toThrow(
      AssetFormatError,
    );
    expect(() => parseBodyOcclusion(written.entry, raw(), 9)).toThrow(/out of range/);
    const unsorted = encodeBodyOcclusion(
      { vertices: Uint32Array.from([5, 2, 9]), values: sparse.values },
      keys,
    );
    expect(() =>
      parseBodyOcclusion(unsorted.entry, unsorted.raw.slice().buffer as ArrayBuffer, 20),
    ).toThrow(/ascending/);
    expect(() => parseBodyOcclusion({ ...written.entry, keys: ["jawOpen"] }, raw(), 20)).toThrow(
      /keys/,
    );
  });
});

describe("the cavity candidates", () => {
  it("are the visible body's vertices that any head, jaw, tongue or face bone moves", () => {
    const assets = loadFixtureAssets();
    const candidates = cavityCandidates(assets);
    expect(candidates.length).toBeGreaterThan(2000);
    expect(candidates.length).toBeLessThan(6000);
    expect(candidates.every((v, i) => i === 0 || (candidates[i - 1] as number) < v)).toBe(true);
    const foot = assets.manifest.skeleton.joints["foot.L____head"] as number[];
    expect(candidates).not.toContain(foot[0]);
  });
});

describe("the shipped body occlusion", () => {
  const assets = loadFixtureAssets();
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const rest = model.evaluate(createRecipe()).control;
  const sparse = assets.bodyOcclusion as BodyOcclusion;
  const at = (v: number) => [
    rest[v * 3] as number,
    rest[v * 3 + 1] as number,
    rest[v * 3 + 2] as number,
  ];
  const value = (v: number, corner: number) => {
    const i = sparse.vertices.indexOf(v);
    return i < 0 ? 1 : (sparse.values[corner * sparse.vertices.length + i] as number) / 255;
  };

  it("is in the pack, baked at the code's keys, and sparse", () => {
    expect(sparse).toBeTruthy();
    expect(bodyManifest.bodyOcclusion?.keys).toEqual(OCCLUSION_KEYS.map((k) => k.id));
    expect(sparse.values.length).toBe(sparse.vertices.length * CORNERS);
    expect(sparse.vertices.length).toBeGreaterThan(300);
    // A small part of the base mesh: no storage is spent on open skin.
    expect(sparse.vertices.length).toBeLessThan(assets.manifest.vertexCount / 5);
    const candidates = new Set(cavityCandidates(assets));
    expect(sparse.vertices.every((v) => candidates.has(v))).toBe(true);
  });

  it("darkens the inside of the mouth at rest, and opens it as the jaw drops", () => {
    // The default figure's mouth, between the lips and behind them; its deep
    // part is what the closed lips enclose.
    const [lo, hi] = [
      [-0.03, 0.645, 0.1],
      [0.03, 0.685, 0.16],
    ] as [number[], number[]];
    const inMouth = [...sparse.vertices].filter((v) =>
      at(v).every((x, k) => x >= (lo[k] as number) && x <= (hi[k] as number)),
    );
    const deep = inMouth.filter((v) => value(v, 0) < 0.3);
    expect(deep.length).toBeGreaterThan(30);
    const mean = (corner: number) => deep.reduce((s, v) => s + value(v, corner), 0) / deep.length;
    expect(mean(0)).toBeLessThan(0.25);
    // Corner 1 is the jaw open (JawDrop at 1): the cavity sees out.
    expect(mean(1)).toBeGreaterThan(mean(0) + 0.4);
  });

  it("darkens the nostrils and the ear canals", () => {
    const within = (lo: number[], hi: number[]) =>
      [...sparse.vertices].filter((v) =>
        at(v).every((x, k) => x >= (lo[k] as number) && x <= (hi[k] as number)),
      );
    // The default figure's nostrils and ear canals, left and right.
    for (const [lo, hi] of [
      [
        [0.006, 0.69, 0.14],
        [0.016, 0.7, 0.155],
      ],
      [
        [-0.016, 0.69, 0.14],
        [-0.006, 0.7, 0.155],
      ],
      [
        [0.06, 0.7, 0.035],
        [0.08, 0.72, 0.06],
      ],
      [
        [-0.08, 0.7, 0.035],
        [-0.06, 0.72, 0.06],
      ],
    ] as [number[], number[]][]) {
      const vs = within(lo, hi);
      expect(vs.length, `${lo} .. ${hi}`).toBeGreaterThan(4);
      expect(Math.min(...vs.map((v) => value(v, 0)))).toBeLessThan(0.5);
    }
  });

  it("leaves the skin it does not store open at every corner", () => {
    const stored = new Set(sparse.vertices);
    const probe = assets.manifest.skeleton.joints["foot.L____head"] as number[];
    expect(stored.has(probe[0] as number)).toBe(false);
    expect(value(probe[0] as number, 3)).toBe(1);
  });
});

describe("the topology's body occlusion", () => {
  it("is one byte per corner per render vertex: open off the cavity, dark inside the mouth", () => {
    const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
    const { body } = model.topology();
    expect(body.occlusion).toBeInstanceOf(Uint8Array);
    expect(body.occlusion.length).toBe(body.vertexCount * CORNERS);
    let open = 0;
    let dark = 0;
    for (let v = 0; v < body.vertexCount; v++) {
      const rest = body.occlusion[v * CORNERS] as number;
      if (rest === 255) open++;
      if (rest < 60) dark++;
    }
    expect(open).toBeGreaterThan(body.vertexCount * 0.8);
    expect(dark).toBeGreaterThan(100);
  });

  it("carries each stored corner to the render vertices, whatever the corner", () => {
    // At level 0 the render vertices are the base vertices split at UV seams, so
    // each carries exactly its base vertex's bytes. A base vertex's index is read
    // back through `renderFeatures` (a byte of it at a time).
    const assets = loadFixtureAssets();
    const sparse = assets.bodyOcclusion as BodyOcclusion;
    const model = new HumanoidModel(assets, { subdivision: 0 });
    const { body } = model.topology();
    const base = assets.manifest.vertexCount;
    const low = model.renderFeatures(Uint8Array.from({ length: base }, (_, v) => v & 255)).body;
    const high = model.renderFeatures(Uint8Array.from({ length: base }, (_, v) => v >> 8)).body;
    const expected = Array.from({ length: CORNERS }, (_, c) =>
      expandBodyOcclusion(sparse, base, c),
    );
    for (let r = 0; r < body.vertexCount; r++) {
      const v = ((high[r] as number) << 8) | (low[r] as number);
      for (let c = 0; c < CORNERS; c++)
        if (body.occlusion[r * CORNERS + c] !== Math.round((expected[c]?.[v] as number) * 255))
          expect.fail(`render vertex ${r} (base ${v}) at corner ${c}`);
    }
  });

  it("refuses a pack whose body occlusion was baked at other keys than the code's", () => {
    const entry = {
      ...(bodyManifest.bodyOcclusion as BodyOcclusionEntry),
      keys: ["jawOpen"],
      count: 0,
    };
    const assets = parseHumanoidAssets({
      ...bodyPackData(),
      manifest: { ...bodyManifest, bodyOcclusion: entry },
      bodyOcclusion: new ArrayBuffer(0),
    });
    expect(() => new HumanoidModel(assets)).toThrow(/baked at keys jawOpen/);
  });

  it("is all open for a pack that predates it", () => {
    const old = { ...bodyManifest } as BodyManifest;
    delete old.bodyOcclusion;
    const assets = parseHumanoidAssets({ ...bodyPackData(), manifest: old });
    expect(assets.bodyOcclusion).toBeNull();
    const { body } = new HumanoidModel(assets, { subdivision: 0 }).topology();
    expect(body.occlusion.length).toBe(body.vertexCount * CORNERS);
    expect(body.occlusion.every((v) => v === 255)).toBe(true);
  });
});
