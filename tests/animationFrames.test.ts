/**
 * Animation frames and their observers (docs/INTERACTION-SESSION.md, "Animation
 * frames"): real figures walk a real clip in Node, a headless producer writes each
 * frame with the same `AnimationFrameWriter` `<Humanoid>` uses, and the tests read
 * only what observers receive. They hold the contact geometry the frames report
 * (soles on the ground, planted soles still in the world, a child's stride shorter
 * than an adult's) and the lifecycle: unsubscribe, supersession on client
 * replacement, release, and an interaction's observers ending with it.
 */
import { describe, expect, it } from "vitest";
import { Animator } from "../src/animation/animator.ts";
import {
  ANIMATION_CONTACTS,
  type AnimationFrames,
  copyAnimationFrame,
  createAnimationFrames,
  type FrameBinding,
  frameContactWorld,
  type HumanoidAnimationFrame,
  setFramePlacement,
} from "../src/animation/frames.ts";
import { AnimationFrameWriter, type FrameFigure } from "../src/animation/frameWriter.ts";
import { contactBones, contactPoints } from "../src/animation/locomotion.ts";
import type { InteractionDefinition } from "../src/interaction/definition.ts";
import { createInteractions } from "../src/interaction/runtime.ts";
import { createPresenceRegistry } from "../src/presence/presence.ts";
import { figure as bodyOf, clip, type Figure, rig } from "./animationHarness.ts";
import { figure as presenceOf } from "./interactionHarness.ts";

const DT = 1 / 60;
const ADULT = bodyOf("average", 25);
const CHILD = bodyOf("average", 6);

const frameFigure = (fig: Figure): FrameFigure => ({
  rest: fig.rest,
  groundOffset: -fig.ground,
  contacts: contactBones(fig.rest),
});

interface Walker {
  binding: FrameBinding;
  animator: Animator;
  writer: AnimationFrameWriter;
  /** Advances the clip one step, places the frame and publishes it; what `publish` returned. */
  step(): boolean;
}

/**
 * A headless producer: `fig` walking from `at` along `heading` (radians from +z),
 * bound into `frames` as `id`, carried in the world by its own frames' `delta`.
 */
function walker(
  frames: AnimationFrames,
  id: string,
  fig: Figure,
  at: [number, number, number] = [0, 0, 0],
  heading = 0,
): Walker {
  const measured = frameFigure(fig);
  const animator = new Animator(rig.bones.length, fig.rest, fig.ground);
  animator.play(clip("walk_normal"));
  const writer = new AnimationFrameWriter();
  writer.resetCarry(animator);
  const binding = frames.bind(id);
  const position: [number, number, number] = [...at];
  const facing: [number, number, number] = [Math.sin(heading), 0, Math.cos(heading)];
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return {
    binding,
    animator,
    writer,
    step() {
      animator.update(DT);
      const f = writer.write(measured, animator, animator.rotations);
      if (!f) throw new Error("the walker plays no clip");
      position[0] += f.delta[0] * c + f.delta[1] * s;
      position[2] += -f.delta[0] * s + f.delta[1] * c;
      setFramePlacement(f, position, facing);
      return binding.publish(f);
    },
  };
}

/** The lowest world height among a frame's six contacts. */
const lowestContact = (f: Readonly<HumanoidAnimationFrame>) => {
  let low = Number.POSITIVE_INFINITY;
  for (let k = 0; k < f.contacts.length; k++) low = Math.min(low, frameContactWorld(f, k)[1]);
  return low;
};

describe("the frame a headless producer writes", () => {
  it("is the pose's own sole points, side and point in frame order, lifted so the lowest stands on the ground", () => {
    const frames = createAnimationFrames();
    const w = walker(frames, "adult", ADULT);
    const seen: HumanoidAnimationFrame[] = [];
    frames.observe("adult", (f) => seen.push(copyAnimationFrame(f)));
    const soles = new Float32Array(18);
    const bones = contactBones(ADULT.rest);
    let worstGap = 0;
    for (let i = 0; i < 90; i++) {
      w.step();
      // An independent read of the same pose: FootLock's side-major sole order.
      contactPoints(ADULT.rest, w.animator.rotations, ADULT.ground, soles, 0, bones);
      const f = seen[seen.length - 1] as HumanoidAnimationFrame;
      ANIMATION_CONTACTS.forEach(({ side, point }, c) => {
        const k = (side === "left" ? 0 : 3) + ["heel", "ballInner", "ballOuter"].indexOf(point);
        const p = f.contacts[c]?.position ?? [NaN, NaN, NaN];
        worstGap = Math.max(
          worstGap,
          Math.abs(p[0] - (soles[k * 3] as number)),
          Math.abs(p[1] - f.lift - (soles[k * 3 + 1] as number)),
          Math.abs(p[2] - (soles[k * 3 + 2] as number)),
        );
      });
      expect(Math.abs(lowestContact(f)), `frame ${i}: lowest sole off the ground`).toBeLessThan(
        1e-6,
      );
    }
    expect(seen).toHaveLength(90);
    expect(worstGap, "a contact is not its own sole point").toBeLessThan(1e-6);
    expect(seen.every((f) => f.clip === "walk_normal" && f.figure === "adult")).toBe(true);
    // The carry is the sum of the frames' deltas.
    const sum = seen.reduce((s, f) => s + f.delta[1], 0);
    expect(sum).toBeCloseTo((seen[seen.length - 1] as HumanoidAnimationFrame).root[1], 9);
  });

  it("holds a fully planted sole still in the world while the figure is carried past it, on a turned and moved figure", () => {
    const frames = createAnimationFrames();
    const w = walker(frames, "adult", ADULT, [2, 0, -1], 0.7);
    /** Per contact index, the world point where its current full hold began. */
    const anchor = new Map<number, [number, number, number]>();
    let worst = 0;
    let stances = 0;
    let frame = 0;
    const firstCycle = Math.round(clip("walk_normal").duration / DT);
    frames.observe("adult", (f) => {
      frame++;
      for (let k = 0; k < f.contacts.length; k++) {
        const c = f.contacts[k];
        const planted = c?.owned === true && c.hold === 1 && frame > firstCycle;
        if (!planted) {
          anchor.delete(k);
          continue;
        }
        const world = frameContactWorld(f, k);
        const start = anchor.get(k);
        if (!start) {
          anchor.set(k, world);
          stances++;
          continue;
        }
        worst = Math.max(worst, Math.hypot(world[0] - start[0], world[2] - start[2]));
      }
    });
    for (let i = 0; i < 4 * firstCycle; i++) w.step();
    expect(stances, "full holds observed after the first cycle").toBeGreaterThanOrEqual(4);
    expect(worst, `a fully planted sole moved ${(worst * 1000).toFixed(2)} mm`).toBeLessThan(0.006);
    // The figure itself went somewhere along its heading.
    const root = w.animator.root[1];
    expect(root).toBeGreaterThan(1);
  });
});

describe("the frame channel", () => {
  it("routes each figure's frames to its own observers only: an adult and a child walk, each its own stride", () => {
    const frames = createAnimationFrames();
    const adult = walker(frames, "adult", ADULT, [-1, 0, 0]);
    const child = walker(frames, "child", CHILD, [1, 0, 0]);
    const got = { adult: [] as HumanoidAnimationFrame[], child: [] as HumanoidAnimationFrame[] };
    frames.observe("adult", (f) => got.adult.push(copyAnimationFrame(f)));
    const stopChild = frames.observe("child", (f) => got.child.push(copyAnimationFrame(f)));
    const steps = Math.round(4 / DT);
    for (let i = 0; i < steps; i++) {
      adult.step();
      child.step();
    }
    expect(got.adult).toHaveLength(steps);
    expect(got.child).toHaveLength(steps);
    expect(new Set(got.adult.map((f) => f.figure))).toEqual(new Set(["adult"]));
    expect(new Set(got.child.map((f) => f.figure))).toEqual(new Set(["child"]));
    const travelled = (fs: HumanoidAnimationFrame[]) => fs[fs.length - 1]?.root[1] ?? 0;
    expect(travelled(got.child)).toBeGreaterThan(0.5);
    // The same clip carries each body by its own legs.
    expect(travelled(got.child)).toBeLessThan(0.8 * travelled(got.adult));
    // Their soles are where each figure is: the child's frames never carry the adult's place.
    expect(got.child.every((f) => f.toWorld[12] === 1)).toBe(true);
    expect(got.adult.every((f) => f.toWorld[12] === -1)).toBe(true);
    // Each body's foot is its own size: the heel-to-ball span differs.
    const span = (f: HumanoidAnimationFrame) => {
      const heel = f.contacts[0]?.position ?? [0, 0, 0];
      const ball = f.contacts[2]?.position ?? [0, 0, 0];
      return Math.hypot(heel[0] - ball[0], heel[2] - ball[2]);
    };
    expect(span(got.child[0] as HumanoidAnimationFrame)).toBeLessThan(
      0.9 * span(got.adult[0] as HumanoidAnimationFrame),
    );

    stopChild();
    stopChild();
    expect(child.step(), "the producer is still live").toBe(true);
    expect(got.child, "nothing after unsubscribe").toHaveLength(steps);
  });

  it("reuses one frame object per producer: copy what you keep", () => {
    const frames = createAnimationFrames();
    const w = walker(frames, "adult", ADULT);
    const objects = new Set<object>();
    const copies: HumanoidAnimationFrame[] = [];
    frames.observe("adult", (f) => {
      objects.add(f);
      copies.push(copyAnimationFrame(f));
    });
    for (let i = 0; i < 10; i++) w.step();
    expect(objects.size).toBe(1);
    expect(new Set(copies.map((c) => c.time)).size).toBe(10);
    expect(copies[0]?.contacts[0]?.position).not.toBe(w.writer.frame.contacts[0]?.position);
  });

  it("supersedes the producer on client replacement: its frames are dropped, observers hear it, generation rises", () => {
    const frames = createAnimationFrames();
    const releases: string[] = [];
    const seen: { generation: number; time: number }[] = [];
    frames.observe(
      "figure",
      (f) => seen.push({ generation: f.generation, time: f.time }),
      (reason, figure) => releases.push(`${figure}:${reason}`),
    );
    const first = walker(frames, "figure", ADULT);
    expect(first.step()).toBe(true);
    const old = first.binding.generation;
    expect(seen).toEqual([{ generation: old, time: expect.any(Number) }]);

    // A new client: a new producer for the same figure, while the old one still runs.
    const second = walker(frames, "figure", CHILD);
    expect(releases).toEqual(["figure:superseded"]);
    expect(first.binding.live).toBe(false);
    expect(first.step(), "a superseded producer publishes nothing").toBe(false);
    expect(first.binding.rebind(), "a dead binding cannot raise its generation").toBe(old);
    expect(seen).toHaveLength(1);
    expect(second.step()).toBe(true);
    expect((seen[1] as { generation: number }).generation).toBeGreaterThan(old);

    // A new evaluation on the new client.
    const before = second.binding.generation;
    expect(second.binding.rebind()).toBeGreaterThan(before);
    second.step();
    expect((seen[2] as { generation: number }).generation).toBe(second.binding.generation);

    second.binding.release();
    second.binding.release();
    expect(releases).toEqual(["figure:superseded", "figure:released"]);
    expect(second.step()).toBe(false);
    expect(seen).toHaveLength(3);
    const generations = seen.map((s) => s.generation);
    expect([...generations].sort((a, b) => a - b)).toEqual(generations);

    // A later producer (a remount) is delivered again, above every earlier generation.
    const third = walker(frames, "figure", ADULT);
    third.step();
    expect(seen).toHaveLength(4);
    expect((seen[3] as { generation: number }).generation).toBeGreaterThan(
      Math.max(...generations),
    );
  });

  it("drops a frame a superseded producer publishes from inside the supersession notice", () => {
    const frames = createAnimationFrames();
    const old = walker(frames, "figure", ADULT);
    const generations: number[] = [];
    let late: boolean | null = null;
    frames.observe(
      "figure",
      (f) => generations.push(f.generation),
      () => {
        late = old.step();
      },
    );
    walker(frames, "figure", ADULT);
    expect(late).toBe(false);
    expect(generations).toEqual([]);
  });

  it("starts an observer added during a delivery with the next frame, and stops one removed during it at once", () => {
    const frames = createAnimationFrames();
    const w = walker(frames, "figure", ADULT);
    const order: string[] = [];
    let stopC: (() => void) | null = null;
    let added = false;
    frames.observe("figure", (f) => {
      order.push(`a${f.time.toFixed(4)}`);
      stopC?.();
      if (!added) {
        added = true;
        frames.observe("figure", (g) => order.push(`d${g.time.toFixed(4)}`));
      }
    });
    frames.observe("figure", (f) => order.push(`b${f.time.toFixed(4)}`));
    stopC = frames.observe("figure", (f) => order.push(`c${f.time.toFixed(4)}`));
    w.step();
    const t1 = w.animator.playing?.time.toFixed(4);
    w.step();
    const t2 = w.animator.playing?.time.toFixed(4);
    expect(order).toEqual([`a${t1}`, `b${t1}`, `a${t2}`, `b${t2}`, `d${t2}`]);
  });

  it("delivers to every observer before rethrowing the first exception, and keeps delivering after", () => {
    const frames = createAnimationFrames();
    const w = walker(frames, "figure", ADULT);
    const sentinel = new Error("observer sentinel");
    const reached: string[] = [];
    let throwing = true;
    frames.observe("figure", () => {
      reached.push("first");
      if (throwing) throw sentinel;
    });
    frames.observe("figure", () => {
      reached.push("second");
      if (throwing) throw new Error("a later exception is not the one rethrown");
    });
    expect(() => w.step()).toThrow(sentinel);
    expect(reached).toEqual(["first", "second"]);
    throwing = false;
    expect(w.step()).toBe(true);
    expect(reached).toEqual(["first", "second", "first", "second"]);
  });

  it("delivers a frame published from inside an observer completely before the outer delivery continues", () => {
    const frames = createAnimationFrames();
    const w = walker(frames, "figure", ADULT);
    const order: string[] = [];
    let nested = false;
    frames.observe("figure", (f) => {
      const t = f.time.toFixed(4);
      order.push(`a${t}`);
      if (!nested) {
        nested = true;
        w.step();
      }
    });
    frames.observe("figure", (f) => order.push(`b${f.time.toFixed(4)}`));
    w.step();
    expect(order).toHaveLength(4);
    expect(order[0]?.[0]).toBe("a");
    expect(order[1]?.[0]).toBe("a");
    expect(order[2]?.[0]).toBe("b");
    // The inner frame reached both observers; the outer resumes on the reused object.
    expect(order[1]?.slice(1)).toBe(order[2]?.slice(1));
    expect(Number(order[1]?.slice(1))).toBeGreaterThan(Number(order[0]?.slice(1)));
  });
});

const HANDOFF: InteractionDefinition = {
  id: "handoff",
  tags: ["object.handoff"],
  audience: "all",
  roles: [
    {
      name: "giver",
      takes: "figure",
      affordances: ["hand.R"],
      uses: ["arm.R", "hand.R"],
      track: { act: { clip: "handoff" } },
    },
    {
      name: "receiver",
      takes: "figure",
      affordances: ["hand.R"],
      uses: ["arm.R", "hand.R"],
      track: { act: { clip: "handoff" } },
    },
  ],
  contacts: [{ name: "hands", a: "giver:hand.R", b: "receiver:hand.R", during: ["act"] }],
};

const WITH_OBJECT: InteractionDefinition = {
  ...HANDOFF,
  id: "handoff-counted",
  roles: [...HANDOFF.roles, { name: "counter", takes: "object" }],
};

/** An adult and a child in one registry, each with a walking producer, and a handoff between them. */
function session() {
  const presence = createPresenceRegistry();
  const runtime = createInteractions(presence, { seed: 7, clipLength: () => 2 });
  runtime.define([HANDOFF, WITH_OBJECT]);
  presence.set(presenceOf("adult", true, -0.4));
  presence.set(presenceOf("child", false, 0.4));
  presence.set(presenceOf("bystander", true, 3));
  const producers = [
    walker(presence.frames, "adult", ADULT, [-0.4, 0, 0]),
    walker(presence.frames, "child", CHILD, [0.4, 0, 0]),
    walker(presence.frames, "bystander", ADULT, [3, 0, 0]),
  ];
  const interaction = runtime.propose("handoff", { giver: "adult", receiver: "child" });
  presence.tick(0);
  const got = { giver: [] as HumanoidAnimationFrame[], receiver: [] as HumanoidAnimationFrame[] };
  interaction.observeFrames("giver", (f) => got.giver.push(copyAnimationFrame(f)));
  interaction.observeFrames("receiver", (f) => got.receiver.push(copyAnimationFrame(f)));
  const stepAll = () => {
    for (const p of producers) p.step();
  };
  return { presence, runtime, interaction, got, stepAll, producers };
}

describe("an interaction's frame observers", () => {
  it("receive each role's own figure's frames while the interaction runs, and none after cancel", () => {
    const { interaction, got, stepAll } = session();
    expect(interaction.phase).toBe("act");
    for (let i = 0; i < 30; i++) stepAll();
    expect(got.giver).toHaveLength(30);
    expect(got.receiver).toHaveLength(30);
    expect(new Set(got.giver.map((f) => f.figure))).toEqual(new Set(["adult"]));
    expect(new Set(got.receiver.map((f) => f.figure))).toEqual(new Set(["child"]));
    // Both participants' soles are on the ground where each stands.
    for (const f of [...got.giver, ...got.receiver])
      expect(Math.abs(lowestContact(f))).toBeLessThan(1e-6);
    expect(got.giver[29]?.toWorld[12]).toBeCloseTo(-0.4, 9);
    expect(got.receiver[29]?.toWorld[12]).toBeCloseTo(0.4, 9);

    interaction.cancel();
    for (let i = 0; i < 10; i++) stepAll();
    expect(got.giver).toHaveLength(30);
    expect(got.receiver).toHaveLength(30);
    const late: HumanoidAnimationFrame[] = [];
    const stop = interaction.observeFrames("giver", (f) => late.push(f));
    stepAll();
    stop();
    expect(late, "an ended interaction observes nothing").toEqual([]);
  });

  it("end with the interaction's own completion", () => {
    const { presence, interaction, got, stepAll } = session();
    let ended = -1;
    for (let tick = 1; tick <= 40; tick++) {
      stepAll();
      presence.tick(tick / 10);
      if (interaction.phase === "ended" && ended < 0) ended = got.giver.length;
    }
    expect(ended, "the handoff completes its act and release").toBeGreaterThan(0);
    expect(got.giver, "no frame after the end").toHaveLength(ended);
    expect(got.receiver).toHaveLength(ended);
  });

  it("end at detach, before the cancellation reaches any listener", () => {
    const { runtime, got, stepAll } = session();
    stepAll();
    let duringCancel = -1;
    runtime.on("adult", (e) => {
      if (e.type !== "cancelled") return;
      stepAll();
      duringCancel = got.giver.length;
    });
    runtime.detach();
    expect(duringCancel).toBe(1);
    stepAll();
    expect(got.giver).toHaveLength(1);
    expect(got.receiver).toHaveLength(1);
  });

  it("never deliver the frames of another figure that took a participant's id, even before the next tick", () => {
    const { presence, interaction, got, stepAll } = session();
    stepAll();
    presence.remove("adult");
    presence.set(presenceOf("adult", true, -0.4));
    stepAll();
    expect(got.giver, "the newcomer's frame").toHaveLength(1);
    expect(got.receiver).toHaveLength(2);
    presence.tick(0.1);
    expect(interaction.phase).toBe("ended");
    stepAll();
    expect(got.receiver).toHaveLength(2);
  });

  it("refuse a role that is not a figure", () => {
    const { presence, runtime } = session();
    presence.setObject({
      id: "counter",
      kind: "object",
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      frames: {},
      tags: [],
      state: {},
    });
    runtime.running()[0]?.cancel();
    const counted = runtime.propose("handoff-counted", {
      giver: "adult",
      receiver: "child",
      counter: "counter",
    });
    expect(() => counted.observeFrames("counter", () => {})).toThrow("does not take a figure");
  });

  it("follow two of twenty walking figures exactly, one frame each per step", () => {
    const presence = createPresenceRegistry();
    const runtime = createInteractions(presence, { seed: 1, clipLength: () => 2 });
    runtime.define([HANDOFF]);
    const ids = Array.from({ length: 20 }, (_, n) => `figure-${n}`);
    const producers = ids.map((id, n) => {
      presence.set(presenceOf(id, n % 2 === 0, n * 0.8));
      return walker(presence.frames, id, n % 3 === 0 ? CHILD : ADULT, [n * 0.8, 0, 0]);
    });
    const interaction = runtime.propose("handoff", { giver: "figure-3", receiver: "figure-17" });
    presence.tick(0);
    const seen: string[] = [];
    interaction.observeFrames("giver", (f) => seen.push(f.figure));
    interaction.observeFrames("receiver", (f) => seen.push(f.figure));
    for (let i = 0; i < 5; i++) for (const p of producers) p.step();
    expect(seen.filter((id) => id === "figure-3")).toHaveLength(5);
    expect(seen.filter((id) => id === "figure-17")).toHaveLength(5);
    expect(seen).toHaveLength(10);
  });
});
