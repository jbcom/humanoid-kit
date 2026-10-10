/**
 * Detail and surface skin layers on the GPU (src/surface/layers.ts): relief
 * drawn at true scale from the layer's fields, faded where it is finer than a
 * pixel, and surface layers changing roughness and specular exactly as the
 * material's own parameters would.
 */
import { DataUtils } from "three";
import { afterAll, describe, expect, it } from "vitest";
import {
  creaseHeight,
  lineRelief,
  type SkinLayer,
  STOP_COUNT,
  swellHeight,
} from "../../src/surface/layers.ts";
import {
  orientationAtCoordinate,
  orientationCoordinate,
  ridgeHeight,
  ridgeOrientation,
  ridgeOrientationCoordinate,
} from "../../src/surface/ridges.ts";
import {
  STRIA_RELIEF_SOFT,
  STRIAE_ORIENTATION_SEAM,
  STRIAE_RELIEF_FADE,
  striaeDetail,
  striaeMeanCover,
  striaeWeight,
  striaMark,
} from "../../src/surface/striae.ts";
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

  it("shades a colour layer's line by the slope of its relief and leaves its colour alone", () => {
    // A multiply layer whose stops are all 1 (no colour change) and whose relief cuts a groove
    // at stop 3 (`SkinLayerPaint.relief`): the shading must be the reference's slope, and with
    // no relief the layer must render exactly as a layer with no relief at all.
    const depths = Array.from({ length: STOP_COUNT }, (_, k) => (k === 3 ? 0.004 : 0));
    const line = (relief?: number[]): SkinLayer => ({
      id: "line",
      blend: "multiply",
      targets: [],
      fields: noFields,
      paint: () => ({
        strength: 1,
        stops: Array.from({ length: STOP_COUNT }, () => [1, 1, 1] as [number, number, number]),
        ...(relief && { relief }),
      }),
    });
    const flat = render([]);
    expect(render([line()])).toEqual(flat);
    const cut = render([line(depths)]);
    const change = Array.from(
      { length: SIZE },
      (_, x) => (cut[(SIZE / 2) * SIZE + x] as number) - (flat[(SIZE / 2) * SIZE + x] as number),
    );
    // The plane is 2 m across and its coordinate runs 0..1 along it.
    const slope = Array.from({ length: SIZE }, (_, x) => {
      const c = (x + 0.5) / SIZE;
      const e = 1e-4;
      return (lineRelief(depths, c + e) - lineRelief(depths, c - e)) / (2 * e * 2);
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
    expect(energy).toBeGreaterThan(0);
    expect(Math.sqrt(residual / energy)).toBeLessThan(0.15);
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

describe("profiled detail layers", () => {
  // Bumps 2 mm apart, seen 4 cm across: twenty cells over the 128 px, about 6 px each.
  const view = { span: 0.04, centre: [0, 0] as [number, number] };
  const profiled = (profile: number[]): SkinLayer => ({
    id: "profiled",
    kind: "detail",
    pattern: "bumps",
    profiled: true,
    targets: [],
    fields: noFields,
    paint: () => ({ strength: 1, height: 0.0004, size: 0.002, profile }),
  });
  const tubercles = (occupancy: number, limit = 1): SkinLayer => ({
    id: "tubercles",
    kind: "detail",
    pattern: "tubercles",
    targets: [],
    fields: noFields,
    paint: () => ({ strength: 1, height: 0.0004, size: 0.002, profile: [occupancy], limit }),
  });
  /** A constant coordinate: the profile is read at that point of it. */
  const at = (c: number) => ({ view, coordinate: () => c });

  it("scales the bumps by the profile at the coordinate", () => {
    const layer = profiled([0, 1]);
    const none = variance(render([], at(0)));
    const low = variance(render([layer], at(0)));
    const half = variance(render([layer], at(0.5)));
    const full = variance(render([layer], at(1)));
    expect(low).toBeLessThan(10 * Math.max(none, 1e-8));
    expect(full).toBeGreaterThan(100 * Math.max(none, 1e-8));
    // The shading's variance goes with the square of the relief's height.
    expect(half / full).toBeGreaterThan(0.1);
    expect(half / full).toBeLessThan(0.5);
  });

  it("raises a tubercle in the share of cells the occupancy gives", () => {
    const flat = variance(render([], at(0)));
    expect(variance(render([tubercles(0)], at(0)))).toBeLessThan(10 * Math.max(flat, 1e-8));
    const full = variance(render([tubercles(1)], at(0)));
    expect(full).toBeGreaterThan(100 * Math.max(flat, 1e-8));
    // Each cell is raised independently, so the variance goes with the share of cells.
    const half = variance(render([tubercles(0.5)], at(0)));
    expect(half / full).toBeGreaterThan(0.3);
    expect(half / full).toBeLessThan(0.7);
    const sparse = variance(render([tubercles(0.1)], at(0)));
    expect(sparse / full).toBeGreaterThan(0.03);
    expect(sparse / full).toBeLessThan(0.25);
  });

  it("is the same relief at the same occupancy: deterministic, not shimmering", () => {
    expect(Array.from(render([tubercles(0.4)], at(0)))).toEqual(
      Array.from(render([tubercles(0.4)], at(0))),
    );
  });

  it("draws no bump whose centre is past the limit, and none cut by it: each is whole or absent", () => {
    // The coordinate runs along u (0.5 at the view's middle column), the limit at 0.5. A bump's
    // radius is 0.35 of a 2 mm cell, 0.7 mm: 2.2 of the view's 0.31 mm pixels.
    const limited = tubercles(1, 0.5);
    // A 4 cm plane seen whole: the coordinate runs 0..1 across it, so the atlas's 8-bit
    // coordinate places the limit to a sixth of a millimetre, as it does across an areola.
    const small = { plane: 0.04 };
    const flat = render([], small);
    const got = render([limited], small);
    const unlimited = render([tubercles(1)], small);
    let past = 0;
    let before = 0;
    let neither = 0;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        const g = got[i] as number;
        const d = Math.abs(g - (flat[i] as number));
        // Past the limit by more than a bump's radius: flat.
        if (x >= SIZE / 2 + 3) past = Math.max(past, d);
        else if (x < SIZE / 2 - 12) before = Math.max(before, d);
        // Everywhere, a pixel is the unlimited layer's bump or the flat skin: never a cut bump.
        if (d > 1e-4 && Math.abs(g - (unlimited[i] as number)) > 1e-4) neither++;
      }
    expect(past).toBeLessThan(1e-4);
    expect(before).toBeGreaterThan(1e-3);
    // Where two bumps overlap, the one left may differ from the pair: a pixel or two.
    expect(neither).toBeLessThan(0.002 * SIZE * SIZE);
  });
});

describe("swell layers", () => {
  const PROFILE = [0, 0, 0.9, 0.8, -0.3, -0.6, 0, 0];
  const swell = (height: number, strength = 1): SkinLayer => ({
    id: "swell",
    kind: "detail",
    pattern: "swell",
    targets: [],
    fields: noFields,
    paint: () => ({ strength, height, size: 1, profile: PROFILE }),
  });

  it("raises the cross-section the reference gives: the shading follows its slope", () => {
    const flat = render([]);
    const raised = render([swell(0.05)]);
    const change = Array.from(
      { length: SIZE },
      (_, x) => (raised[(SIZE / 2) * SIZE + x] as number) - (flat[(SIZE / 2) * SIZE + x] as number),
    );
    // The plane is 2 m across and its coordinate runs 0..1 along it; the mask is 1.
    const slope = Array.from({ length: SIZE }, (_, x) => {
      const c = (x + 0.5) / SIZE;
      const e = 1e-4;
      return (
        (swellHeight(0.05, PROFILE, c + e, 1) - swellHeight(0.05, PROFILE, c - e, 1)) / (2 * e * 2)
      );
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

  it("draws nothing at no strength", () => {
    expect(Array.from(render([swell(0.05, 0)]))).toEqual(Array.from(render([])));
  });
});

describe("stretch marks", () => {
  // A mark's typical width: 3 pixels of the 2-metre square, so a pixel's footprint is under the
  // half-width at which the colour starts to blend to the mean (STRIAE_DETAIL_FADE), and a few dozen
  // clusters lie in it.
  const SPACING = 0.012;
  const PX = 512;
  // The pixel's footprint as the shader measures it, length( fwidth( p ) ) on an axis-aligned map.
  const FOOTPRINT = Math.SQRT2 * (2 / PX);
  const stria = (
    amount: number,
    ratio: [number, number, number],
    height: number,
    strength = 1,
  ): SkinLayer => ({
    id: "striae",
    kind: "detail",
    pattern: "striae",
    targets: [],
    fields: noFields,
    paint: () => ({ strength, height, size: SPACING, striae: { amount, ratio } }),
  });
  /** The orientation as the 8-bit atlas holds it, in the striae's own seam, and its angle. */
  const stored = Math.round(orientationCoordinate(1, STRIAE_ORIENTATION_SEAM) * 255) / 255;
  const theta = orientationAtCoordinate(stored, STRIAE_ORIENTATION_SEAM);
  const coordinate = () => stored;

  it("darkens the skin exactly where the reference has a mark", () => {
    const flat = render([], { size: PX });
    const cut = render([stria(1, [0.4, 0.4, 0.4], 0)], { size: PX, coordinate });
    const marks: number[] = [];
    const got: number[] = [];
    for (let y = 2; y < PX - 2; y += 3)
      for (let x = 2; x < PX - 2; x += 3) {
        const px = ((x + 0.5) / PX) * 2;
        const py = ((y + 0.5) / PX) * 2;
        marks.push(striaeWeight(px, py, theta, SPACING, 1, 1, FOOTPRINT));
        got.push((cut[y * PX + x] as number) / (flat[y * PX + x] as number));
      }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const [mm, mg] = [mean(marks), mean(got)];
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    marks.forEach((m, i) => {
      sxy += (m - mm) * ((got[i] as number) - mg);
      sxx += (m - mm) ** 2;
      syy += ((got[i] as number) - mg) ** 2;
    });
    // A tenth or more of the skin is marked, and the shading falls with the mark's weight, in
    // proportion (what the multiply leaves is the surface's own specular and ambient light).
    expect(marks.filter((m) => m > 0.5).length).toBeGreaterThan(0.02 * marks.length);
    expect(sxy / Math.sqrt(sxx * syy)).toBeLessThan(-0.98);
    // At full weight the colour has gone to about the ratio: well under the skin's.
    const full = got.filter((_, i) => (marks[i] as number) > 0.99);
    expect(mean(full)).toBeLessThan(0.6);
    // Away from any mark, the skin as it was (a sample at a mark's very edge may differ by a
    // rounding in where the edge lies).
    const none = got.filter((_, i) => (marks[i] as number) === 0);
    expect(none.filter((g) => g < 0.99).length / none.length).toBeLessThan(0.02);
  });

  it("sinks the marks: the shading follows the slope of a dip", () => {
    const flat = render([], { size: PX });
    // A millimetre deep, so the slopes stay within the range the shading answers linearly.
    const cut = render([stria(1, [1, 1, 1], 0.001)], { size: PX, coordinate });
    const change: number[] = [];
    const slope: number[] = [];
    // The relief's share of the marks at this footprint, and its softer edges.
    const shown = striaeDetail(FOOTPRINT / SPACING, STRIAE_RELIEF_FADE);
    for (let y = 8; y < PX - 8; y += 32) {
      // The dip's depth at a pixel.
      const depth = (x: number) =>
        -0.001 *
        shown *
        striaMark(
          ((x + 0.5) / PX) * 2,
          ((y + 0.5) / PX) * 2,
          theta,
          SPACING,
          1,
          FOOTPRINT,
          STRIA_RELIEF_SOFT,
        );
      for (let x = 2; x < PX - 2; x++) {
        change.push((cut[y * PX + x] as number) - (flat[y * PX + x] as number));
        // The shader's slope is a derivative over the pixel's 2 x 2 block, taken from its left
        // pixel to its right: a mark's edge is about a pixel wide, so the sampled slope is what to
        // expect.
        const left = x - (x % 2);
        slope.push((depth(left + 1) - depth(left)) / (2 / PX));
      }
    }
    expect(slope.filter((s) => s !== 0).length).toBeGreaterThan(100);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    change.forEach((c, i) => {
      sxy += c * (slope[i] as number);
      sxx += (slope[i] as number) ** 2;
      syy += c * c;
    });
    expect(sxy / Math.sqrt(sxx * syy)).toBeLessThan(-0.9);
  });

  it("marks more of the skin the greater the amount, and none at none or at no strength", () => {
    const flat = render([], { size: PX });
    const dark = (amount: number, strength = 1) =>
      variance(render([stria(amount, [0.4, 0.4, 0.4], 0, strength)], { size: PX, coordinate }));
    const base = Math.max(variance(flat), 1e-8);
    expect(dark(0)).toBeLessThan(10 * base);
    expect(dark(0.7, 0)).toBeLessThan(10 * base);
    expect(dark(0.4)).toBeGreaterThan(dark(0.15));
    expect(dark(1)).toBeGreaterThan(dark(0.4));
  });

  it("blends marks finer than a pixel to their mean cover: no shimmer, and the same colour on average", () => {
    const flat = render([], { size: PX });
    const coarse = render([stria(0.7, [0.4, 0.4, 0.4], 0)], { size: PX, coordinate });
    const fineLayer: SkinLayer = {
      id: "striae",
      kind: "detail",
      pattern: "striae",
      targets: [],
      fields: noFields,
      paint: () => ({
        strength: 1,
        height: 0,
        size: 0.0003,
        striae: { amount: 0.7, ratio: [0.4, 0.4, 0.4] as [number, number, number] },
      }),
    };
    const fine = render([fineLayer], { size: PX, coordinate });
    expect(variance(fine)).toBeLessThan(variance(coarse) / 50);
    // Each pixel is the skin multiplied toward the ratio by the marks' mean cover.
    const darkening = 1 - fine.reduce((s, v, i) => s + v / (flat[i] as number), 0) / fine.length;
    const expected = (1 - 0.4) * striaeMeanCover(0.7);
    expect(darkening).toBeGreaterThan(0.8 * expected);
    expect(darkening).toBeLessThan(1.2 * expected);
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
