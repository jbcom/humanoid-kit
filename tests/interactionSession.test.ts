import { describe, expect, it } from "vitest";
import { gripMeeting } from "../src/interaction/contacts.ts";
import type { InteractionDefinition } from "../src/interaction/definition.ts";
import { createInteractions } from "../src/interaction/runtime.ts";
import {
  createPresenceRegistry,
  type FigureMeasures,
  type FigurePresence,
} from "../src/presence/presence.ts";

const v = (x = 0, y = 0, z = 0): [number, number, number] => [x, y, z];

const tall: FigureMeasures = {
  reach: 0.8,
  shoulderHeight: 1.55,
  hipHeight: 1,
  eyeHeight: 1.7,
};
const short: FigureMeasures = {
  reach: 0.6,
  shoulderHeight: 1.25,
  hipHeight: 0.8,
  eyeHeight: 1.38,
};

function figure(id: string, x: number, measures: FigureMeasures): FigurePresence {
  return {
    id,
    position: v(x),
    facing: v(0, 0, 1),
    bounds: { min: v(x - 0.3, 0, -0.2), max: v(x + 0.3, 1.7, 0.2) },
    anchors: {
      head: v(x, 1.6),
      face: v(x, 1.55, 0.1),
      chest: v(x, 1.3, 0.1),
      leftHand: v(x - 0.3, 1),
      rightHand: v(x + 0.3, 1),
      leftFoot: v(x - 0.1),
      rightFoot: v(x + 0.1),
    },
    measures,
    footprint: { points: [[x, 0]], radius: 0.15 },
    appearance: { albedo: v(0.4, 0.3, 0.25), luminance: 0.3, specular: 0.028 },
    faceRadius: 0.1,
    adult: true,
  };
}

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

describe("neutral interaction session", () => {
  it("emits lifecycle events and exposes a shared, body-scaled hand target", () => {
    const presence = createPresenceRegistry();
    const runtime = createInteractions(presence, { seed: 4, clipLength: () => 2 });
    runtime.define([HANDOFF]);
    presence.set(figure("tall", -1, tall));
    presence.set(figure("short", 1, short));
    const events: string[] = [];
    runtime.on("tall", (event) => events.push(event.type));
    const session = runtime.propose("handoff", { giver: "tall", receiver: "short" });

    presence.tick(0);
    expect(session.phase).toBe("act");
    expect(events).toEqual(["accepted", "phase"]);
    expect(session.trackTime("giver")).toBe(0);

    const target = session.contactTarget("hands", "giver");
    expect(target).not.toBeNull();
    const tallPresence = presence.get("tall");
    const shortPresence = presence.get("short");
    if (!tallPresence || !shortPresence) throw new Error("test figures must be present");
    expect(target).toEqual(gripMeeting(tallPresence, shortPresence, [0, 0, 0]));
    expect(session.contactTarget("hands", "receiver")).toEqual(target);
  });
});
