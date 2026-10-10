/**
 * Half floats (src/rig/half.ts): the binary16 the fold texture holds, rounded to
 * nearest as the GPU reads it back.
 */
import { describe, expect, it } from "vitest";
import { fromHalf, toHalf } from "../src/rig/half.ts";

/** Every finite binary16 value, in increasing order of its bits within each sign. */
const finite = Array.from({ length: 0x10000 }, (_, h) => h).filter(
  (h) => ((h >>> 10) & 0x1f) !== 0x1f,
);

describe("half floats", () => {
  it("holds every finite binary16 exactly: decoded and encoded, the same bits", () => {
    for (const h of finite) {
      // -0 and +0 are both zero; every other value is its own.
      const back = toHalf(fromHalf(h));
      expect(back === h || (h === 0x8000 && back === 0x8000), `bits ${h}`).toBe(true);
    }
  });

  it("rounds a value to the nearest binary16, ties to even", () => {
    const positive = finite.filter((h) => h < 0x8000).map((h) => [h, fromHalf(h)] as const);
    // Between every two neighbours: a value just below the middle goes down, just above up, the middle to the even one.
    for (let i = 0; i + 1 < positive.length; i++) {
      const [lo, a] = positive[i] as readonly [number, number];
      const [hi, b] = positive[i + 1] as readonly [number, number];
      const middle = (a + b) / 2;
      // The middle of two binary16 values is a float32 exactly, so the tie is a real one.
      expect(Math.fround(middle)).toBe(middle);
      const below = Math.fround(middle - (b - a) / 8);
      const above = Math.fround(middle + (b - a) / 8);
      expect(toHalf(below), `below ${middle}`).toBe(lo);
      expect(toHalf(above), `above ${middle}`).toBe(hi);
      expect(toHalf(middle), `at ${middle}`).toBe(lo % 2 === 0 ? lo : hi);
    }
    expect(toHalf(-0.1)).toBe(toHalf(0.1) | 0x8000);
    // Past the largest finite (65504), infinity; far under the smallest subnormal, zero.
    expect(toHalf(70000)).toBe(0x7c00);
    expect(toHalf(1e-9)).toBe(0);
  });

  it("rounds a fold's displacements to within 2⁻¹¹ of themselves: 31 µm at 66 mm", () => {
    let worst = 0;
    for (let x = 1e-4; x < 0.1; x *= 1.0007)
      worst = Math.max(worst, Math.abs(fromHalf(toHalf(x)) - x) / x);
    expect(worst).toBeLessThanOrEqual(2 ** -11);
    expect(Math.abs(fromHalf(toHalf(0.0658)) - 0.0658)).toBeLessThan(31e-6);
  });
});
