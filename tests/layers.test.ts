import { describe, expect, it } from "vitest";
import {
  applyLayers,
  buildLayerFields,
  paintStopTable,
  type SkinLayer,
  type SkinPaintInput,
  STOP_COUNT,
  STOP_TABLE_WIDTH,
} from "../src/surface/layers.ts";
import { SKIN_LAYER_TARGETS, SKIN_LAYERS } from "../src/surface/regions/index.ts";
import { areolaAlbedo, lipAlbedo, type Rgb } from "../src/surface/skinTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const input = (over: Partial<SkinPaintInput> = {}): SkinPaintInput => ({
  tone: { melanin: 0.6, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0.4,
  lips: 0.5,
  areola: 0.5,
  signals: {},
  ...over,
});

describe("the rest layers' fields", () => {
  const assets = loadFixtureAssets();
  const n = assets.manifest.vertexCount;
  const fields = buildLayerFields(assets, SKIN_LAYERS);
  const P = assets.positions;
  const strong = (id: string) => {
    const l = SKIN_LAYERS.findIndex((x) => x.id === id);
    const ys: number[] = [];
    const xs: number[] = [];
    for (let v = 0; v < n; v++) {
      if ((fields[(l * n + v) * 3] as number) > 0.8) {
        xs.push(P[v * 3] as number);
        ys.push(P[v * 3 + 1] as number);
      }
    }
    return {
      count: ys.length,
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      maxAbsX: Math.max(...xs.map(Math.abs)),
    };
  };

  it("find the lips at the mouth and nowhere else", () => {
    const lips = strong("lips");
    expect(lips.count).toBeGreaterThan(20);
    // The mouth sits roughly 0.62–0.66 m above the base mesh origin and is narrow.
    expect(lips.minY).toBeGreaterThan(0.6);
    expect(lips.maxY).toBeLessThan(0.68);
    expect(lips.maxAbsX).toBeLessThan(0.04);
  });

  it("find nipples and areolae on the chest, one each side", () => {
    const areola = strong("areola");
    expect(areola.count).toBeGreaterThan(10);
    expect(areola.minY).toBeGreaterThan(0.3);
    expect(areola.maxY).toBeLessThan(0.5);
    expect(areola.maxAbsX).toBeGreaterThan(0.05);
  });

  it("keep every value in [0, 1] and name every target they need", () => {
    for (const v of fields) expect(v >= 0 && v <= 1).toBe(true);
    for (const t of SKIN_LAYER_TARGETS) expect(assets.targets.has(t), t).toBe(true);
  });

  it("reject a field of the wrong length", () => {
    const bad: SkinLayer = {
      id: "bad",
      blend: "mix",
      targets: [],
      fields: () => ({ mask: new Float32Array(3), coord: null }),
      paint: () => ({ strength: 1, stops: [[0, 0, 0]] }),
    };
    expect(() => buildLayerFields(assets, [bad])).toThrow(/one value per vertex/);
  });
});

describe("the stop table", () => {
  it("paints the rest layers with the measured lip and areola models", () => {
    const i = input();
    const table = paintStopTable(SKIN_LAYERS, i);
    expect(table.length).toBe(SKIN_LAYERS.length * STOP_TABLE_WIDTH * 4);
    const row = (id: string) => SKIN_LAYERS.findIndex((l) => l.id === id) * STOP_TABLE_WIDTH * 4;
    const stop = (id: string, k: number) =>
      Array.from(table.slice(row(id) + (k + 1) * 4, row(id) + (k + 1) * 4 + 3));
    // One colour, so every stop carries it.
    const close = (got: number[], want: Rgb) => {
      for (let j = 0; j < 3; j++) expect(got[j]).toBeCloseTo(want[j] as number, 6);
    };
    for (const k of [0, STOP_COUNT - 1]) {
      close(stop("lips", k), lipAlbedo(i.tone, i.lips));
      close(stop("areola", k), areolaAlbedo(i.tone, i.areola));
    }
    expect(table[row("flush")]).toBeCloseTo(0.4, 6);
    expect(table[row("flush") + 1]).toBe(1); // multiply
    expect(table[row("lips") + 1]).toBe(0); // mix
  });

  it("resamples a gradient's stops evenly along the coordinate", () => {
    const ramp: SkinLayer = {
      id: "ramp",
      blend: "mix",
      targets: [],
      fields: () => ({ mask: new Float32Array(0), coord: null }),
      paint: () => ({
        strength: 1,
        stops: [
          [0, 0, 0],
          [1, 1, 1],
        ],
      }),
    };
    const table = paintStopTable([ramp], input());
    for (let k = 0; k < STOP_COUNT; k++)
      expect(table[(k + 1) * 4]).toBeCloseTo(k / (STOP_COUNT - 1), 6);
    expect(() =>
      paintStopTable([{ ...ramp, paint: () => ({ strength: 1, stops: [] }) }], input()),
    ).toThrow(/1 to 8 stops/);
  });
});

describe("applyLayers", () => {
  it("reproduces the fixed three-channel blend it replaces", () => {
    const i = input({ flush: 0.7 });
    const table = paintStopTable(SKIN_LAYERS, i);
    const base: Rgb = [0.3, 0.15, 0.1];
    const lip = lipAlbedo(i.tone, i.lips);
    const areola = areolaAlbedo(i.tone, i.areola);
    const tint: Rgb = [1.1, 0.84, 0.84];
    const mix = (a: number, b: number, t: number) => a + (b - a) * t;
    const [mf, ml, ma] = [0.5, 0.3, 0.2];
    // The old shader: flush tint, then lips, then areola, at strengths (flush, 0.9, 0.9).
    const expected = base.map((c, k) => {
      let x = mix(c, c * (tint[k] as number), mf * 0.7);
      x = mix(x, lip[k] as number, ml * 0.9);
      return mix(x, areola[k] as number, ma * 0.9);
    });
    const got = applyLayers(base, table, [
      [mf, 0],
      [ml, 0],
      [ma, 0],
    ]);
    for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(expected[k] as number, 6);
  });

  it("leaves the skin untouched where every mask is zero", () => {
    const table = paintStopTable(SKIN_LAYERS, input({ flush: 1 }));
    expect(
      applyLayers([0.2, 0.1, 0.05], table, [
        [0, 0],
        [0, 1],
        [0, 0.5],
      ]),
    ).toEqual([0.2, 0.1, 0.05]);
  });
});
