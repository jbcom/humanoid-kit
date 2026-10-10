/**
 * The affordance registry (src/affordance/, docs/ARCHITECTURE.md, "Affordances:
 * the registry"): what the body offers other objects and figures, framed on the
 * posed body as drawn, with state a developer sets and the kit checks.
 */
import { describe, expect, it } from "vitest";
import { affordanceFrames } from "../src/affordance/frames.ts";
import { affordances, CORE_AFFORDANCES } from "../src/affordance/registry.ts";
import { AffordanceStates, restState } from "../src/affordance/state.ts";
import { BATTERY_CROSS, batteryBody } from "../src/foundation/battery.ts";
import { LANDMARK_IDS, landmarks } from "../src/foundation/landmarks.ts";
import { REST_POSE, SMOKE_POSES } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

type V = readonly [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const recipeOf = (name: (typeof BATTERY_CROSS.bodies)[number]) =>
  createRecipe({ macros: { ...batteryBody(name).macros } });

describe("the affordance registry", () => {
  it("names each affordance once, anchored on landmarks that exist", () => {
    const ids = CORE_AFFORDANCES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set<string>(LANDMARK_IDS);
    for (const a of CORE_AFFORDANCES) {
      const at = "landmark" in a.at ? [a.at.landmark] : [...a.at.between];
      for (const l of at) expect(known.has(l), `${a.id}: ${l}`).toBe(true);
    }
  });

  it("has every kind in the core, and none of the adult anatomy's", () => {
    const kinds = new Set(CORE_AFFORDANCES.map((a) => a.kind));
    expect([...kinds].sort()).toEqual(["aperture", "contact", "grip", "mount"]);
    expect(CORE_AFFORDANCES.some((a) => a.adult)).toBe(false);
  });

  it("gives a figure the core's at any age, and an adult anatomy's only from 18", () => {
    for (const age of [6, 15, 25])
      expect(affordances(createRecipe({ macros: { age } })).map((a) => a.id)).toEqual(
        CORE_AFFORDANCES.map((a) => a.id),
      );
    const adultOnly = {
      id: "a-pack-aperture",
      kind: "aperture",
      at: { landmark: "pubic-point" },
      adult: true,
    } as const;
    const registry = [...CORE_AFFORDANCES, adultOnly];
    expect(affordances(createRecipe({ macros: { age: 17 } }), registry)).not.toContain(adultOnly);
    expect(affordances(createRecipe({ macros: { age: 18 } }), registry)).toContain(adultOnly);
  });
});

describe("affordance frames", { timeout: 300_000 }, () => {
  it("frames every affordance on every smoke body and pose, orthonormal and on the body", () => {
    for (const name of BATTERY_CROSS.bodies)
      for (const pose of SMOKE_POSES) {
        const body = posedSurface(model, recipeOf(name), pose);
        const frames = affordanceFrames(model, body, CORE_AFFORDANCES);
        for (const a of CORE_AFFORDANCES) {
          const f = frames[a.id];
          const label = `${name} ${pose} ${a.id}`;
          expect(f, label).toBeDefined();
          if (!f) continue;
          for (const v of [f.position, f.normal, f.tangent, f.bitangent])
            expect(v.every(Number.isFinite), label).toBe(true);
          expect(dot(f.normal, f.normal), label).toBeCloseTo(1, 6);
          expect(dot(f.normal, f.tangent), label).toBeCloseTo(0, 6);
          expect(dot(f.tangent, f.bitangent), label).toBeCloseTo(0, 6);
        }
      }
  });

  it("opens the mouth forward between the lips, the nostrils down and the ear canals out to the sides", () => {
    const body = posedSurface(model, recipeOf("f-slim"), REST_POSE);
    const frames = affordanceFrames(model, body, CORE_AFFORDANCES);
    const marks = landmarks(model, body);
    const mouth = frames.mouth;
    expect(mouth?.normal[2]).toBeGreaterThan(0.8);
    expect(mouth?.position[1]).toBeLessThan(marks["upper-lip"].position[1]);
    expect(mouth?.position[1]).toBeGreaterThan(marks["lower-lip"].position[1]);
    for (const side of ["L", "R"] as const) {
      expect(frames[`nostril.${side}`]?.normal[1], side).toBeLessThan(-0.5);
      const out = side === "L" ? 1 : -1;
      expect((frames[`ear-canal.${side}`]?.normal[0] ?? 0) * out, side).toBeGreaterThan(0.5);
    }
  });

  it("grips from the palm, along the hand toward the fingers, in every pose", () => {
    for (const pose of SMOKE_POSES) {
      const body = posedSurface(model, recipeOf("m-muscular"), pose);
      const frames = affordanceFrames(model, body, CORE_AFFORDANCES);
      const marks = landmarks(model, body);
      for (const side of ["L", "R"] as const) {
        const grip = frames[`hand.${side}`];
        const palm = marks[`palm.${side}`];
        if (!grip) throw new Error(`no grip hand.${side}`);
        expect(dot(grip.normal, palm.normal), `${pose} ${side}`).toBeGreaterThan(0.99);
        const along = sub(palm.position, marks[`wrist.${side}`].position);
        expect(dot(grip.tangent, along) / Math.hypot(...along), `${pose} ${side}`).toBeGreaterThan(
          0.5,
        );
      }
    }
  });
});

describe("affordance state", () => {
  const states = new AffordanceStates(CORE_AFFORDANCES);

  it("starts at rest: a closed, empty mouth, open hands, nothing worn, no pressure", () => {
    expect(states.get("mouth")).toEqual(restState("aperture"));
    expect(states.get("hand.L")).toEqual(restState("grip"));
    expect(states.get("ear-lobe.L")).toEqual(restState("mount"));
    expect(states.get("sole.L")).toEqual(restState("contact"));
  });

  it("takes what a developer sets, merged over what it had", () => {
    states.set("mouth", { opening: 0.6 });
    states.set("mouth", { occupancy: { depth: 0.03, radius: 0.02 }, consumed: 0.25 });
    expect(states.get("mouth")).toEqual({
      kind: "aperture",
      opening: 0.6,
      occupancy: { depth: 0.03, radius: 0.02 },
      consumed: 0.25,
    });
    states.set("hand.R", { closure: 1, holding: "sword" });
    expect(states.get("hand.R")).toMatchObject({ closure: 1, holding: "sword" });
  });

  it("refuses what no body can do: out of range, the wrong kind, or an affordance it does not have", () => {
    expect(() => states.set("mouth", { opening: 1.5 })).toThrow(RangeError);
    expect(() => states.set("mouth", { occupancy: { depth: -0.01, radius: 0.01 } })).toThrow(
      RangeError,
    );
    expect(() => states.set("mouth", { consumed: 2 })).toThrow(RangeError);
    expect(() => states.set("hand.L", { closure: -0.1 })).toThrow(RangeError);
    expect(() => states.set("ear-lobe.L", { load: -1 })).toThrow(RangeError);
    expect(() => states.set("hand.L", { opening: 0.5 } as never)).toThrow(RangeError);
    expect(() => states.set("tail", { closure: 1 })).toThrow(RangeError);
  });
});
