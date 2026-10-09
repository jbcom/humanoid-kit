import { describe, expect, it } from "vitest";
import {
  RIDGE_CELL_PERIODS,
  RIDGE_ORIENTATION_SEAM,
  ridgeHeight,
  ridgeOrientation,
  ridgeOrientationCoordinate,
} from "../src/surface/ridges.ts";

const SPACING = 0.00045;

/** Samples the relief on a grid of `n` × `n` points, `step` metres apart. */
function sample(theta: number, n: number, step: number, origin: [number, number] = [0, 0]) {
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      out[j * n + i] = ridgeHeight(origin[0] + i * step, origin[1] + j * step, theta, SPACING);
  return out;
}

describe("friction ridge relief", () => {
  it("is a height between 0 and 1, deterministic, and neither flat nor saturated", () => {
    const a = sample(0.3, 64, SPACING / 8);
    const b = sample(0.3, 64, SPACING / 8);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.65);
    const variance = a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length;
    expect(variance).toBeGreaterThan(0.02);
  });

  it("repeats across the ridges at their spacing and runs on along them", () => {
    // Wave direction along +x (theta 0): the pattern varies fastest along x, with
    // a period near the spacing, and slowly along y.
    const n = 160;
    const step = SPACING / 10;
    const field = sample(0, n, step);
    const mean = field.reduce((s, x) => s + x, 0) / field.length;
    const autocorr = (dx: number, dy: number) => {
      let s = 0;
      let c = 0;
      for (let j = 0; j < n - dy; j++)
        for (let i = 0; i < n - dx; i++) {
          s +=
            ((field[j * n + i] as number) - mean) *
            ((field[(j + dy) * n + i + dx] as number) - mean);
          c++;
        }
      return s / c;
    };
    const zero = autocorr(0, 0);
    // One spacing across: strongly correlated; half a spacing across: anti-correlated.
    expect(autocorr(10, 0) / zero).toBeGreaterThan(0.5);
    expect(autocorr(5, 0) / zero).toBeLessThan(-0.3);
    // Along the ridge (y), a spacing or two on: still strongly correlated.
    expect(autocorr(0, 20) / zero).toBeGreaterThan(0.5);
  });

  it("turns with its orientation", () => {
    // The same field rotated a quarter turn: ridges now vary fastest along y.
    const n = 128;
    const step = SPACING / 10;
    const rotated = sample(Math.PI / 2, n, step);
    const mean = rotated.reduce((s, x) => s + x, 0) / rotated.length;
    let across = 0;
    let along = 0;
    for (let j = 1; j < n; j++)
      for (let i = 1; i < n; i++) {
        const v = rotated[j * n + i] as number;
        across += (v - (rotated[(j - 1) * n + i] as number)) ** 2;
        along += (v - (rotated[j * n + i - 1] as number)) ** 2;
      }
    // Varies by far more from row to row (y) than along a row (x).
    expect(across).toBeGreaterThan(3 * along);
    expect(mean).toBeGreaterThan(0.3);
  });

  it("is not tiled: a cell's worth of ridges away looks different", () => {
    const cell = RIDGE_CELL_PERIODS * SPACING;
    const a = sample(0, 48, SPACING / 8, [0, 0]);
    const b = sample(0, 48, SPACING / 8, [cell, 0]);
    let same = 0;
    for (let i = 0; i < a.length; i++)
      if (Math.abs((a[i] as number) - (b[i] as number)) < 0.02) same++;
    expect(same / a.length).toBeLessThan(0.5);
  });
});

describe("the ridge orientation coordinate", () => {
  it("round-trips an angle modulo a half turn, in 0..1", () => {
    for (const theta of [0, 0.3, 1.2, Math.PI / 2, 2.4, Math.PI - 0.01, -0.7, 4.2]) {
      const c = ridgeOrientationCoordinate(theta);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(1);
      const d = (((ridgeOrientation(c) - theta) % Math.PI) + Math.PI) % Math.PI;
      expect(Math.min(d, Math.PI - d)).toBeLessThan(1e-9);
    }
  });

  it("wraps at the seam and nowhere else", () => {
    // Just either side of the seam the coordinate jumps from near 1 to near 0; elsewhere it is continuous.
    const eps = 0.01;
    expect(ridgeOrientationCoordinate(RIDGE_ORIENTATION_SEAM + eps)).toBeLessThan(0.05);
    expect(ridgeOrientationCoordinate(RIDGE_ORIENTATION_SEAM - eps)).toBeGreaterThan(0.95);
    for (
      let t = RIDGE_ORIENTATION_SEAM + 0.05;
      t < RIDGE_ORIENTATION_SEAM + Math.PI - 0.05;
      t += 0.05
    )
      expect(
        Math.abs(ridgeOrientationCoordinate(t + 0.05) - ridgeOrientationCoordinate(t)),
      ).toBeLessThan(0.02);
  });
});
