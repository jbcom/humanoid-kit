import { describe, expect, it } from "vitest";
import { HumanoidAffordances } from "../src/affordance/live.ts";
import {
  audienceOf,
  definitionProblems,
  type InteractionDefinition,
  tagMatches,
} from "../src/interaction/definition.ts";
import {
  applyToAffordances,
  createInteractions,
  type InteractionEvent,
} from "../src/interaction/runtime.ts";
import {
  createPresenceRegistry,
  type FigurePresence,
  type ObjectPresence,
} from "../src/presence/presence.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";

const v = (x = 0, y = 0, z = 0): [number, number, number] => [x, y, z];

const figure = (id: string, adult: boolean, x = 0): FigurePresence => ({
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
  footprint: { points: [[x, 0]], radius: 0.15 },
  appearance: { albedo: v(0.4, 0.3, 0.25), luminance: 0.3, specular: 0.028 },
  faceRadius: 0.1,
  adult,
});

const apple = (id = "apple"): ObjectPresence => ({
  id,
  kind: "object",
  position: v(0.3, 1),
  rotation: [0, 0, 0, 1],
  bounds: { min: v(0.26, 0.96, -0.04), max: v(0.34, 1.04, 0.04) },
  frames: {},
  tags: ["food.fruit.apple"],
  state: { stage: 0 },
});

/** The apple of docs/INTERACTIONS.md: three bites, each bite → chew → swallow. */
const EAT: InteractionDefinition = {
  id: "eat",
  tags: ["consume.eat"],
  audience: "all",
  roles: [
    {
      name: "eater",
      takes: "figure",
      affordances: ["mouth", "hand.R"],
      uses: ["hand.R", "arm.R", "head", "mouth"],
      track: { act: { clip: "eat.bite" } },
    },
    { name: "food", takes: "object", requires: ["food"] },
  ],
  reference: { anchorOf: "eater", anchor: "rightHand" },
  contacts: [{ a: "eater:hand.R", b: "food:grip", during: ["act"] }],
  beats: [
    {
      name: "bite",
      at: 0.5,
      effects: [{ set: "eater:mouth", change: { occupancy: { radius: 0.02, depth: 0.01 } } }],
    },
    {
      name: "chew",
      at: 1,
      effects: [
        { set: "eater:mouth", change: { occupancy: null } },
        { object: "food", state: { stage: { add: 1 } } },
      ],
    },
    { name: "swallow", at: 1.8 },
  ],
  repeatWhile: { object: "food", state: "stage", below: 3 },
};

/** An adult-only definition, standing in for the adult package's. */
const ADULT: InteractionDefinition = {
  id: "romantic-kiss",
  tags: ["affection.kiss.romantic"],
  audience: "adult",
  roles: [
    { name: "a", takes: "figure", uses: ["head", "mouth"], track: { act: { clip: "kiss" } } },
    { name: "b", takes: "figure", uses: ["head", "mouth"], track: { act: { clip: "kiss" } } },
  ],
};

const clipLength = (id: string) => (id === "eat.bite" ? 2 : 3);

function setup(seed = 1) {
  const presence = createPresenceRegistry();
  const runtime = createInteractions(presence, { seed, clipLength });
  runtime.define([EAT, ADULT]);
  return { presence, runtime };
}

/** Ticks at 10 Hz from `from` for `seconds`. */
function run(presence: ReturnType<typeof createPresenceRegistry>, from: number, seconds: number) {
  for (let i = 0; i <= Math.round(seconds * 10); i++) presence.tick(from + i / 10);
}

describe("interaction definitions", () => {
  it("matches tags by prefix on dotted boundaries", () => {
    expect(tagMatches("food", "food.fruit.apple")).toBe(true);
    expect(tagMatches("food.fruit", "food.fruit.apple")).toBe(true);
    expect(tagMatches("food", "foodstuff")).toBe(false);
  });

  it("treats a missing or unknown audience as adult", () => {
    const { audience: _, ...rest } = EAT;
    expect(audienceOf(rest as InteractionDefinition)).toBe("adult");
    expect(audienceOf({ ...EAT, audience: "everyone" as "all" })).toBe("adult");
    expect(audienceOf(EAT)).toBe("all");
  });

  it("derives adult from an affordance the core does not know, whatever it declares", () => {
    const sneaky: InteractionDefinition = {
      ...EAT,
      contacts: [{ a: "eater:canal.vaginal", b: "food:grip", during: ["act"] }],
    };
    expect(audienceOf(sneaky)).toBe("adult");
    // An object frame is not an affordance: naming one does not make it adult.
    expect(audienceOf(EAT)).toBe("all");
  });

  it("reports malformed definitions", () => {
    expect(definitionProblems(EAT)).toEqual([]);
    const bad: InteractionDefinition = {
      ...EAT,
      roles: [{ name: "food", takes: "object", uses: ["mouth"] }],
    };
    expect(definitionProblems(bad)).toEqual(
      expect.arrayContaining([
        "object role food cannot claim body parts, affordances or a slot",
        "contact eater:hand.R names no role",
        "no role plays an act clip",
      ]),
    );
  });
});

describe("the interaction runtime", () => {
  it("eats an apple: three bites, the stage advances on each chew, then it ends", () => {
    const { presence, runtime } = setup();
    presence.set(figure("ana", true));
    presence.setObject(apple());
    const events: string[] = [];
    runtime.on("ana", (e) =>
      events.push(e.beat ? `${e.type}:${e.beat}` : `${e.type}:${e.phase ?? ""}`),
    );
    const i = runtime.propose("eat", { eater: "ana", food: "apple" });
    expect(i.phase).toBe("proposed");
    run(presence, 0, 8);
    expect(presence.getObject("apple")?.state.stage).toBe(3);
    expect(events.filter((e) => e === "beat:chew")).toHaveLength(3);
    expect(events[0]).toBe("accepted:");
    expect(events).toContain("phase:act");
    expect(events.at(-1)).toBe("ended:");
    expect(i.phase).toBe("ended");
  });

  it("applies affordance changes through the application's hook at their beat", () => {
    const presence = createPresenceRegistry();
    const changes: string[] = [];
    const runtime = createInteractions(presence, {
      seed: 1,
      clipLength,
      applyChange: (participant, affordance) => changes.push(`${participant}:${affordance}`),
    });
    runtime.define([EAT]);
    presence.set(figure("ana", true));
    presence.setObject(apple());
    runtime.propose("eat", { eater: "ana", food: "apple" });
    run(presence, 0, 8);
    expect(changes).toEqual(Array(6).fill("ana:mouth"));
  });

  it("fills a real figure's mouth at each bite and empties it at each chew", () => {
    const presence = createPresenceRegistry();
    const mouth = new HumanoidAffordances();
    mouth.setRecipe(createRecipe({ macros: { age: 30 } }));
    const runtime = createInteractions(presence, {
      seed: 1,
      clipLength,
      applyChange: applyToAffordances(new Map([["ana", mouth]])),
    });
    runtime.define([EAT]);
    presence.set(figure("ana", true));
    presence.setObject(apple());
    runtime.propose("eat", { eater: "ana", food: "apple" });
    const occupant = () => {
      const s = mouth.get("mouth");
      return s.kind === "aperture" ? (s.occupancy?.radius ?? 0) : -1;
    };
    run(presence, 0, 0.7); // past the first bite (act starts at the first tick)
    expect(occupant()).toBe(0.02);
    run(presence, 0.8, 0.4); // past the first chew
    expect(occupant()).toBe(0);
  });

  it("is deterministic: the same seed and ticks give the same event log", () => {
    const log = () => {
      const { presence, runtime } = setup(7);
      presence.set(figure("ana", true));
      presence.setObject(apple());
      const out: InteractionEvent["type"][] = [];
      runtime.on("ana", (e) => out.push(e.type));
      runtime.propose("eat", { eater: "ana", food: "apple" });
      run(presence, 0, 8);
      return out.join(",");
    };
    expect(log()).toBe(log());
  });

  it("cancels with `left` when a participant leaves presence", () => {
    const { presence, runtime } = setup();
    presence.set(figure("ana", true));
    presence.setObject(apple());
    const i = runtime.propose("eat", { eater: "ana", food: "apple" });
    run(presence, 0, 1);
    presence.removeObject("apple");
    const reasons: (string | undefined)[] = [];
    runtime.on("ana", (e) => e.type === "cancelled" && reasons.push(e.reason));
    run(presence, 1.1, 0.2);
    expect(i.phase).toBe("ended");
    expect(reasons).toEqual(["left"]);
  });

  it("refuses a role filled by the wrong kind of participant", () => {
    const { presence, runtime } = setup();
    presence.set(figure("ana", true));
    presence.set(figure("ben", true, 1));
    expect(() => runtime.propose("eat", { eater: "ana", food: "ben" })).toThrow(/object/);
    presence.setObject(apple());
    expect(() => runtime.propose("eat", { eater: "apple", food: "apple" })).toThrow(/figure/);
  });

  it("refuses an object that lacks the role's tags", () => {
    const { presence, runtime } = setup();
    presence.set(figure("ana", true));
    presence.setObject({ ...apple("cup"), tags: ["vessel.cup"] });
    expect(() => runtime.propose("eat", { eater: "ana", food: "cup" })).toThrow(/food/);
  });
});

describe("the age policy in the interaction runtime", () => {
  it("hides adult offers from a figure under 18 (point 3)", () => {
    const { presence, runtime } = setup();
    presence.set(figure("ana", true));
    presence.set(figure("kid", false, 2));
    runtime.offer({
      id: "o1",
      by: "ana",
      definition: "romantic-kiss",
      role: "a",
      tags: ADULT.tags,
      slots: 1,
    });
    runtime.offer({
      id: "o2",
      by: "ana",
      definition: "eat",
      role: "eater",
      tags: EAT.tags,
      slots: 1,
    });
    expect(runtime.offersFor("kid").map((o) => o.id)).toEqual(["o2"]);
    expect(runtime.offersFor("ana").map((o) => o.id)).toEqual(["o1", "o2"]);
  });

  it("refuses an adult proposal with a participant under 18 before anyone is asked (point 4)", () => {
    const { presence, runtime } = setup();
    presence.set(figure("ana", true));
    presence.set(figure("kid", false, 1));
    let asked = 0;
    runtime.policy("ana", () => {
      asked++;
      return true;
    });
    expect(() => runtime.propose("romantic-kiss", { a: "ana", b: "kid" })).toThrow(AgePolicyError);
    expect(asked).toBe(0);
  });

  it("never accepts an adult interaction by default (consent is explicit)", () => {
    const { presence, runtime } = setup();
    presence.set(figure("ana", true));
    presence.set(figure("ben", true, 1));
    runtime.policy("ana", () => true);
    const i = runtime.propose("romantic-kiss", { a: "ana", b: "ben" });
    const types: string[] = [];
    runtime.on("ana", (e) => types.push(e.type));
    run(presence, 0, 0.5);
    expect(types).toEqual(["declined"]);
    expect(i.phase).toBe("ended");
  });

  it("aborts an adult interaction on the tick a participant stops being an adult (point 5)", () => {
    const { presence, runtime } = setup();
    const ben = figure("ben", true, 1);
    presence.set(figure("ana", true));
    presence.set(ben);
    runtime.policy("ana", () => true);
    runtime.policy("ben", () => true);
    const i = runtime.propose("romantic-kiss", { a: "ana", b: "ben" });
    run(presence, 0, 0.5);
    expect(i.phase).toBe("act");
    presence.set({ ...ben, adult: false });
    const reasons: (string | undefined)[] = [];
    runtime.on("ana", (e) => reasons.push(e.reason));
    presence.tick(0.6);
    expect(i.phase).toBe("ended");
    expect(reasons).toEqual(["age-policy"]);
  });

  it("refuses to define an adult interaction whose role an object could fill (point 9)", () => {
    const { runtime } = setup();
    // Roles say what they take; an object role never stands in for a figure.
    expect(() => runtime.propose("romantic-kiss", { a: "ana", b: "apple" })).toThrow();
  });
});
