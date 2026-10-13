import { describe, expect, it } from "vitest";
import { armStretch, gripMeeting } from "../src/interaction/contacts.ts";
import {
  definitionProblems,
  type InteractionDefinition,
  type Length,
  resolveLength,
} from "../src/interaction/definition.ts";
import {
  createInteractions,
  type Interaction,
  type InteractionEvent,
  type SlotPlacement,
} from "../src/interaction/runtime.ts";
import {
  createPresenceRegistry,
  type FigureMeasures,
  type FigurePresence,
  type PresenceRegistry,
  type Vec3,
} from "../src/presence/presence.ts";
import { AVERAGE, figure } from "./interactionHarness.ts";

const TALL: FigureMeasures = { reach: 0.8, shoulderHeight: 1.55, hipHeight: 1.0, eyeHeight: 1.7 };
const SHORT: FigureMeasures = { reach: 0.6, shoulderHeight: 1.25, hipHeight: 0.8, eyeHeight: 1.38 };

const standBack = (of: string): Length => ({ of, measure: "reach", times: -0.7 });

/** The handshake of docs/INTERACTIONS.md. */
const HANDSHAKE: InteractionDefinition = {
  id: "handshake",
  tags: ["greeting.handshake"],
  audience: "all",
  roles: [
    {
      name: "initiator",
      takes: "figure",
      affordances: ["hand.R"],
      uses: ["arm.R", "hand.R", "gaze"],
      slot: { offset: [0, 0, standBack("initiator")], yaw: 0, tolerance: 0.05 },
      track: { act: { clip: "handshake.shake" } },
    },
    {
      name: "responder",
      takes: "figure",
      affordances: ["hand.R"],
      uses: ["arm.R", "hand.R", "gaze"],
      slot: { offset: [0, 0, standBack("responder")], yaw: 0, tolerance: 0.05 },
      track: { act: { clip: "handshake.shake" } },
    },
  ],
  reference: { between: ["initiator", "responder"] },
  contacts: [{ name: "grip", a: "initiator:hand.R", b: "responder:hand.R", during: ["act"] }],
  beats: [
    { name: "grip", at: 0.3, effects: [{ set: "initiator:hand.R", change: { closure: 1 } }] },
    {
      name: "let-go",
      at: { fraction: 0.9 },
      effects: [{ set: "initiator:hand.R", change: { closure: 0 } }],
    },
  ],
  alignSeconds: 0.2,
  releaseSeconds: 0.2,
};

const clipLength = (id: string) => (id === "handshake.shake" ? 2 : 1);

const FAR = 3;

function setup(seed = 1) {
  const presence = createPresenceRegistry();
  const closures: string[] = [];
  const runtime = createInteractions(presence, {
    seed,
    clipLength,
    applyChange: (who, affordance, change) =>
      closures.push(`${who}:${affordance}:${change.closure}`),
  });
  runtime.define([HANDSHAKE]);
  presence.set(figure("tall", true, -FAR, TALL));
  presence.set(figure("short", true, FAR, SHORT));
  return { presence, runtime, closures };
}

const move = (presence: PresenceRegistry, id: string, to: Vec3, measures: FigureMeasures) =>
  presence.set(figure(id, true, to[0], measures, to[2]));

/** Walks the roles' figures (those named in `movers`) toward their slots for one tick of `dt` seconds at 1 m/s. */
function walk(
  presence: PresenceRegistry,
  i: Interaction,
  movers: Partial<Record<"initiator" | "responder", FigureMeasures>>,
  dt: number,
) {
  for (const role of ["initiator", "responder"] as const) {
    const measures = movers[role];
    if (!measures) continue;
    const id = i.roles[role] as string;
    const here = (presence.get(id) as FigurePresence).position;
    const slot = i.slot(role) as SlotPlacement;
    const dx = slot.position[0] - here[0];
    const dz = slot.position[2] - here[2];
    const d = Math.hypot(dx, dz);
    if (d === 0) continue;
    const step = Math.min(d, dt);
    move(presence, id, [here[0] + (dx / d) * step, 0, here[2] + (dz / d) * step], measures);
  }
}

const BOTH = { initiator: TALL, responder: SHORT };

/** Puts both figures exactly on their slots. */
function standOnSlots(presence: PresenceRegistry, i: Interaction) {
  move(presence, "tall", (i.slot("initiator") as SlotPlacement).position, TALL);
  move(presence, "short", (i.slot("responder") as SlotPlacement).position, SHORT);
}

describe("lengths in a body's own measures", () => {
  const measuresOf = (role: string) => (role === "a" ? TALL : role === "b" ? SHORT : undefined);

  it("resolves metres as they are and measures times a factor of the named role's own", () => {
    expect(resolveLength(0.25, measuresOf)).toBe(0.25);
    expect(resolveLength({ of: "a", measure: "reach", times: 0.5 }, measuresOf)).toBeCloseTo(
      0.4,
      9,
    );
    expect(resolveLength({ of: "b", measure: "reach", times: 0.5 }, measuresOf)).toBeCloseTo(
      0.3,
      9,
    );
    expect(resolveLength({ of: "a", measure: "shoulderHeight", times: 1 }, measuresOf)).toBe(1.55);
    expect(resolveLength({ of: "nobody", measure: "reach", times: 1 }, measuresOf)).toBeUndefined();
  });

  it("rejects a length that names no figure role, no measure or a number that is not finite", () => {
    expect(definitionProblems(HANDSHAKE)).toEqual([]);
    const withOffset = (...offset: [Length, Length, Length]): InteractionDefinition => ({
      ...HANDSHAKE,
      roles: HANDSHAKE.roles.map((r) => ({
        ...r,
        slot: { offset, yaw: 0, tolerance: 0.05 },
      })),
    });
    expect(
      definitionProblems(withOffset(0, 0, { of: "nobody", measure: "reach", times: 1 })),
    ).toContain("role initiator measures nobody, which is not a figure role");
    expect(
      definitionProblems(
        withOffset(0, 0, { of: "initiator", measure: "wingspan" as "reach", times: 1 }),
      ),
    ).toContain("role initiator measures wingspan, which is not a measure");
    expect(definitionProblems(withOffset(Number.NaN, 0, 0))).toContain(
      "role initiator has a slot offset that is not finite",
    );
    expect(
      definitionProblems({
        ...HANDSHAKE,
        roles: HANDSHAKE.roles.map((r) => ({
          ...r,
          slot: {
            offset: r.slot?.offset ?? [0, 0, 0],
            yaw: Number.POSITIVE_INFINITY,
            tolerance: r.slot?.tolerance ?? 0,
          },
        })),
      }),
    ).toContain("role initiator has a slot yaw that is not finite");
    expect(
      definitionProblems({
        ...HANDSHAKE,
        roles: HANDSHAKE.roles.map((r) => ({
          ...r,
          slot: { offset: r.slot?.offset ?? [0, 0, 0], yaw: r.slot?.yaw ?? 0, tolerance: -0.01 },
        })),
      }),
    ).toContain("role initiator has a slot tolerance that is not a non-negative finite number");
    expect(
      definitionProblems({
        ...HANDSHAKE,
        roles: HANDSHAKE.roles.map((r) => ({
          ...r,
          track: { act: { clip: "handshake.shake", rate: 0 } },
        })),
      }),
    ).toContain(
      "role initiator has a track for act with a rate that is not a positive finite number",
    );
    expect(
      definitionProblems({
        ...HANDSHAKE,
        contacts: [...(HANDSHAKE.contacts ?? []), ...(HANDSHAKE.contacts ?? [])],
      }),
    ).toContain("contact grip is declared twice");
  });
});

describe("the handshake's slots", () => {
  it("puts each figure at its own reach back from the midpoint, facing the other", () => {
    const { presence, runtime } = setup();
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    expect(i.phase).toBe("approach");
    const a = i.slot("initiator") as SlotPlacement;
    const b = i.slot("responder") as SlotPlacement;
    // The midpoint of where they stood is the origin; each is 0.7 of its own reach back from it.
    expect(a.position[0]).toBeCloseTo(-0.7 * TALL.reach, 9);
    expect(b.position[0]).toBeCloseTo(0.7 * SHORT.reach, 9);
    expect(a.position[2]).toBeCloseTo(0, 9);
    // Facing each other: the first along +x toward the second, the second back along -x.
    expect(a.facing).toEqual([1, 0, 0]);
    expect(b.facing[0]).toBeCloseTo(-1, 9);
    expect(b.facing[2]).toBeCloseTo(0, 9);
    // A taller body stands farther back.
    expect(Math.abs(a.position[0])).toBeGreaterThan(Math.abs(b.position[0]));
  });

  it("is the midpoint itself for a zero offset, whatever the line between them", () => {
    const presence = createPresenceRegistry();
    const runtime = createInteractions(presence, { seed: 1, clipLength });
    const centred: InteractionDefinition = {
      ...HANDSHAKE,
      roles: HANDSHAKE.roles.map((r) => ({
        ...r,
        slot: { offset: [0, 0, 0], yaw: 0, tolerance: 0.05 },
      })),
    };
    runtime.define([centred]);
    presence.set(figure("tall", true, 1, TALL, 2));
    presence.set(figure("short", true, 3, SHORT, 6));
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    for (const role of ["initiator", "responder"]) {
      const s = i.slot(role) as SlotPlacement;
      expect(s.position).toEqual([2, 0, 4]);
    }
    const along = Math.hypot(2, 4);
    expect((i.slot("initiator") as SlotPlacement).facing[0]).toBeCloseTo(2 / along, 9);
    expect((i.slot("initiator") as SlotPlacement).facing[2]).toBeCloseTo(4 / along, 9);
    expect((i.slot("responder") as SlotPlacement).facing[2]).toBeCloseTo(-4 / along, 9);
  });

  it("offsets to the frame's left and turns by the yaw", () => {
    const presence = createPresenceRegistry();
    const runtime = createInteractions(presence, { seed: 1, clipLength });
    const side: InteractionDefinition = {
      ...HANDSHAKE,
      roles: HANDSHAKE.roles.map((r) => ({
        ...r,
        slot: { offset: [0.2, 0.1, 0.3], yaw: Math.PI / 2, tolerance: 0.05 },
      })),
    };
    runtime.define([side]);
    presence.set(figure("tall", true, -2, TALL));
    presence.set(figure("short", true, 2, SHORT));
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    // The initiator faces +x, so its left is -z: 0.2 left, 0.3 ahead, 0.1 up.
    const s = i.slot("initiator") as SlotPlacement;
    expect(s.position[0]).toBeCloseTo(0.3, 9);
    expect(s.position[1]).toBeCloseTo(0.1, 9);
    expect(s.position[2]).toBeCloseTo(-0.2, 9);
    // A quarter turn toward its left leaves it facing -z.
    expect(s.facing[0]).toBeCloseTo(0, 9);
    expect(s.facing[2]).toBeCloseTo(-1, 9);
  });

  it("holds the targets still once approach begins, however the figures then move", () => {
    const { presence, runtime } = setup();
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    const before = i.slot("responder") as SlotPlacement;
    const was = [...before.position];
    move(presence, "tall", [-0.5, 0, 4], TALL);
    expect((i.slot("responder") as SlotPlacement).position).toEqual(was);
  });
});

describe("a handshake between two figures", () => {
  it("is asked of both, and declined for both when either refuses", () => {
    const { presence, runtime } = setup();
    const asked: string[] = [];
    runtime.policy("tall", () => {
      asked.push("tall");
      return true;
    });
    runtime.policy("short", () => {
      asked.push("short");
      return false;
    });
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    const seen: string[] = [];
    for (const who of ["tall", "short"])
      runtime.on(who, (e) => seen.push(`${who}:${e.type}:${e.reason ?? ""}`));
    presence.tick(0);
    presence.tick(0.1);
    expect(asked).toEqual(["tall", "short"]);
    expect(i.phase).toBe("ended");
    expect(seen).toEqual(["tall:declined:declined", "short:declined:declined"]);
  });

  it("waits for a late answer, then runs", async () => {
    const { presence, runtime } = setup();
    runtime.policy("short", async () => true);
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    expect(i.phase).toBe("proposed");
    await Promise.resolve();
    presence.tick(0.1);
    expect(i.phase).toBe("approach");
  });

  it("ends approach only when both figures have walked in, then aligns, acts and releases", () => {
    const { presence, runtime } = setup();
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    const log: Record<string, string[]> = { tall: [], short: [] };
    let now = 0;
    for (const who of ["tall", "short"])
      runtime.on(who, (e) =>
        log[who]?.push(`${now.toFixed(1)} ${e.type}:${e.phase ?? e.beat ?? ""}`),
      );
    // Only the tall figure walks in for eight seconds: approach waits for the short one.
    for (let k = 0; k <= 80; k++) {
      now = k / 10;
      presence.tick(now);
      walk(presence, i, { initiator: TALL }, 0.1);
    }
    const tallSlot = i.slot("initiator") as SlotPlacement;
    const tallAt = (presence.get("tall") as FigurePresence).position;
    expect(
      Math.hypot(tallAt[0] - tallSlot.position[0], tallAt[2] - tallSlot.position[2]),
    ).toBeLessThan(0.05);
    expect(i.phase).toBe("approach");
    // The short figure walks in too: the phase moves on the tick both are placed.
    let placedAt = -1;
    for (let k = 81; k <= 200 && i.phase !== "ended"; k++) {
      now = k / 10;
      presence.tick(now);
      walk(presence, i, BOTH, 0.1);
      if (i.phase === "align" && placedAt < 0) placedAt = now;
    }
    expect(placedAt).toBeGreaterThan(8);
    expect(i.phase).toBe("ended");
    const order = (who: string) => (log[who] ?? []).map((l) => l.split(" ")[1]);
    expect(order("tall")).toEqual([
      "accepted:",
      "phase:approach",
      "phase:align",
      "phase:act",
      "beat:grip",
      "beat:let-go",
      "phase:release",
      "ended:",
    ]);
    // Both are told the same thing on the same tick.
    expect(log.short).toEqual(log.tall);
  });

  it("runs both roles' tracks on one clock: their times agree to the tick", () => {
    const { presence, runtime } = setup();
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    standOnSlots(presence, i);
    const seen: [number, number][] = [];
    const beatTicks: Record<string, number[]> = { tall: [], short: [] };
    let now = 0.1;
    for (const who of ["tall", "short"])
      runtime.on(who, (e) => e.beat === "grip" && beatTicks[who]?.push(now));
    for (let k = 2; k <= 60 && i.phase !== "ended"; k++) {
      now = k / 10;
      presence.tick(now);
      if (i.phase === "act")
        seen.push([i.trackTime("initiator") as number, i.trackTime("responder") as number]);
    }
    expect(seen.length).toBeGreaterThan(10);
    for (const [a, b] of seen) expect(a).toBe(b);
    // The act's time runs on, tick by tick, in both.
    expect(seen.at(-1)?.[0]).toBeGreaterThan(seen[0]?.[0] as number);
    expect(beatTicks.tall).toEqual(beatTicks.short);
    expect(beatTicks.tall).toHaveLength(1);
  });

  it("scales a role's clip time by its rate and wraps a loop at its length", () => {
    const presence = createPresenceRegistry();
    const runtime = createInteractions(presence, { seed: 1, clipLength });
    const paced: InteractionDefinition = {
      id: "paced",
      tags: ["greeting.handshake"],
      audience: "all",
      roles: [
        { name: "initiator", takes: "figure", track: { act: { clip: "handshake.shake" } } },
        {
          name: "responder",
          takes: "figure",
          track: { act: { clip: "handshake.shake", rate: 2, loop: true } },
        },
      ],
    };
    runtime.define([paced]);
    presence.set(figure("tall", true, -1, TALL));
    presence.set(figure("short", true, 1, SHORT));
    const i = runtime.propose("paced", { initiator: "tall", responder: "short" });
    expect(i.trackTime("initiator")).toBeNull();
    for (let k = 0; k <= 12; k++) presence.tick(k / 10);
    expect(i.phase).toBe("act");
    expect(i.time).toBeCloseTo(1.2, 9);
    expect(i.trackTime("initiator")).toBeCloseTo(1.2, 9);
    // Twice as fast, and 2.4 s into a 2 s loop is 0.4 s into the next.
    expect(i.trackTime("responder")).toBeCloseTo(0.4, 9);
  });

  it("claims the arm and hand: a second handshake with either figure is preempted, and frees them after", () => {
    const { presence, runtime } = setup();
    presence.set(figure("third", true, 6, AVERAGE));
    const first = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    const second = runtime.propose("handshake", { initiator: "third", responder: "short" });
    const reasons: (string | undefined)[] = [];
    runtime.on("third", (e) => reasons.push(e.reason));
    presence.tick(0.2);
    expect(second.phase).toBe("ended");
    expect(reasons).toEqual(["preempted"]);
    first.cancel();
    const third = runtime.propose("handshake", { initiator: "third", responder: "short" });
    presence.tick(0.3);
    expect(third.phase).toBe("approach");
  });

  it.each([
    ["tall", "initiator"],
    ["short", "responder"],
  ])("is cancelled for both with `left` when the %s figure leaves", (leaver) => {
    const { presence, runtime } = setup();
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    standOnSlots(presence, i);
    presence.tick(0.2);
    presence.tick(0.3);
    const reasons: string[] = [];
    for (const who of ["tall", "short"])
      runtime.on(who, (e) => e.type === "cancelled" && reasons.push(`${who}:${e.reason}`));
    presence.remove(leaver);
    presence.tick(0.4);
    expect(i.phase).toBe("ended");
    expect(reasons.sort()).toEqual(["short:left", "tall:left"]);
    // Its claims are released: the figure who stayed can shake another hand at once.
    const stayed = leaver === "tall" ? "short" : "tall";
    presence.set(figure("fresh", true, 0, AVERAGE, 9));
    const next = runtime.propose("handshake", { initiator: stayed, responder: "fresh" });
    presence.tick(0.5);
    expect(next.phase).toBe("approach");
  });
});

describe("the hand-to-hand contact", () => {
  it("meets a tall and a short figure at one point within a centimetre, between hip and shoulder", () => {
    const { presence, runtime } = setup();
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    // They stood at ±FAR, so the midpoint they are placed around is the origin.
    const origin: Vec3 = [0, 0, 0];
    standOnSlots(presence, i);
    for (let k = 2; k <= 10 && i.phase !== "act"; k++) presence.tick(k / 10);
    expect(i.phase).toBe("act");
    const a = i.contactTarget("grip", "initiator", [0, 0, 0]) as Vec3;
    const b = i.contactTarget(0, "responder", [0, 0, 0]) as Vec3;
    for (let k = 0; k < 3; k++)
      expect(Math.abs((a[k] as number) - (b[k] as number))).toBeLessThan(0.01);
    // On the line between them, where the slots split it: the midpoint they were placed around.
    expect(Math.hypot(a[0] - origin[0], a[2] - origin[2])).toBeLessThan(0.01);
    // At a height both can hold: above both hips, below both shoulders.
    expect(a[1]).toBeGreaterThan(Math.max(TALL.hipHeight, SHORT.hipHeight));
    expect(a[1]).toBeLessThan(Math.min(TALL.shoulderHeight, SHORT.shoulderHeight));
    // Within each arm's reach, each stretched the same fraction of its own length.
    const tall = presence.get("tall") as FigurePresence;
    const short = presence.get("short") as FigurePresence;
    expect(armStretch(tall, a)).toBeLessThan(1);
    expect(armStretch(short, a)).toBeLessThan(1);
  });

  it("keeps the point near its place when a figure stands a little off its slot", () => {
    const { presence, runtime } = setup();
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    const t = (i.slot("initiator") as SlotPlacement).position;
    // 3 cm off along the line, within the 5 cm tolerance.
    move(presence, "tall", [t[0] - 0.03, 0, t[2]], TALL);
    move(presence, "short", (i.slot("responder") as SlotPlacement).position, SHORT);
    for (let k = 2; k <= 10 && i.phase !== "act"; k++) presence.tick(k / 10);
    expect(i.phase).toBe("act");
    const m = i.contactTarget("grip", "initiator") as Vec3;
    // The split follows reach, so the point moves only a part of the 3 cm.
    expect(Math.abs(m[0])).toBeLessThan(0.03);
    expect(armStretch(presence.get("tall") as FigurePresence, m)).toBeLessThan(1);
    expect(armStretch(presence.get("short") as FigurePresence, m)).toBeLessThan(1);
  });

  it("is asked for during act only, by an existing contact and one of its roles", () => {
    const { presence, runtime } = setup();
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    expect(i.contactTarget("grip", "initiator")).toBeNull();
    presence.tick(0);
    presence.tick(0.1);
    expect(i.phase).toBe("approach");
    expect(i.contactTarget("grip", "initiator")).toBeNull();
    standOnSlots(presence, i);
    for (let k = 2; k <= 10 && i.phase !== "act"; k++) presence.tick(k / 10);
    expect(i.contactTarget("grip", "initiator")).not.toBeNull();
    expect(i.contactTarget("nope", "initiator")).toBeNull();
    expect(i.contactTarget(3, "initiator")).toBeNull();
    expect(i.contactTarget("grip", "bystander")).toBeNull();
    for (let k = 11; k <= 60 && i.phase !== "ended"; k++) presence.tick(k / 10);
    expect(i.contactTarget("grip", "initiator")).toBeNull();
  });

  it("writes into the array it is given and returns it, so a frame allocates nothing", () => {
    const { presence, runtime } = setup();
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    standOnSlots(presence, i);
    for (let k = 2; k <= 10 && i.phase !== "act"; k++) presence.tick(k / 10);
    const out: Vec3 = [0, 0, 0];
    expect(i.contactTarget("grip", "initiator", out)).toBe(out);
    const same = [...out];
    out.fill(9);
    expect(i.contactTarget("grip", "initiator", out)).toBe(out);
    expect(out).toEqual(same);
    const place: SlotPlacement = { position: [0, 0, 0], facing: [0, 0, 1] };
    expect(i.slot("initiator", place)).toBe(place);
  });

  it("follows the figures as they move, from the presence they publish", () => {
    const { presence, runtime } = setup();
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    presence.tick(0);
    presence.tick(0.1);
    standOnSlots(presence, i);
    for (let k = 2; k <= 10 && i.phase !== "act"; k++) presence.tick(k / 10);
    const before = [...(i.contactTarget("grip", "initiator") as Vec3)];
    move(
      presence,
      "tall",
      [(presence.get("tall") as FigurePresence).position[0] - 0.04, 0, 0],
      TALL,
    );
    const after = i.contactTarget("grip", "initiator") as Vec3;
    expect(after[0]).not.toBeCloseTo(before[0] as number, 3);
  });
});

describe("gripMeeting", () => {
  const at = (x: number, m: FigureMeasures) => figure(`p${x}`, true, x, m);

  it("splits the ground between two figures in proportion to their reach", () => {
    const out: Vec3 = [0, 0, 0];
    gripMeeting(at(-1, TALL), at(1, SHORT), out);
    // The tall figure's share of the 2 m is 0.8 / (0.8 + 0.6).
    expect(out[0]).toBeCloseTo(-1 + (2 * 0.8) / 1.4, 9);
    gripMeeting(at(-1, AVERAGE), at(1, AVERAGE), out);
    expect(out[0]).toBeCloseTo(0, 9);
  });

  it("rests at the mean of the two resting hand heights", () => {
    const out: Vec3 = [0, 0, 0];
    // Each rests half way from hip to shoulder: 1.275 and 1.025.
    gripMeeting(at(-1, TALL), at(1, SHORT), out);
    expect(out[1]).toBeCloseTo(1.15, 9);
  });

  it("holds the height between the higher hip and the lower shoulder", () => {
    const out: Vec3 = [0, 0, 0];
    const low: FigureMeasures = { reach: 0.6, shoulderHeight: 1.5, hipHeight: 0.7, eyeHeight: 1.6 };
    const slight: FigureMeasures = {
      reach: 0.6,
      shoulderHeight: 1.0,
      hipHeight: 0.95,
      eyeHeight: 1.1,
    };
    // The mean resting height, 1.0375, is above the slight figure's shoulder: held at 1.0.
    gripMeeting(at(-1, low), at(1, slight), out);
    expect(out[1]).toBeCloseTo(1.0, 9);
    // And a mean (0.95) below the higher hip (1.0) is raised to it.
    const stiff: FigureMeasures = {
      reach: 0.6,
      shoulderHeight: 1.1,
      hipHeight: 1.0,
      eyeHeight: 1.2,
    };
    const deep: FigureMeasures = {
      reach: 0.6,
      shoulderHeight: 1.5,
      hipHeight: 0.2,
      eyeHeight: 1.6,
    };
    gripMeeting(at(-1, stiff), at(1, deep), out);
    expect(out[1]).toBeCloseTo(1.0, 9);
  });

  it("falls back to the mean when no height suits both, rather than inventing one", () => {
    const out: Vec3 = [0, 0, 0];
    const child: FigureMeasures = { reach: 0.4, shoulderHeight: 0.9, hipHeight: 0.5, eyeHeight: 1 };
    // The adult's hip (1.0) is above the child's shoulder (0.9): no overlap.
    gripMeeting(at(-1, TALL), at(1, child), out);
    expect(out[1]).toBeCloseTo((1.275 + 0.7) / 2, 9);
  });

  it("reports an arm's stretch as a fraction of its reach", () => {
    const p = at(0, AVERAGE);
    // Straight ahead at shoulder height, 0.35 m: half the 0.7 m reach.
    expect(armStretch(p, [0, 1.45, 0.35])).toBeCloseTo(0.5, 9);
    expect(armStretch(p, [0, 1.45, 0.7])).toBeCloseTo(1, 9);
    expect(armStretch({ ...p, measures: { ...AVERAGE, reach: 0 } }, [0, 1.45, 0.1])).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("determinism of a handshake", () => {
  const frames = (seed: number) => {
    const { presence, runtime, closures } = setup(seed);
    const i = runtime.propose("handshake", { initiator: "tall", responder: "short" });
    const out: string[] = [];
    runtime.on("tall", (e: InteractionEvent) => out.push(`${e.type}:${e.phase ?? e.beat ?? ""}`));
    for (let k = 0; k <= 200 && i.phase !== "ended"; k++) {
      presence.tick(k / 10);
      walk(presence, i, BOTH, 0.1);
      const m = i.contactTarget("grip", "responder");
      out.push(
        `${i.phase} ${i.time.toFixed(2)} ${i.trackTime("initiator")} ${m?.map((c) => c.toFixed(4))}`,
      );
    }
    return { log: out.join("\n"), seed: i.seed, closures: closures.join(",") };
  };

  it("gives the same frames for the same seed", () => {
    const a = frames(5);
    expect(a.log).toContain("act");
    expect(frames(5)).toEqual(a);
    expect(a.closures).toBe("tall:hand.R:1,tall:hand.R:0");
  });

  it("gives another interaction seed for another runtime seed, and the same frames", () => {
    const a = frames(5);
    const b = frames(6);
    expect(b.seed).not.toBe(a.seed);
    // Nothing in a handshake is chosen by seed, so the frames do not depend on it.
    expect(b.log).toBe(a.log);
  });
});
