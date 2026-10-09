import { describe, expect, it } from "vitest";
import { MAX_WRAP_STEP, SPEED, stepWalk, Z_RANGE } from "../playground/src/walkStep.ts";

/**
 * The walk scene's figures are measured by the registry as displacement over
 * the clock's own step. A runner whose frames take seconds (a software-rendered
 * page on a loaded 4-core machine) must still see them walk at their pace, or
 * a test waiting to see them walk never does.
 */
describe("the walk scene's step", () => {
  it("moves the figures by speed × the clock's step, whatever the step", () => {
    for (const delta of [0.001, 0.016, 0.1, 0.3, 1, 3, 13]) {
      // From the middle of the track: a step under half a second cannot reach the end, a longer one does not wrap.
      expect(stepWalk(0, delta, true)).toBeCloseTo(SPEED * delta, 9);
    }
  });

  it("does not hold the figures at the start of the track after a long frame", () => {
    // A frame of 3 s at 0.9 m/s is 2.7 m, more than the 1.8 m track. Wrapping
    // on it puts the figures back at the start every frame, measured as standing still.
    let z = Z_RANGE[0];
    for (let frame = 0; frame < 5; frame++) {
      const next = stepWalk(z, 3, true);
      expect(next - z).toBeCloseTo(SPEED * 3, 9);
      z = next;
    }
  });

  it("wraps at the end of the track on ordinary frames, and only then", () => {
    const delta = 0.016;
    expect(stepWalk(Z_RANGE[1] - 0.001, delta, true)).toBe(Z_RANGE[0]);
    expect(stepWalk(Z_RANGE[1] - 0.001, MAX_WRAP_STEP, true)).toBeGreaterThan(Z_RANGE[1]);
    // And a figure that walked past the end on a long frame is brought back on the next ordinary one.
    expect(stepWalk(Z_RANGE[1] + 2, delta, true)).toBe(Z_RANGE[0]);
  });

  it("stands still when not walking", () => {
    expect(stepWalk(0.3, 5, false)).toBe(0.3);
  });
});
