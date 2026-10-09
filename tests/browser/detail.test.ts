/**
 * Detail and surface skin layers on the GPU (src/surface/layers.ts): relief
 * drawn at true scale from the layer's fields, faded where it is finer than a
 * pixel, and surface layers changing roughness and specular exactly as the
 * material's own parameters would.
 */
import { DataUtils } from "three";
import { afterAll, describe, expect, it } from "vitest";
import { creaseHeight, type SkinLayer } from "../../src/surface/layers.ts";
import {
  disposeLayerRender,
  mean,
  noFields,
  renderLayers as render,
  SIZE,
  variance,
} from "./layerRender.ts";

afterAll(disposeLayerRender);

describe("detail layers", () => {
  const creases = (height: number, size: number): SkinLayer => ({
    id: "creases",
    kind: "detail",
    pattern: "creases",
    targets: [],
    fields: noFields,
    paint: () => ({ strength: 1, height, size }),
  });
  const bumps = (height: number, size: number): SkinLayer => ({
    id: "bumps",
    kind: "detail",
    pattern: "bumps",
    targets: [],
    fields: noFields,
    paint: () => ({ strength: 1, height, size }),
  });

  it("ripples the shading across the coordinate, as many creases as asked", () => {
    const flat = render([]);
    const rippled = render([creases(0.01, 8)]);
    // Along the middle row, the shading rises and falls once per crease.
    const row = Array.from(
      { length: SIZE },
      (_, x) =>
        (rippled[(SIZE / 2) * SIZE + x] as number) - (flat[(SIZE / 2) * SIZE + x] as number),
    );
    let crossings = 0;
    for (let x = 1; x < SIZE; x++)
      if (Math.sign(row[x] as number) !== Math.sign(row[x - 1] as number)) crossings++;
    // Two sign changes per period of the slope.
    expect(crossings).toBeGreaterThanOrEqual(14);
    expect(crossings).toBeLessThanOrEqual(18);
    expect(variance(flat)).toBeLessThan(1e-6);
  });

  it("cuts each crease with the profile the reference gives: the shading follows its slope", () => {
    // Light along x makes the shading change proportional to the relief's slope
    // along x, so the rendered change must be the reference's derivative, scaled.
    const flat = render([]);
    const cut = render([creases(0.004, 2)]);
    const change = Array.from(
      { length: SIZE },
      (_, x) => (cut[(SIZE / 2) * SIZE + x] as number) - (flat[(SIZE / 2) * SIZE + x] as number),
    );
    // The plane is 2 m across and its coordinate runs 0..1 along it.
    const slope = Array.from({ length: SIZE }, (_, x) => {
      const c = (x + 0.5) / SIZE;
      const e = 1e-4;
      return (creaseHeight(0.004, 2, c + e) - creaseHeight(0.004, 2, c - e)) / (2 * e * 2);
    });
    let sxy = 0;
    let sxx = 0;
    for (let x = 0; x < SIZE; x++) {
      sxy += (slope[x] as number) * (change[x] as number);
      sxx += (slope[x] as number) ** 2;
    }
    const scale = sxy / sxx;
    let residual = 0;
    let energy = 0;
    for (let x = 0; x < SIZE; x++) {
      residual += ((change[x] as number) - scale * (slope[x] as number)) ** 2;
      energy += (change[x] as number) ** 2;
    }
    // Light from +x: where the relief rises along x it faces away, and darkens.
    expect(scale).toBeLessThan(0);
    expect(Math.sqrt(residual / energy)).toBeLessThan(0.12);
  });

  it("draws nothing for a layer with no strength, as for none at all", () => {
    const off = (pattern: "bumps" | "creases"): SkinLayer => ({
      id: "off",
      kind: "detail",
      pattern,
      targets: [],
      fields: noFields,
      paint: () => ({ strength: 0, height: 0.01, size: pattern === "bumps" ? 0.1 : 8 }),
    });
    const none = render([]);
    for (const pattern of ["bumps", "creases"] as const)
      expect(render([off(pattern)])).toEqual(none);
  });

  it("raises bumps at their true size, and fades them where they are finer than a pixel", () => {
    // 2 m across at 0.1 m spacing: 20 bumps over 128 px, about 6 px each.
    const coarse = render([bumps(0.01, 0.1)]);
    // At 2 mm spacing, a thousand bumps across 128 px: fade to flat, no shimmer.
    const fine = render([bumps(0.01, 0.002)]);
    const none = render([]);
    expect(variance(coarse)).toBeGreaterThan(100 * Math.max(variance(none), 1e-8));
    expect(variance(fine)).toBeLessThan(variance(coarse) / 50);
  });
});

describe("surface layers", () => {
  const surface = (roughness: number, specular: number): SkinLayer => ({
    id: "sheen",
    kind: "surface",
    targets: [],
    fields: noFields,
    paint: () => ({ strength: 1, roughness, specular }),
  });
  // A light mirrored to the camera, so the highlight fills the frame.
  const glancing: [number, number, number] = [0, 0, 1];

  it("lowers roughness exactly as the material's own roughness would", () => {
    const layered = render([surface(-0.3, 0)], { light: glancing });
    // The stop table is half-float (mobile GPUs filter it linearly), so the
    // change arrives as the nearest half; the reference uses the same value.
    const change = DataUtils.fromHalfFloat(DataUtils.toHalfFloat(-0.3));
    const direct = render([], { light: glancing, tune: (m) => (m.roughness = 0.52 + change) });
    let worst = 0;
    for (let i = 0; i < layered.length; i++)
      worst = Math.max(worst, Math.abs((layered[i] as number) - (direct[i] as number)));
    expect(worst).toBeLessThan(1e-3);
  });

  it("strengthens the specular reflection with a positive specular change", () => {
    const plain = mean(render([surface(0, 0)], { light: glancing }));
    const wet = mean(render([surface(0, 0.8)], { light: glancing }));
    expect(wet).toBeGreaterThan(plain * 1.02);
  });
});
