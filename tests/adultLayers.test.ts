import { describe, expect, it, vi } from "vitest";
import {
  applyLayers,
  isAdultLayer,
  paintStopTable,
  type SkinLayer,
  type SkinPaintInput,
  STOP_TABLE_WIDTH,
} from "../src/surface/layers.ts";

const input = (over: Partial<SkinPaintInput> = {}): SkinPaintInput => ({
  tone: { melanin: 0.6, haemoglobin: 0.5, undertone: 0, override: null },
  flush: 0.4,
  lips: 0.5,
  areola: 0.5,
  signals: {},
  ...over,
});

const none = () => ({ mask: new Float32Array(0), coord: null });

describe("adult layers are gated centrally in the stop table", () => {
  const colour = (
    paint = vi.fn(() => ({
      strength: 0.8,
      stops: [[0.5, 0.2, 0.1]] as [number, number, number][],
    })),
  ) => ({
    paint,
    layer: {
      id: "penis-test",
      adult: { feature: "penis" },
      blend: "mix",
      targets: [],
      fields: none,
      paint,
    } satisfies SkinLayer,
  });
  const row = (table: Float32Array) => Array.from(table.slice(0, 4));

  it("paint nothing under 18, whatever the anatomy and signals say, and never ask the layer", () => {
    const { layer, paint } = colour();
    for (const adult of [false, undefined]) {
      const table = paintStopTable(
        [layer],
        input({ adult, anatomy: { penis: 1 }, signals: { arousal: 1 } } as Partial<SkinPaintInput>),
      );
      expect(row(table)[0]).toBe(0);
      expect(table.slice(4).every((x) => x === 0)).toBe(true);
    }
    expect(paint).not.toHaveBeenCalled();
    // The coloured pixel is the skin's own.
    expect(
      applyLayers([0.3, 0.2, 0.1], paintStopTable([layer], input({ anatomy: { penis: 1 } })), [
        [1, 0],
      ]),
    ).toEqual([0.3, 0.2, 0.1]);
  });

  it("paint nothing for an adult whose recipe does not apply the layer's anatomy", () => {
    const { layer, paint } = colour();
    for (const anatomy of [undefined, {}, { testes: 1 }, { penis: 0 }]) {
      const table = paintStopTable([layer], input({ adult: true, ...(anatomy && { anatomy }) }));
      expect(row(table)[0]).toBe(0);
    }
    expect(paint).not.toHaveBeenCalled();
  });

  it("paint for an adult whose recipe applies it, scaled by how much of it is present", () => {
    const { layer } = colour();
    expect(
      row(paintStopTable([layer], input({ adult: true, anatomy: { penis: 1 } })))[0],
    ).toBeCloseTo(0.8, 6);
    expect(
      row(paintStopTable([layer], input({ adult: true, anatomy: { penis: 0.25 } })))[0],
    ).toBeCloseTo(0.2, 6);
    // A presence outside 0..1 is clamped, not extrapolated.
    expect(
      row(paintStopTable([layer], input({ adult: true, anatomy: { penis: 7 } })))[0],
    ).toBeCloseTo(0.8, 6);
    expect(row(paintStopTable([layer], input({ adult: true, anatomy: { penis: -1 } })))[0]).toBe(0);
  });

  it("gate detail and surface layers the same way, leaving a valid header", () => {
    const bumps: SkinLayer = {
      id: "adult-bumps",
      adult: { feature: "penis" },
      kind: "detail",
      pattern: "bumps",
      targets: [],
      fields: none,
      paint: () => ({ strength: 1, height: 0.0002, size: 0.002 }),
    };
    const sheen: SkinLayer = {
      id: "adult-sheen",
      adult: { feature: "penis" },
      kind: "surface",
      targets: [],
      fields: none,
      paint: () => ({ strength: 1, roughness: -0.2, specular: 0.2 }),
    };
    const off = paintStopTable([bumps, sheen], input({ adult: false, anatomy: { penis: 1 } }));
    const head = (t: Float32Array, l: number) =>
      Array.from(t.slice(l * STOP_TABLE_WIDTH * 4, l * STOP_TABLE_WIDTH * 4 + 4));
    expect(head(off, 0)[0]).toBe(0);
    expect(head(off, 1)[0]).toBe(0);
    // The shader divides by a detail layer's size: a gated-off row keeps it positive.
    expect(head(off, 0)[3]).toBeGreaterThan(0);
    expect(head(off, 0)[1]).toBe(2);
    expect(head(off, 1)[1]).toBe(4);
    const on = paintStopTable([bumps, sheen], input({ adult: true, anatomy: { penis: 1 } }));
    expect(head(on, 0)[0]).toBe(1);
    expect(head(on, 1)[0]).toBe(1);
  });

  it("leave body layers alone: no age or anatomy input changes their paint", () => {
    const body: SkinLayer = {
      id: "body-tint",
      blend: "mix",
      targets: [],
      fields: none,
      paint: () => ({ strength: 0.5, stops: [[0.1, 0.2, 0.3]] }),
    };
    expect(isAdultLayer(body)).toBe(false);
    const a = paintStopTable([body], input());
    const b = paintStopTable([body], input({ adult: true, anatomy: { penis: 1 } }));
    const c = paintStopTable([body], input({ adult: false, anatomy: {} }));
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(c)).toEqual(Array.from(a));
    expect(a[0]).toBeCloseTo(0.5, 6);
  });

  it("keep the stop table's other layers' rows when one layer is gated off", () => {
    const { layer } = colour();
    const body: SkinLayer = {
      id: "body-tint",
      blend: "multiply",
      targets: [],
      fields: none,
      paint: () => ({ strength: 0.5, stops: [[1.1, 0.9, 0.9]] }),
    };
    const table = paintStopTable([layer, body], input({ adult: false }));
    const bodyRow = STOP_TABLE_WIDTH * 4;
    expect(table[bodyRow]).toBeCloseTo(0.5, 6);
    expect(table[bodyRow + 1]).toBe(1);
    expect(table[0]).toBe(0);
  });
});
