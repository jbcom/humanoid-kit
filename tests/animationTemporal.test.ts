/** Elapsed animation advances contact episodes, source keys and fade velocity chronologically. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Animator } from "../src/animation/animator.ts";
import * as clips from "../src/animation/clip.ts";
import { type AnimationClip, sampleClip } from "../src/animation/clip.ts";
import { FootLock, PLANT_NONE } from "../src/animation/footlock.ts";
import { copyAnimationFrame, createAnimationFrames } from "../src/animation/frames.ts";
import { AnimationFrameWriter } from "../src/animation/frameWriter.ts";
import * as locomotion from "../src/animation/locomotion.ts";
import {
  contactBones,
  contactPoints,
  planRootMotion,
  rootDisplacement,
} from "../src/animation/locomotion.ts";
import { SupportConstraint, type SupportFigure } from "../src/animation/supportConstraint.ts";
import type { RestBones } from "../src/rig/bones.ts";

const DT = 1 / 60;
const names = [
  "upperleg01.L",
  "lowerleg01.L",
  "foot.L",
  "toe1-1.L",
  "toe5-1.L",
  "upperleg01.R",
  "lowerleg01.R",
  "foot.R",
  "toe1-1.R",
  "toe5-1.R",
];
const rest: RestBones = {
  names,
  parents: Int16Array.from([-1, 0, 1, 2, 2, -1, 5, 6, 7, 7]),
  order: Int16Array.from({ length: names.length }, (_, i) => i),
  heads: Float32Array.from([
    -0.1, 1, 0, -0.1, 0.5, 0, -0.1, 0, 0, -0.1, 0, 0.1, -0.15, 0, 0.1, 0.1, 1, 0, 0.1, 0.5, 0, 0.1,
    0, 0, 0.1, 0, 0.1, 0.15, 0, 0.1,
  ]),
};
const synthetic = (id: string, options: Partial<AnimationClip> = {}): AnimationClip => ({
  id,
  fps: 4,
  frames: 4,
  duration: 1,
  loop: true,
  grounded: false,
  rootMotion: false,
  boneIndex: new Int16Array(),
  rotations: new Float32Array(),
  ...options,
});
const state = (a: Animator) => ({
  time: a.playing?.time,
  root: [...a.root],
  fading: a.fading,
  ownership: a.contactOwnership,
  rotations: Array.from(a.rotations),
  support: { ...a.supportReport },
});
afterEach(() => vi.restoreAllMocks());

describe("elapsed animation contact", () => {
  it("releases and replants a returning sole instead of preserving its obsolete cycle-start pin", async () => {
    const { figure, clip, rig } = await import("./animationHarness.ts");
    const fig = figure("average", 25);
    const walk = clip("walk_normal");
    const plan = planRootMotion(fig.rest, walk, fig.ground);
    const measured = {
      rest: fig.rest,
      groundOffset: -fig.ground,
      contacts: contactBones(fig.rest),
    };
    const sole = (a: Animator) => {
      const p = new Float32Array(18);
      contactPoints(fig.rest, a.rotations, fig.ground, p);
      return [(p[3] as number) + a.root[0], (p[5] as number) + a.root[1]];
    };
    const make = (id: string) => {
      const a = new Animator(rig.bones.length, fig.rest, fig.ground);
      a.play(walk, { fade: 0, speed: 1, time: 0 });
      const writer = new AnimationFrameWriter(id);
      writer.resetCarry(a);
      const channel = createAnimationFrames();
      const binding = channel.bind(id);
      return {
        a,
        step(dt: number) {
          const before = {
            time: a.playing?.time as number,
            root: [...a.root],
            ownership: a.contactOwnership,
            sole: sole(a),
          };
          const planned = rootDisplacement(plan, before.time, dt);
          a.update(dt);
          const total = a.root.map((n, i) => n - (before.root[i] as number));
          const out = writer.write(measured, a, a.rotations);
          if (!out) throw new Error("walking producer has no frame");
          expect(binding.publish(out)).toBe(true);
          const latest = channel.latest(id);
          if (!latest) throw new Error("walking producer did not publish");
          const published = copyAnimationFrame(latest);
          expect(published.delta).toEqual(total);
          expect(published.root).toEqual(a.root);
          return {
            before,
            planned,
            inferredCorrection: total.map((n, i) => n - (planned[i] as number)),
            total,
            after: {
              time: a.playing?.time,
              root: [...a.root],
              ownership: a.contactOwnership,
              sole: sole(a),
            },
            published,
          };
        },
      };
    };
    const whole = make("whole");
    const normal = make("normal");
    const reference = make("reference");
    const initial = sole(whole.a);
    expect(whole.a.contactOwnership[0]).toEqual({ index: 1, hold: 1 });
    const zero = sampleClip(walk, 0, new Float32Array(rig.bones.length * 4));
    expect(sampleClip(walk, 1, new Float32Array(zero.length))).toEqual(zero);
    const halfway = sampleClip(walk, 0.5, new Float32Array(zero.length));
    const points = new Float32Array(18);
    contactPoints(fig.rest, halfway, fig.ground, points);
    const lowest = Math.min(...Array.from({ length: 6 }, (_, k) => points[k * 3 + 1] as number));
    expect((points[4] as number) - lowest).toBeGreaterThan(PLANT_NONE);
    for (let i = 0; i < 30; i++) reference.a.update(DT);
    expect(reference.a.contactOwnership[0]?.index).toBe(-1);
    const large = whole.step(1);
    const small = Array.from({ length: 60 }, () => normal.step(DT));
    expect(small[29]?.after.ownership[0]?.index).toBe(-1);
    expect(whole.a.playing?.time).toBeCloseTo(normal.a.playing?.time as number, 12);
    expect(whole.a.contactOwnership[0]).toEqual({ index: 1, hold: 1 });
    expect(normal.a.contactOwnership[0]).toEqual({ index: 1, hold: 1 });
    const distance2 = (a: number[], b: number[]) =>
      ((a[0] as number) - (b[0] as number)) ** 2 + ((a[1] as number) - (b[1] as number)) ** 2;
    const endpoint = sole(whole.a);
    const fresh = sole(normal.a);
    console.log(
      `ANIMATION_CONTACT_TEMPORAL_METRICS_JSON=${JSON.stringify({ planCycle: plan.cycle, initial, endpoint, fresh, large, small, distanceToOriginalSquared: distance2(endpoint, initial), distanceToFreshSquared: distance2(endpoint, fresh) })}`,
    );
    expect(
      distance2(endpoint, fresh),
      "the returning toe must belong to the fresh post-swing episode",
    ).toBeLessThan(distance2(endpoint, initial));
  });

  it("presents source-frame and half-frame starts in order across whole and partial cycles", () => {
    const motion = synthetic("grounded", { fps: 24, frames: 24, grounded: true });
    const apply = FootLock.prototype.apply;
    for (let phase = 0; phase < 48; phase++) {
      const a = new Animator(names.length, rest);
      a.play(motion, { time: phase / 48 });
      const seen: number[] = [];
      const spy = vi.spyOn(FootLock.prototype, "apply").mockImplementation(function (
        this: FootLock,
        ...args
      ) {
        seen.push(a.playing?.time as number);
        return apply.apply(this, args);
      });
      a.update(1.125);
      expect(a.playing?.time).toBeCloseTo(phase / 48 + 1.125, 12);
      expect(seen.length).toBeGreaterThan(60);
      let previous = phase / 48;
      for (const time of seen) {
        expect(time).toBeGreaterThan(previous);
        expect(time - previous).toBeLessThanOrEqual(DT + 1e-12);
        expect((time - previous) * motion.fps).toBeLessThanOrEqual(0.5 + 1e-12);
        previous = time;
      }
      for (let key = Math.floor(phase / 2) + 1; key / 24 <= phase / 48 + 1.125; key++)
        expect(seen.some((t) => Math.abs(t - key / 24) < 1e-12)).toBe(true);
      spy.mockRestore();
    }
  });

  it.each([-3, -1, 2, 5])(
    "bounds phase advance and consumes multiple cycles at speed %s",
    (speed) => {
      const a = new Animator(names.length, rest);
      const c = synthetic("moving", { fps: 30, frames: 30, grounded: true });
      a.play(c, { speed, time: 0.137 });
      const seen: number[] = [];
      const apply = FootLock.prototype.apply;
      vi.spyOn(FootLock.prototype, "apply").mockImplementation(function (this: FootLock, ...args) {
        seen.push(a.playing?.time as number);
        return apply.apply(this, args);
      });
      a.update(2.125);
      let previous = 0.137;
      for (const time of seen) {
        expect(Math.sign(time - previous)).toBe(Math.sign(speed));
        expect(Math.abs(time - previous) * 30).toBeLessThanOrEqual(0.5 + 1e-12);
        previous = time;
      }
      expect(a.playing?.time).toBeCloseTo(0.137 + 2.125 * speed, 10);
    },
  );

  it("does not invent an unrepresentable tail after repeated ordinary callbacks meet source keys", () => {
    for (const fps of [24, 30])
      for (const speed of [1, -1, -3, 5]) {
        const a = new Animator(names.length, rest);
        a.play(synthetic("regular", { fps, frames: fps, grounded: true }), { time: 0.137, speed });
        for (let frame = 0; frame < 240; frame++) a.update(DT);
        expect(a.playing?.time).toBeCloseTo(0.137 + 4 * speed, 10);
      }
  });

  it("samples both source-key sequences during a signed-speed grounded crossfade", () => {
    const old = synthetic("old", { fps: 3, frames: 3, grounded: true });
    const next = synthetic("next", { fps: 8, frames: 8, grounded: true });
    const a = new Animator(names.length, rest);
    a.play(old, { speed: -1 });
    a.play(next, { speed: 2, fade: 1 });
    const sample = vi.spyOn(clips, "sampleClip");
    a.update(1);
    const oldTimes = sample.mock.calls.filter(([c]) => c === old).map(([, t]) => t);
    const newTimes = sample.mock.calls.filter(([c]) => c === next).map(([, t]) => t);
    for (const key of [-1 / 3, -2 / 3])
      expect(oldTimes.some((t) => Math.abs(t - key) < 1e-12)).toBe(true);
    for (const key of [0.125, 0.25, 0.5, 1, 1.5, 2])
      expect(newTimes.some((t) => Math.abs(t - key) < 1e-12)).toBe(true);
    expect(a.fading).toBe(false);
  });

  it("keeps a frozen pose and update(0) free of invented contact/support transitions", () => {
    const a = new Animator(names.length, rest);
    a.play(synthetic("still", { grounded: true }), { speed: 0 });
    const spy = vi.spyOn(FootLock.prototype, "apply");
    const before = state(a);
    a.update(0);
    a.update(100);
    expect(state(a)).toEqual(before);
    expect(spy).not.toHaveBeenCalled();
    a.setSpeed(-1);
    a.update(0.1);
    expect(a.playing?.time).toBeCloseTo(-0.1, 12);
  });

  it("consumes an exact replay interval whose cadence endpoint already equals its requested clock", () => {
    const a = new Animator(names.length, rest);
    a.play(synthetic("replay", { grounded: true, fps: 24, frames: 24 }), { time: 1 / 24 });
    const dt = 0.01666666666666667;
    a.update(dt);
    expect(a.playing?.time).toBe(1 / 24 + dt);
  });

  it("permits a generated slice to leave one moving clock unchanged while the full fade advances", () => {
    const old = synthetic("coarse-clock", { grounded: true });
    const next = synthetic("fine-clock", { grounded: true, fps: 100_000, frames: 100_000 });
    const a = new Animator(names.length, rest);
    a.play(old, { time: 2 ** 40, speed: 1 });
    a.play(next, { time: 0, speed: 1, fade: 1 });
    const samples = vi.spyOn(clips, "sampleClip");
    a.update(0.001);
    const outgoing = samples.mock.calls.filter(([c]) => c === old).map(([, t]) => t);
    expect(outgoing.length).toBeGreaterThan(1);
    expect(outgoing.some((time, i) => i > 0 && time === outgoing[i - 1])).toBe(true);
    expect(outgoing.at(-1)).toBe(2 ** 40 + 0.001);
    expect(a.playing?.time).toBe(0.001);
    expect(a.fading).toBe(true);
  });

  it("samples advancing outgoing clocks even when current time and fade elapsed repeat", () => {
    const old = synthetic("outgoing-only", { grounded: true });
    const a = new Animator(names.length);
    a.play(old, { time: -(2 ** 40) * 1000, speed: 1000 });
    a.play(synthetic("frozen-current"), { speed: 0, fade: 2 ** 41 });
    a.update(2 ** 40);
    a.setRest(rest);
    const samples = vi.spyOn(clips, "sampleClip");
    const contacts = vi.spyOn(FootLock.prototype, "apply");
    a.update(0.001);
    expect(samples.mock.calls.filter(([c]) => c === old).map(([, time]) => time)).toEqual([
      0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1,
    ]);
    expect(contacts).toHaveBeenCalledTimes(8);
    expect(a.playing?.time).toBe(0);
    expect(a.fading).toBe(true);
  });

  it("matches an external sequence of its same chronological checkpoints and publishes only the final carry", () => {
    const c = synthetic("checkpoints", { grounded: true, fps: 24, frames: 24 });
    const a = new Animator(names.length, rest);
    a.play(c);
    const schedule: number[] = [];
    const apply = FootLock.prototype.apply;
    const spy = vi.spyOn(FootLock.prototype, "apply").mockImplementation(function (
      this: FootLock,
      ...args
    ) {
      schedule.push(a.playing?.time as number);
      return apply.apply(this, args);
    });
    a.update(0.9);
    spy.mockRestore();
    const b = new Animator(names.length, rest);
    b.play(c);
    let last = 0;
    for (const time of schedule) {
      b.update(time - last);
      last = time;
    }
    expect(b.playing?.time).toBeCloseTo(a.playing?.time as number, 12);
    expect(b.root).toEqual(a.root);
    expect(b.contactOwnership).toEqual(a.contactOwnership);
    expect(b.rotations).toEqual(a.rotations);
  });
});

describe("fade velocity integration", () => {
  const plans = new Map<AnimationClip, locomotion.RootMotionPlan>();
  const moving = (
    id: string,
    fps: number,
    velocity: number,
    options: Partial<AnimationClip> = {},
  ) => {
    const c = synthetic(id, { rootMotion: true, fps, frames: fps, ...options });
    const intervals = c.loop ? c.frames : c.frames - 1;
    plans.set(c, {
      fps,
      frames: c.frames,
      loop: c.loop,
      step: Float32Array.from({ length: intervals * 2 }, (_, i) =>
        i % 2 === 0 ? 0 : velocity / fps,
      ),
      cycle: [0, velocity],
    });
    return c;
  };
  const animator = () => {
    vi.spyOn(locomotion, "planRootMotion").mockImplementation((_rest, c) => {
      const plan = plans.get(c);
      if (!plan) throw new Error("analytic clip has no plan");
      return plan;
    });
    return new Animator(names.length, rest);
  };
  it.each([[1], [0.25, 0.25, 0.5], [0.1, 0.2, 0.7]])(
    "integrates unequal signed velocities over a full fade with partition %j",
    (...parts) => {
      const old = moving("outgoing", 4, 2);
      const next = moving("incoming", 8, -4);
      const a = animator();
      a.play(old);
      a.play(next, { fade: 1 });
      for (const dt of parts) a.update(dt);
      // Integral of smoothstep on [0,1] is 1/2: 2*(1/2) - 4*(1/2) = -1.
      expect(a.root[1]).toBeCloseTo(-1, 11);
      expect(a.fading).toBe(false);
      expect(a.playing?.time).toBeCloseTo(1, 12);
    },
  );
  it("splits a fade completion and a nonloop stop without carrying a stopped track", () => {
    const old = moving("outgoing", 4, 2);
    const stop = moving("stopping", 4, -4, { loop: false, frames: 3, duration: 0.5 });
    const a = animator();
    a.play(old);
    a.play(stop, { fade: 1 });
    a.update(1.5);
    // Incoming acts until .5: integral_0^.5 smoothstep = 3/32; outgoing integral_0^1(1-w)=1/2.
    expect(a.root[1]).toBeCloseTo(2 * 0.5 - 4 * (3 / 32), 11);
    expect(a.playing?.time).toBe(0.5);
  });
  it("advances both tracks' boundaries, including reverse and frozen incoming playback", () => {
    const old = moving("outgoing", 4, 2);
    const next = moving("incoming", 8, -4);
    const a = animator();
    a.play(old, { speed: -1 });
    a.play(next, { fade: 1, speed: 0 });
    a.update(1.25);
    expect(a.root[1]).toBeCloseTo(-1, 11);
    expect(a.playing?.time).toBe(0);
    expect(a.fading).toBe(false);
  });
});

describe("authored temporal support and bounds", () => {
  const supported = (loop = false) =>
    synthetic("supported", {
      grounded: true,
      loop,
      frames: loop ? 4 : 5,
      supportTracks: [
        {
          times: [0.125, 0.25, 1],
          supports: [{ kind: "sole", bone: "foot.L" }],
          chains: ["upperleg01.L", "lowerleg01.L"],
          quality: { contactTolerance: 0.015, maxRotationRadians: 0.7, iterations: 1 },
        },
      ],
    });
  const figure: SupportFigure = {
    generation: {},
    restBones: rest,
    ground: 0,
    rest: new Float32Array(),
    skinIndex: new Uint8Array(),
    skinWeight: new Float32Array(),
    anchors: { surface: "base", vertices: {}, joints: {} } as SupportFigure["anchors"],
  };
  it("visits crossed support keys once, before contact, and does not replay a stopped endpoint", () => {
    const a = new Animator(names.length, rest);
    a.play(supported());
    a.setSupportFigure(figure);
    const support = vi.spyOn(SupportConstraint.prototype, "apply");
    const atLock: { time: number; state: string }[] = [];
    const apply = FootLock.prototype.apply;
    vi.spyOn(FootLock.prototype, "apply").mockImplementation(function (this: FootLock, ...args) {
      atLock.push({ time: a.playing?.time as number, state: a.supportReport.state });
      return apply.apply(this, args);
    });
    a.update(2);
    expect(support.mock.calls.map((call) => call[1])).toEqual([0.125, 0.25, 1]);
    for (const key of [0.125, 0.25, 1])
      expect(atLock.find((x) => Math.abs(x.time - key) < 1e-12)?.state).toBe("satisfied");
    a.update(3);
    a.update(0);
    expect(support).toHaveBeenCalledTimes(3);
    a.seek(1);
    expect(support).toHaveBeenCalledTimes(4);
  });
  it("wraps loop support keys and crosses them once in each playback direction", () => {
    const a = new Animator(names.length, rest);
    a.play(supported(true), { time: 0.9 });
    a.setSupportFigure(figure);
    const support = vi.spyOn(SupportConstraint.prototype, "apply");
    a.update(0.4);
    expect(support.mock.calls.map((call) => call[1])).toEqual([1, 0.125, 0.25]);
    support.mockClear();
    a.setSpeed(-1);
    a.update(0.4);
    expect(support.mock.calls.map((call) => call[1])).toEqual([0.25, 0.125, 1]);
  });
  it.each([
    [28, 11 / 24, 2],
    [26, 10 / 24, 3],
  ])(
    "admits only represented in-range reverse support keys from phase index %s",
    (phase, key, crossings) => {
      const track = supported(true).supportTracks?.[0];
      if (!track) throw new Error("supported fixture has no track");
      const c = synthetic("reverse-keys", {
        grounded: true,
        fps: 24,
        frames: 24,
        supportTracks: [{ ...track, times: [key] }],
      });
      const a = new Animator(names.length, rest);
      a.play(c, { time: phase / 48, speed: -1 });
      a.setSupportFigure(figure);
      const support = vi.spyOn(SupportConstraint.prototype, "apply");
      a.update(2.125);
      expect(a.playing?.time).toBe(phase / 48 - 2.125);
      expect(support.mock.calls.map((call) => call[1])).toEqual(
        Array.from({ length: crossings }, () => key),
      );
    },
  );

  it("does not turn an off-frame key into a frame merely because multiplication rounds to an integer", () => {
    const key = 10 / 24 - Number.EPSILON / 4;
    expect(key * 24).toBe(10);
    expect(key).not.toBe(10 / 24);
    const track = supported(true).supportTracks?.[0];
    if (!track) throw new Error("supported fixture has no track");
    const c = synthetic("distinct-support", {
      fps: 24,
      frames: 24,
      supportTracks: [{ ...track, times: [key] }],
    });
    const a = new Animator(names.length);
    a.play(c);
    a.setSupportFigure(figure);
    const samples = vi.spyOn(clips, "sampleClip");
    a.update(1);
    expect(samples.mock.calls.filter(([clip]) => clip === c).map(([, time]) => time)).toEqual([
      key,
      1,
    ]);
  });

  it("preserves nearby exact raw keys and selects their own chain and quality", () => {
    const track = supported().supportTracks?.[0];
    if (!track) throw new Error("supported fixture has no track");
    const c = synthetic("nearby-identities", {
      supportTracks: [
        { ...track, times: [0.25], chains: ["missing-chain"] },
        { ...track, times: [0.2500005], quality: { ...track.quality, contactTolerance: 0.025 } },
      ],
    });
    const a = new Animator(names.length);
    a.play(c);
    a.setSupportFigure(figure);
    const apply = vi.spyOn(SupportConstraint.prototype, "apply");
    a.update(0.25);
    expect(a.supportReport).toMatchObject({ state: "unavailable", time: 0.25, tolerance: 0.015 });
    a.update(0.0000005);
    expect(apply.mock.calls.map((call) => call[1])).toEqual([0.25, 0.2500005]);
    expect(a.supportReport).toMatchObject({
      state: "satisfied",
      time: 0.2500005,
      tolerance: 0.025,
    });
    a.seek(0.2500005);
    expect(a.supportReport).toMatchObject({
      state: "satisfied",
      time: 0.2500005,
      tolerance: 0.025,
    });
  });

  it("retains raw duration-seam identity separately from zero during support selection", () => {
    const track = supported(true).supportTracks?.[0];
    if (!track) throw new Error("supported fixture has no track");
    const c = synthetic("seam-identities", {
      supportTracks: [
        { ...track, times: [0], chains: ["missing-chain"] },
        { ...track, times: [1], quality: { ...track.quality, contactTolerance: 0.025 } },
      ],
    });
    const a = new Animator(names.length);
    a.setSupportFigure(figure);
    a.play(c);
    expect(a.supportReport).toMatchObject({ state: "unavailable", time: 0, tolerance: 0.015 });
    const apply = vi.spyOn(SupportConstraint.prototype, "apply");
    a.update(1);
    expect(apply.mock.calls.map((call) => call[1])).toEqual([1]);
    expect(a.supportReport).toMatchObject({ state: "satisfied", time: 1, tolerance: 0.025 });
    a.seek(0);
    expect(a.supportReport).toMatchObject({ state: "unavailable", time: 0, tolerance: 0.015 });
  });

  it.each([
    [1, [0.00001, 0.00002]],
    [-1, [0.99999, 0.99998]],
    [1, [0.00001]],
    [-1, [0.99999]],
  ])(
    "rejects off-frame events rounded onto the current seam atomically, speed %s keys %j",
    (speed, keys) => {
      const track = supported(true).supportTracks?.[0];
      if (!track) throw new Error("supported fixture has no track");
      const a = new Animator(names.length);
      a.play(synthetic("current-seam-loss", { supportTracks: [{ ...track, times: keys }] }), {
        time: 2 ** 40,
        speed,
      });
      const before = state(a);
      expect(() => a.update(0.001)).toThrow(/distinct authored support events/);
      expect(state(a)).toEqual(before);
    },
  );

  it.each([1, -1])(
    "rejects a single off-frame key losing identity to an interior source frame, speed %s",
    (speed) => {
      const track = supported(true).supportTracks?.[0];
      if (!track) throw new Error("supported fixture has no track");
      const a = new Animator(names.length);
      a.play(
        synthetic("interior-frame-loss", { supportTracks: [{ ...track, times: [0.50001] }] }),
        {
          time: 2 ** 40 + 0.5,
          speed,
        },
      );
      const before = state(a);
      expect(() => a.update(0.001)).toThrow(/distinct authored support events/);
      expect(state(a)).toEqual(before);
    },
  );

  it("rejects a distinct support key sharing a required source frame's inverse wall coordinate", () => {
    const key = 0.5 + Number.EPSILON / 2;
    expect(key).not.toBe(0.5);
    expect(key - -1).toBe(0.5 - -1);
    const track = supported(true).supportTracks?.[0];
    if (!track) throw new Error("supported fixture has no track");
    const c = synthetic("inverse-frame-collision", {
      grounded: true,
      supportTracks: [{ ...track, times: [key] }],
    });
    const a = new Animator(names.length, rest);
    a.play(c, { time: -1 });
    const before = state(a);
    expect(() => a.update(1.75)).toThrow(/distinct authored support events/);
    expect(state(a)).toEqual(before);
    // At origin zero, the exact same authored key and frame have distinct walls.
    const distinct = new Animator(names.length, rest);
    distinct.play(c);
    distinct.update(0.75);
    expect(distinct.playing?.time).toBe(0.75);
  });

  it("rejects a nonloop off-frame support key sharing a reverse frame's wall time atomically", () => {
    const key = 0.25 - Number.EPSILON / 8;
    expect(key).not.toBe(0.25);
    expect((key - 1) / -1).toBe((0.25 - 1) / -1);
    const track = supported().supportTracks?.[0];
    if (!track) throw new Error("supported fixture has no track");
    const c = synthetic("nonloop-inverse-collision", {
      loop: false,
      grounded: true,
      frames: 5,
      supportTracks: [{ ...track, times: [key] }],
    });
    const a = new Animator(names.length, rest);
    a.play(c, { time: 1, speed: -1 });
    const before = state(a);
    expect(() => a.update(1)).toThrow(/distinct authored support events/);
    expect(state(a)).toEqual(before);
    const ordinary = new Animator(names.length, rest);
    ordinary.play({ ...c, supportTracks: [{ ...track, times: [0.249] }] }, { time: 1, speed: -1 });
    ordinary.update(1);
    expect(ordinary.playing?.time).toBe(0);
  });

  it("does not reject an unrelated support collision outside the requested represented span", () => {
    const track = supported(true).supportTracks?.[0];
    if (!track) throw new Error("supported fixture has no track");
    const a = new Animator(names.length);
    a.play(synthetic("outside-collision", { supportTracks: [{ ...track, times: [0.00001] }] }), {
      time: 2 ** 40 + 0.5,
    });
    a.update(0.001);
    expect(a.playing?.time).toBe(2 ** 40 + 0.5 + 0.001);
  });

  it("recognizes a unique negative-cycle off-frame event as visited without source-phase epsilon", () => {
    const track = supported(true).supportTracks?.[0];
    if (!track) throw new Error("supported fixture has no track");
    const key = 0.417;
    const a = new Animator(names.length);
    a.play(synthetic("negative-off-frame", { supportTracks: [{ ...track, times: [key] }] }), {
      time: -1 + key,
      speed: -1,
    });
    a.setSupportFigure(figure);
    const apply = vi.spyOn(SupportConstraint.prototype, "apply");
    a.update(0.1);
    expect(apply).not.toHaveBeenCalled();
    expect(a.playing?.time).toBe(-1 + key - 0.1);
  });

  it.each([1, -1])(
    "rejects lost distinct off-frame event identity atomically at a far loop clock, speed %s",
    (speed) => {
      const keys = speed > 0 ? [0.00015, 0.00016] : [0.99985, 0.99984];
      expect(keys[0]).not.toBe(keys[1]);
      const track = supported(true).supportTracks?.[0];
      if (!track) throw new Error("supported fixture has no track");
      const c = synthetic("distinct-events", {
        grounded: true,
        supportTracks: [{ ...track, times: keys }],
      });
      const a = new Animator(names.length, rest);
      a.play(c, { time: 2 ** 40, speed });
      a.setSupportFigure(figure);
      const before = state(a);
      expect(() => a.update(0.001)).toThrow(/distinct authored support events/);
      expect(state(a)).toEqual(before);
    },
  );

  it("keeps duplicate support declarations and a duration seam as single source events", () => {
    const track = supported(true).supportTracks?.[0];
    if (!track) throw new Error("supported fixture has no track");
    const c = synthetic("shared-events", {
      grounded: true,
      supportTracks: [
        { ...track, times: [0, 0.25, 1] },
        { ...track, times: [0.25] },
      ],
    });
    const a = new Animator(names.length, rest);
    a.play(c);
    a.setSupportFigure(figure);
    const support = vi.spyOn(SupportConstraint.prototype, "apply");
    a.update(1);
    expect(support.mock.calls.map((call) => call[1])).toEqual([0.25, 1]);
    expect(a.playing?.time).toBe(1);
  });

  it.each([1, -1])(
    "normalizes an out-of-range nonloop hold before consuming the full positive step at speed %s",
    (speed) => {
      const a = new Animator(names.length);
      const c = synthetic("hold", { loop: false, frames: 5 });
      const outside = speed > 0 ? -99 : 99;
      a.play(c, { time: outside, speed });
      expect(a.playing?.time).toBe(outside);
      a.update(0);
      expect(a.playing?.time).toBe(outside);
      a.update(0.25);
      expect(a.playing?.time).toBe(speed > 0 ? 0.25 : 0.75);
      a.seek(outside);
      expect(a.playing?.time).toBe(outside);
      a.update(0.25);
      expect(a.playing?.time).toBe(speed > 0 ? 0.25 : 0.75);
    },
  );
  it("rejects active invalid inputs atomically and retains inactive no-ops", () => {
    const c = synthetic("finite");
    const a = new Animator(names.length);
    expect(() => a.update(Number.NaN)).not.toThrow();
    expect(() => a.setSpeed(Infinity)).not.toThrow();
    expect(() => a.seek(Number.NaN)).not.toThrow();
    a.play(c);
    a.update(0.2);
    for (const mutate of [
      () => a.update(-1),
      () => a.update(NaN),
      () => a.update(Infinity),
      () => a.play(c, { fade: -1 }),
      () => a.play(c, { fade: Infinity }),
      () => a.play(c, { speed: NaN }),
      () => a.play(c, { time: Infinity }),
      () => a.seek(NaN),
      () => a.setSpeed(Infinity),
    ]) {
      const before = state(a);
      expect(mutate).toThrow(RangeError);
      expect(state(a)).toEqual(before);
    }
    const fresh = new Animator(names.length);
    expect(() => fresh.play(c, { fade: -1 })).toThrow(RangeError);
    expect(fresh.playing).toBeNull();
  });
  it("preflights moving nonloop clocks after normalization and a fade that cannot advance as a whole", () => {
    const nonloop = synthetic("long-hold", {
      loop: false,
      fps: 2 ** -53,
      frames: 3,
      duration: 2 ** 54,
    });
    const a = new Animator(names.length);
    a.play(nonloop, { time: 2 ** 53 });
    const before = state(a);
    expect(() => a.update(DT)).toThrow(RangeError);
    expect(state(a)).toEqual(before);
    const fade = new Animator(names.length);
    fade.play(synthetic("old"), { speed: 0 });
    fade.play(synthetic("new"), { speed: 0, fade: Number.MAX_VALUE });
    fade.update(Number.MAX_VALUE / 2);
    const halfway = state(fade);
    expect(() => fade.update(1)).toThrow(RangeError);
    expect(state(fade)).toEqual(halfway);
  });

  it("rejects nonrepresentable clock progress before changing roots, clocks, contacts or fade", () => {
    const a = new Animator(names.length, rest);
    a.play(synthetic("far", { grounded: true }), { time: 2 ** 53 });
    const before = state(a);
    expect(() => a.update(DT)).toThrow(RangeError);
    expect(state(a)).toEqual(before);
    const b = new Animator(names.length);
    b.play(synthetic("out"));
    b.play(synthetic("in"), { fade: 1, speed: Number.MAX_VALUE });
    const fading = state(b);
    expect(() => b.update(2)).toThrow(RangeError);
    expect(state(b)).toEqual(fading);
  });
});
