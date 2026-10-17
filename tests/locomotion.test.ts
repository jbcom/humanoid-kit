import { describe, expect, it } from "vitest";
import { type RootMotionPlan, rootDisplacement } from "../src/animation/locomotion.ts";

// Three half-second intervals, with a stored displacement of [2, 5] per pass.
function plan(loop = true): RootMotionPlan {
  return {
    fps: 2,
    frames: loop ? 3 : 4,
    loop,
    step: new Float32Array([1, 2, 3, -1, -2, 4]),
    cycle: [2, 5],
  };
}

describe("root displacement over stored steps", () => {
  it.each([
    { time: 0, dt: 300001.5, want: [400002, 1000005] },
    { time: -0.125, dt: 300002, want: [400002.25, 1000007.5] },
    { time: 300001.875, dt: -300002, want: [-400002.25, -1000007.5] },
    { time: -300002.125, dt: 300002, want: [400001.25, 1000007.75] },
    { time: -0.125, dt: -300002, want: [-400001.25, -1000007.75] },
  ])(
    "integrates every cycle and partial boundary from $time over $dt seconds",
    ({ time, dt, want }) => {
      expect(rootDisplacement(plan(), time, dt)).toEqual(want);
    },
  );

  it("sums the stored Float32 steps rather than the pre-rounding cycle field", () => {
    const rounded: RootMotionPlan = {
      fps: 1,
      frames: 1,
      loop: true,
      step: new Float32Array([0.1, 0.2]),
      cycle: [0.1, 0.2],
    };
    expect(rootDisplacement(rounded, 0, 200001)).toEqual([
      0.10000000149011612 * 200001,
      0.20000000298023224 * 200001,
    ]);
  });

  it("composes a long span and negates the same span run backwards", () => {
    const motion = plan();
    const whole = rootDisplacement(motion, -0.125, 300002);
    const first = rootDisplacement(motion, -0.125, 0.25);
    const rest = rootDisplacement(motion, 0.125, 300001.75);
    const back = rootDisplacement(motion, 300001.875, -300002);
    expect([first[0] + rest[0], first[1] + rest[1]]).toEqual(whole);
    expect(back).toEqual([-whole[0], -whole[1]]);
  });

  it.each([
    { time: -1, dt: 2, want: [4, 1] },
    { time: -1, dt: 4, want: [2, 5] },
    { time: 3, dt: -4, want: [-2, -5] },
    { time: 1, dt: -2, want: [-4, -1] },
    { time: -1, dt: 0.5, want: [0, 0] },
    { time: 3, dt: -1, want: [0, 0] },
    { time: 1.25, dt: 1, want: [-1, 2] },
  ])("clips a nonlooping span from $time over $dt seconds", ({ time, dt, want }) => {
    expect(rootDisplacement(plan(false), time, dt)).toEqual(want);
  });

  it("keeps fractional interval integration and does not discard a tiny finite step", () => {
    expect(rootDisplacement(plan(), 0.125, 0.5)).toEqual([1.5, 1.25]);
    expect(rootDisplacement(plan(), 0.25, 1e-12)).toEqual([2e-12, 4e-12]);
  });

  it("reuses and resets the output buffer, including the informational cycle tuple", () => {
    const motion = plan();
    const out: [number, number] = [91, 92];
    expect(rootDisplacement(motion, 0.125, 0.5, out)).toBe(out);
    expect(out).toEqual([1.5, 1.25]);
    expect(rootDisplacement(motion, 0, 0, out)).toBe(out);
    expect(out).toEqual([0, 0]);
    expect(rootDisplacement(motion, 0, 300001.5, motion.cycle)).toBe(motion.cycle);
    expect(motion.cycle).toEqual([400002, 1000005]);
  });

  it.each([
    { time: Number.NaN, dt: 1 },
    { time: Number.POSITIVE_INFINITY, dt: 1 },
    { time: Number.NEGATIVE_INFINITY, dt: -1 },
    { time: 0, dt: Number.NaN },
    { time: 0, dt: Number.POSITIVE_INFINITY },
    { time: 0, dt: Number.NEGATIVE_INFINITY },
  ])("reports an undefined span as NaN from $time over $dt seconds", ({ time, dt }) => {
    expect(rootDisplacement(plan(), time, dt).every(Number.isNaN)).toBe(true);
  });

  it("keeps zero-length and valid no-motion plans at zero", () => {
    expect(rootDisplacement(plan(), Number.NaN, 0)).toEqual([0, 0]);
    expect(
      rootDisplacement({ ...plan(false), frames: 1, step: new Float32Array() }, -1, 2),
    ).toEqual([0, 0]);
    expect(rootDisplacement({ ...plan(), fps: 0 }, -1, 2)).toEqual([0, 0]);
    for (const dt of [300002, -300002])
      expect(rootDisplacement({ ...plan(), step: new Float32Array(6) }, -0.125, dt)).toEqual([
        0, 0,
      ]);
  });
});
