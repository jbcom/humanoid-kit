/**
 * The browser suite's one way to compare two numeric buffers.
 *
 * `expect(a).toEqual(b)` on a large typed array hangs the browser run when it fails:
 * vitest builds a diff of every element to print, and for a 16k-element render that
 * takes until the render pool's job timeout kills the whole job, so one assertion
 * failure becomes a lost run. This reports a failure as a count and the first few
 * differing elements instead, in time that does not depend on how many differ.
 *
 * A file compares a render, a readback or any buffer longer than a handful of elements
 * through here, never through `toEqual` / `toStrictEqual`
 * (tests/browserArrayComparison.test.ts keeps it so).
 */
import { expect } from "vitest";

export interface SameArrayOptions {
  /**
   * The largest `|actual - expected|` that still counts as the same. Zero (the default)
   * is exact equality, where `-0` and `0` are the same and `NaN` is the same as `NaN`.
   */
  tolerance?: number;
  /** What is being compared, prefixed to the failure message. */
  what?: string;
  /** How many differing elements the message lists (default 5). */
  show?: number;
}

/** True when two numbers are the same under a tolerance (NaN only matches NaN). */
function same(a: number, b: number, tolerance: number): boolean {
  if (a === b) return true;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  return Math.abs(a - b) <= tolerance;
}

/**
 * Fails, with a short message, unless `actual` and `expected` have the same length and
 * every element matches (exactly, or within `options.tolerance`). The message gives the
 * lengths when they differ, otherwise how many elements differ, the largest difference,
 * and the first `options.show` differing indices with their two values.
 */
export function expectSameArray(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  options: SameArrayOptions = {},
): void {
  const { tolerance = 0, what = "arrays", show = 5 } = options;
  if (!(tolerance >= 0)) throw new Error(`expectSameArray: tolerance ${tolerance} is not >= 0`);
  if (actual.length !== expected.length)
    expect.fail(`${what}: length ${actual.length}, expected ${expected.length}`);
  let differing = 0;
  let worst = 0;
  let worstAt = -1;
  const first: string[] = [];
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i] as number;
    const b = expected[i] as number;
    if (same(a, b, tolerance)) continue;
    differing++;
    if (first.length < show) first.push(`[${i}] ${a} vs ${b}`);
    // A NaN on one side differs by more than any finite amount.
    const gap = Number.isNaN(a) || Number.isNaN(b) ? Number.POSITIVE_INFINITY : Math.abs(a - b);
    if (gap > worst || worstAt < 0) {
      worst = gap;
      worstAt = i;
    }
  }
  if (differing === 0) return;
  const bound = tolerance > 0 ? ` by more than ${tolerance}` : "";
  expect.fail(
    `${what}: ${differing} of ${actual.length} elements differ${bound}; ` +
      `the largest gap is ${worst} at [${worstAt}]; first ${first.length}: ${first.join(", ")}`,
  );
}
