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
  ridgeHeight,
  ridgeOrientation,
  ridgeOrientationCoordinate,
} from "../../src/surface/ridges.ts";
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

  it("fades creases where a period is a few pixels, so a bent limb seen end-on shows no dotted ring", () => {
    // 8 creases over 128 px are 16 px each; 40 are 3 px each.
    const coarse = render([creases(0.01, 8)]);
    const fine = render([creases(0.01, 40)]);
    const none = render([]);
    expect(variance(coarse)).toBeGreaterThan(100 * Math.max(variance(none), 1e-8));
    expect(variance(fine)).toBeLessThan(variance(coarse) / 50);
  });

  it("keeps a groove from aliasing at a grazing view: its pixel variance stays under a bound", () => {
    // The same eight creases (deep, to make aliasing show), face-on (16 px each) and with the
    // plane turned 80° away, which foreshortens each to about 3 px: a groove that thin must
    // have faded to the averaged shading, not stand as a dotted line. The turned plane's own
    // shading is the baseline.
    const tilt = (80 * Math.PI) / 180;
    const faceOn = render([creases(0.04, 8)]);
    const none = render([], { tilt });
    const grazing = render([creases(0.04, 8)], { tilt });
    // The turned plane is a strip down the middle; measure over it alone.
    const half = Math.floor((SIZE / 2) * Math.cos(tilt)) - 1;
    const strip = (image: ArrayLike<number>) => {
      const values: number[] = [];
      for (let y = 0; y < SIZE; y++)
        for (let x = SIZE / 2 - half; x < SIZE / 2 + half; x++)
          values.push(image[y * SIZE + x] as number);
      return variance(Float32Array.from(values));
    };
    expect(strip(grazing) - strip(none)).toBeLessThan(variance(faceOn) / 100);
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

describe("friction ridges", () => {
  const SPACING = 0.1;
  const ridges = (height: number, spacing: number): SkinLayer[] => [
    {
      id: "ridges",
      kind: "detail",
      pattern: "ridges",
      targets: [],
      fields: noFields,
      paint: () => ({ strength: 1, height, size: spacing }),
    },
  ];
  /** Orientation `theta` held everywhere: the coordinate is a constant. */
  const coordinate = (theta: number) => () => ridgeOrientationCoordinate(theta);
  const PX = 512;

  it("cuts the ridges the reference gives: the shading follows the relief's slope", () => {
    const flat = render([], { size: PX });
    // An angle inside the coordinate's window (not 0, which it stores as a half turn: the same ridges, a different random pattern),
    // as the 8-bit atlas holds it.
    const theta = ridgeOrientation(Math.round(ridgeOrientationCoordinate(1) * 255) / 255);
    const cut = render(ridges(0.004, SPACING), { size: PX, coordinate: coordinate(1) });
    // The row a quarter of the way up: the plane is 2 m across, UV 0..1, p = uv * 2.
    const y = Math.floor(PX / 4);
    const change: number[] = [];
    const slope: number[] = [];
    for (let x = 2; x < PX - 2; x++) {
      change.push((cut[y * PX + x] as number) - (flat[y * PX + x] as number));
      const e = 1e-4;
      const px = ((x + 0.5) / PX) * 2;
      const py = ((y + 0.5) / PX) * 2;
      slope.push(
        (0.004 *
          (ridgeHeight(px + e, py, theta, SPACING) - ridgeHeight(px - e, py, theta, SPACING))) /
          (2 * e),
      );
    }
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    change.forEach((c, i) => {
      sxy += c * (slope[i] as number);
      sxx += (slope[i] as number) ** 2;
      syy += c * c;
    });
    // Light from +x: the shading falls where the relief rises along x.
    expect(sxy / Math.sqrt(sxx * syy)).toBeLessThan(-0.9);
  });

  it("turns with the stored orientation", () => {
    // The ridges' waves along y now: no shading change along x (light from +x), plenty along y.
    const flat = render([], { size: PX, light: [0, 1, 0.35] });
    const along = render(ridges(0.004, SPACING), {
      size: PX,
      light: [0, 1, 0.35],
      coordinate: coordinate(Math.PI / 2),
    });
    const across = render(ridges(0.004, SPACING), {
      size: PX,
      light: [0, 1, 0.35],
      coordinate: coordinate(0),
    });
    const energy = (a: Float32Array) => variance(a.map((v, i) => v - (flat[i] as number)));
    // Light from +y sees the slope along y: waves along y light up, waves along x do not.
    expect(energy(along)).toBeGreaterThan(10 * energy(across));
  });

  it("fades ridges finer than a pixel, as for any relief", () => {
    const coarse = render(ridges(0.004, SPACING), { size: PX, coordinate: coordinate(0) });
    // 0.45 mm ridges at a pixel of 4 mm: a flat, with no shimmer.
    const fine = render(ridges(0.0002, 0.00045), { size: PX, coordinate: coordinate(0) });
    const none = render([], { size: PX });
    expect(variance(coarse)).toBeGreaterThan(100 * Math.max(variance(none), 1e-8));
    expect(variance(fine)).toBeLessThan(variance(coarse) / 50);
  });

  it("draws nothing for a layer with no strength", () => {
    const off = ridges(0.004, SPACING).map((l) =>
      l.kind === "detail"
        ? { ...l, paint: () => ({ strength: 0, height: 0.004, size: SPACING }) }
        : l,
    );
    expect(render(off, { size: PX, coordinate: coordinate(0) })).toEqual(render([], { size: PX }));
  });
});
