import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deltaE2000, type Lab, labFromLinear, labFromSrgb8 } from "../e2e/lib/colour.ts";

const pairs = fs
  .readFileSync(path.join(import.meta.dirname, "fixtures/ciede2000-sharma.txt"), "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => l.trim().split(/\s+/).map(Number));

describe("CIEDE2000", () => {
  it("reproduces all 34 of Sharma, Wu & Dalal's published test pairs to 4 decimals", () => {
    expect(pairs.length).toBe(34);
    for (const [L1, a1, b1, L2, a2, b2, want] of pairs as number[][]) {
      const lab1: Lab = [L1 as number, a1 as number, b1 as number];
      const lab2: Lab = [L2 as number, a2 as number, b2 as number];
      expect(deltaE2000(lab1, lab2)).toBeCloseTo(want as number, 4);
      // Symmetric, as the formula is.
      expect(deltaE2000(lab2, lab1)).toBeCloseTo(want as number, 4);
    }
  });

  it("is zero for identical colours", () => {
    expect(deltaE2000([50, 10, -20], [50, 10, -20])).toBe(0);
  });
});

describe("CIELAB conversion", () => {
  it("maps sRGB white, black and linear mid-grey to their known values", () => {
    const white = labFromSrgb8(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(Math.hypot(white[1], white[2])).toBeLessThan(0.5);
    expect(labFromSrgb8(0, 0, 0)[0]).toBeCloseTo(0, 5);
    // 18% grey reflectance has L* ≈ 49.5.
    expect(labFromLinear([0.18, 0.18, 0.18])[0]).toBeCloseTo(49.5, 0);
  });
});
