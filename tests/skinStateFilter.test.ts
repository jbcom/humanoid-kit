import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATE_RATE,
  SkinStateFilter,
  STATE_TIME_CONSTANTS,
  stepSkinState,
} from "../src/surface/skinStateFilter.ts";

/** Runs a filter over `seconds` at 60 Hz, calling `target(t)` each frame; returns (t, value) of one signal. */
function run(
  signal: string,
  seconds: number,
  target: (t: number) => number,
  filter = new SkinStateFilter(),
): { t: number; v: number }[] {
  const dt = 1 / 60;
  const out: { t: number; v: number }[] = [];
  for (let i = 0; i <= Math.round(seconds / dt); i++) {
    const t = i * dt;
    const value = filter.step({ [signal]: target(t) }, i === 0 ? 0 : dt);
    out.push({ t, v: value[signal] as number });
  }
  return out;
}

/** Seconds a signal stays above `level`. */
const above = (samples: { t: number; v: number }[], level: number) =>
  samples.filter((s) => s.v > level).length / 60;

describe("stepSkinState", () => {
  it("moves toward the target by the exact first-order response, whatever the step", () => {
    const rates = { cold: { attack: 2, decay: 5 } };
    const once = stepSkinState({ cold: 0 }, { cold: 1 }, 3, rates).cold as number;
    expect(once).toBeCloseTo(1 - Math.exp(-3 / 2), 9);
    // Two half steps land where one whole step does: the response is exact, not Euler.
    const half = stepSkinState({ cold: 0 }, { cold: 1 }, 1.5, rates);
    const twice = stepSkinState(half, { cold: 1 }, 1.5, rates).cold as number;
    expect(twice).toBeCloseTo(once, 9);
  });

  it("rises with the attack constant and falls with the decay constant", () => {
    const rates = { cold: { attack: 2, decay: 5 } };
    const up = stepSkinState({ cold: 0 }, { cold: 1 }, 1, rates).cold as number;
    const down = stepSkinState({ cold: 1 }, { cold: 0 }, 1, rates).cold as number;
    expect(up).toBeCloseTo(1 - Math.exp(-1 / 2), 9);
    expect(down).toBeCloseTo(Math.exp(-1 / 5), 9);
  });

  it("holds, and never overshoots, however large the step", () => {
    expect(stepSkinState({ cold: 0.4 }, { cold: 0.4 }, 5)).toEqual({ cold: 0.4 });
    expect(stepSkinState({ cold: 0 }, { cold: 1 }, 1e6).cold).toBe(1);
    expect(stepSkinState({ cold: 1 }, { cold: 0 }, 1e6).cold).toBe(0);
    expect(stepSkinState({ cold: 0.3 }, { cold: 0.9 }, 0)).toEqual({ cold: 0.3 });
    expect(stepSkinState({ cold: 0.3 }, { cold: 0.9 }, -4)).toEqual({ cold: 0.3 });
  });

  it("keeps signals inside 0..1, treats a missing one as 0, and takes unknown ones at the default rate", () => {
    expect(stepSkinState({}, { cold: 7 }, 1e6).cold).toBe(1);
    expect(stepSkinState({}, { cold: -3 }, 1e6).cold).toBe(0);
    expect(stepSkinState({ cold: 1 }, {}, 1e6).cold).toBe(0);
    const unknown = stepSkinState({ delight: 0 }, { delight: 1 }, 1);
    expect(unknown.delight).toBeCloseTo(1 - Math.exp(-1 / DEFAULT_STATE_RATE.attack), 9);
  });

  it("snaps to the target once it is within a thousandth, so a settled state stops changing", () => {
    expect(stepSkinState({ cold: 0.9996 }, { cold: 1 }, 1e-9).cold).toBe(1);
    expect(stepSkinState({ cold: 0.01 }, { cold: 1 }, 1e-9).cold).toBeLessThan(0.02);
  });
});

describe("the time constants", () => {
  it("name every state signal with positive constants", () => {
    for (const name of ["cold", "fear", "blush", "exertion", "heat"])
      expect(STATE_TIME_CONSTANTS[name], name).toBeDefined();
    for (const [name, r] of Object.entries(STATE_TIME_CONSTANTS)) {
      expect(r.attack, name).toBeGreaterThan(0);
      expect(r.decay, name).toBeGreaterThan(0);
    }
  });

  it("make a goosebump episode last as long as the measured ones (9 to 13 s)", () => {
    // McPhetres et al. 2024: the mean episode lasts 10.1 s (small 9.0, large 13.2).
    // A 3 s trigger, then nothing: the intensity stays visible for about that long.
    for (const signal of ["cold", "fear"]) {
      const episode = run(signal, 30, (t) => (t < 3 ? 1 : 0));
      const visible = above(episode, 0.1);
      expect(visible, signal).toBeGreaterThan(8.5);
      expect(visible, signal).toBeLessThan(13.5);
    }
  });

  it("make flush and sweat build and fade over the longer time courses they have", () => {
    const seconds = (signal: string) => {
      const rise = run(signal, 400, () => 1);
      const reach = rise.find((s) => s.v > 0.63)?.t as number;
      const fall = run(signal, 800, (t) => (t < 400 ? 1 : 0), new SkinStateFilter());
      const gone = fall.find((s) => s.t > 400 && s.v < 0.37)?.t as number;
      return { rise: reach, fall: gone - 400 };
    };
    const blush = seconds("blush");
    const exertion = seconds("exertion");
    const heat = seconds("heat");
    // A blush comes in seconds and goes in tens of seconds; exertion and heat in tens and hundreds.
    expect(blush.rise).toBeLessThan(6);
    expect(blush.fall).toBeGreaterThan(8);
    expect(blush.fall).toBeLessThan(30);
    expect(exertion.rise).toBeGreaterThan(blush.rise * 3);
    expect(exertion.fall).toBeGreaterThan(exertion.rise);
    expect(heat.rise).toBeGreaterThan(exertion.rise);
    expect(heat.fall).toBeGreaterThan(heat.rise);
  });
});

describe("SkinStateFilter", () => {
  it("starts at rest, follows its targets and reports when it has settled", () => {
    const f = new SkinStateFilter();
    expect(f.value).toEqual({});
    expect(f.settled({ cold: 0 })).toBe(true);
    expect(f.settled({ cold: 1 })).toBe(false);
    f.step({ cold: 1 }, 0.5);
    expect(f.value.cold).toBeGreaterThan(0);
    expect(f.settled({ cold: 1 })).toBe(false);
    f.step({ cold: 1 }, 1e6);
    expect(f.value.cold).toBe(1);
    expect(f.settled({ cold: 1 })).toBe(true);
    f.step({}, 1e6);
    expect(f.settled({})).toBe(true);
  });

  it("can start from a given state, and reset to one", () => {
    const f = new SkinStateFilter(undefined, { heat: 0.8 });
    expect(f.value).toEqual({ heat: 0.8 });
    f.reset({ fear: 1 });
    expect(f.value).toEqual({ fear: 1 });
    f.reset();
    expect(f.value).toEqual({});
  });

  it("uses the rates it is given, over the defaults", () => {
    const fast = new SkinStateFilter({ cold: { attack: 0.01, decay: 0.01 } });
    fast.step({ cold: 1 }, 1);
    expect(fast.value.cold).toBe(1);
    const slow = new SkinStateFilter();
    slow.step({ cold: 1 }, 1);
    expect(slow.value.cold as number).toBeLessThan(1);
  });

  it("does not let the caller's objects change it, or hand out its own state to change", () => {
    const f = new SkinStateFilter();
    const target = { cold: 1 };
    const out = f.step(target, 0.5);
    target.cold = 0;
    expect(f.value.cold).toBe(out.cold);
    (out as Record<string, number>).cold = 99;
    expect(f.value.cold).not.toBe(99);
  });
});
