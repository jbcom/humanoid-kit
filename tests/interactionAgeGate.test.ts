/**
 * The interaction runtime's age gate does not depend on the host: an affordance
 * id the core does not know is adult whatever the host's predicate answers, and
 * the predicate can only add adult ids, never clear one (docs/INTERACTIONS.md,
 * "Age policy enforcement points", points 1 and 2).
 */
import { describe, expect, it } from "vitest";
import {
  audienceOf,
  defaultAffordanceAdult,
  definitionProblems,
  type InteractionDefinition,
  type RolePoint,
} from "../src/interaction/definition.ts";
import { createInteractions } from "../src/interaction/runtime.ts";
import { createPresenceRegistry } from "../src/presence/presence.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { apple, figure, run } from "./interactionHarness.ts";

const DEFAULT_ANSWER = (id: string): boolean => defaultAffordanceAdult(id);

/** A definition that declares itself for everyone and names `point` as one end of a contact. */
const naming = (point: string): InteractionDefinition => ({
  id: "probe",
  tags: ["probe"],
  audience: "all",
  roles: [
    { name: "a", takes: "figure", track: { act: { clip: "probe" } } },
    { name: "food", takes: "object" },
  ],
  // A point comes from JSON, so it may be malformed: the template type is a promise the data does not keep.
  contacts: [{ a: point as RolePoint, b: "food:grip", during: ["act"] }],
});

const SAYS_NOTHING_IS_ADULT = () => false;
const SAYS_EVERYTHING_IS_ADULT = () => true;

describe("a host's affordanceAdult predicate", () => {
  it("cannot make an unknown affordance not adult", () => {
    const def = naming("a:canal.unknown");
    expect(audienceOf(def)).toBe("adult");
    expect(audienceOf(def, SAYS_NOTHING_IS_ADULT)).toBe("adult");
  });

  it("cannot make a role's declared unknown affordance not adult", () => {
    const def: InteractionDefinition = {
      ...naming("a:mouth"),
      roles: [
        {
          name: "a",
          takes: "figure",
          affordances: ["canal.unknown"],
          track: { act: { clip: "probe" } },
        },
        { name: "food", takes: "object" },
      ],
    };
    expect(audienceOf(def, SAYS_NOTHING_IS_ADULT)).toBe("adult");
  });

  it("can still escalate: a core affordance the host calls adult makes the definition adult", () => {
    expect(audienceOf(naming("a:mouth"))).toBe("all");
    expect(audienceOf(naming("a:mouth"), SAYS_NOTHING_IS_ADULT)).toBe("all");
    expect(audienceOf(naming("a:mouth"), SAYS_EVERYTHING_IS_ADULT)).toBe("adult");
    expect(audienceOf(naming("a:mouth"), DEFAULT_ANSWER)).toBe("all");
  });

  it("is applied by the runtime: a minor is refused an unknown affordance, though the host answers false", () => {
    const presence = createPresenceRegistry();
    const runtime = createInteractions(presence, {
      seed: 1,
      clipLength: () => 1,
      affordanceAdult: SAYS_NOTHING_IS_ADULT,
    });
    runtime.define([naming("a:canal.unknown")]);
    presence.set(figure("kid", false));
    presence.setObject(apple());
    expect(() => runtime.propose("probe", { a: "kid", food: "apple" })).toThrow(AgePolicyError);
  });
});

describe("what an audience is derived from", () => {
  it("includes a beat's affordance change on a figure, not only its contacts and couplings", () => {
    const def: InteractionDefinition = {
      id: "probe",
      tags: ["probe"],
      audience: "all",
      roles: [{ name: "a", takes: "figure", track: { act: { clip: "probe" } } }],
      beats: [
        {
          name: "change",
          at: 0.5,
          effects: [{ set: "a:canal.unknown", change: { occupancy: null } }],
        },
      ],
    };
    expect(audienceOf(def)).toBe("adult");
    expect(audienceOf(def, SAYS_NOTHING_IS_ADULT)).toBe("adult");
  });

  it("treats a point that is not role:name, or names no role, as adult", () => {
    expect(audienceOf(naming("canal"))).toBe("adult");
    expect(audienceOf(naming("nobody:mouth"))).toBe("adult");
  });

  it("does not make an object's frame adult", () => {
    expect(audienceOf(naming("food:grip"))).toBe("all");
  });
});

describe("a beat that drives a figure's signals", () => {
  /** An all-ages fidget whose beat changes `change` on its own figure's signals. */
  const driving = (change: Record<string, number | { add: number }>): InteractionDefinition => ({
    id: "drive",
    tags: ["probe"],
    audience: "all",
    roles: [{ name: "a", takes: "figure", track: { act: { clip: "probe" } } }],
    beats: [{ name: "rise", at: 0.5, effects: [{ signal: "a", change }] }],
  });

  it("is adult when it drives an adult-only signal, by add or by set", () => {
    expect(audienceOf(driving({ arousal: { add: 0.1 } }))).toBe("adult");
    expect(audienceOf(driving({ genitalMoisture: 0.4 }))).toBe("adult");
    // A host that says nothing is adult cannot clear it.
    expect(audienceOf(driving({ arousal: 0.2 }), SAYS_NOTHING_IS_ADULT)).toBe("adult");
  });

  it("stays for all audiences when its signals are physiological at every age", () => {
    expect(audienceOf(driving({ blush: { add: 0.2 }, exertion: 0.5 }))).toBe("all");
  });

  it("is refused for a minor at proposal", () => {
    const presence = createPresenceRegistry();
    const runtime = createInteractions(presence, { seed: 1, clipLength: () => 1 });
    runtime.define([driving({ arousal: { add: 0.1 } })]);
    presence.set(figure("kid", false));
    expect(() => runtime.propose("drive", { a: "kid" })).toThrow(AgePolicyError);
  });

  it("is applied through the host's hook at its beat, on the figure in the role", () => {
    const presence = createPresenceRegistry();
    const applied: string[] = [];
    const runtime = createInteractions(presence, {
      seed: 1,
      clipLength: () => 1,
      applySignals: (participant, change) =>
        applied.push(`${participant} ${JSON.stringify(change)}`),
    });
    runtime.define([driving({ blush: { add: 0.2 } })]);
    presence.set(figure("kid", false));
    runtime.propose("drive", { a: "kid" });
    run(presence, 0, 1.2);
    expect(applied).toEqual(['kid {"blush":{"add":0.2}}']);
  });

  it("must name a figure role", () => {
    const def: InteractionDefinition = {
      ...driving({ blush: 0.1 }),
      roles: [
        { name: "a", takes: "figure", track: { act: { clip: "probe" } } },
        { name: "food", takes: "object" },
      ],
      beats: [{ name: "rise", at: 0.5, effects: [{ signal: "food", change: { blush: 0.1 } }] }],
    };
    expect(definitionProblems(def)).toEqual([
      "beat rise drives the signals of food, which is not a figure role",
    ]);
  });
});
