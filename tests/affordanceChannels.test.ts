/**
 * The channels behind the body's apertures (src/affordance/channel.ts,
 * docs/research/AFFORDANCE-CHANNELS.md): their measured sizes, which points they
 * hold, and how they follow the figure's size and the mouth's opening.
 */
import { describe, expect, it } from "vitest";
import { ADULT_EAR_SPAN, CHANNELS, placeIn } from "../src/affordance/channel.ts";
import { affordanceChannels } from "../src/affordance/frames.ts";
import { affordances } from "../src/affordance/registry.ts";
import { AffordanceStates } from "../src/affordance/state.ts";
import { landmarks, type Vec3 } from "../src/foundation/landmarks.ts";
import { REST_POSE } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const along = (p: Vec3, d: Vec3, k: number): Vec3 => [
  p[0] + d[0] * k,
  p[1] + d[1] * k,
  p[2] + d[2] * k,
];

const figure = (macros: Record<string, number>, mouth = 0) => {
  const recipe = createRecipe({ macros });
  const own = affordances(recipe);
  const states = new AffordanceStates(own);
  states.set("mouth", { opening: mouth });
  const body = posedSurface(model, recipe, REST_POSE);
  return {
    body,
    channels: affordanceChannels(model, body, own, states),
    marks: landmarks(model, body),
  };
};

describe("the channels' dimensions", () => {
  it("are the research note's: the ear canal's measured entry and length, the nostril's floor", () => {
    expect(CHANNELS.auditory.rim).toEqual({ across: 0.0061, up: 0.00775 });
    expect(CHANNELS.auditory.depth).toBe(0.024);
    expect(CHANNELS.nasal.rim.across).toBe(0.0105);
    expect(CHANNELS.oral.depth).toBe(0.09);
  });

  it("are for the default adult's head, whose ear canals are ADULT_EAR_SPAN apart", () => {
    const { marks } = figure({ age: 25 });
    const a = marks["ear-canal.L"].position;
    const b = marks["ear-canal.R"].position;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeCloseTo(ADULT_EAR_SPAN, 3);
  });
});

describe("a channel on a figure", { timeout: 300_000 }, () => {
  it("runs into the head from each opening", () => {
    const { channels, marks } = figure({ age: 25 }, 1);
    // The head's centre: midway between the ear canals.
    const l = marks["ear-canal.L"].position;
    const r = marks["ear-canal.R"].position;
    const centre: Vec3 = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];
    const from = (p: Vec3) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
    for (const [id, c] of Object.entries(channels))
      expect(from(along(c.origin, c.inward, c.depth)), id).toBeLessThan(from(c.origin));
  });

  it("holds a point just inside its rim, and not one in front of the rim, past its end or beyond its wall", () => {
    const { channels } = figure({ age: 25 }, 1);
    for (const [id, c] of Object.entries(channels)) {
      expect(placeIn(c, along(c.origin, c.inward, 0.002)).inside, `${id} just in`).toBe(true);
      expect(placeIn(c, along(c.origin, c.inward, -0.002)).inside, `${id} in front`).toBe(false);
      expect(
        placeIn(c, along(c.origin, c.inward, c.depth + 0.002)).inside,
        `${id} past the end`,
      ).toBe(false);
      const [half] = c.halfSize(0.002);
      expect(
        placeIn(c, along(along(c.origin, c.inward, 0.002), c.across, half * 1.1)).inside,
        `${id} wall`,
      ).toBe(false);
      expect(placeIn(c, along(c.origin, c.inward, 0.005)).depth, id).toBeCloseTo(0.005, 9);
    }
  });

  it("is the ear canal's measured size on the default adult", () => {
    const { channels } = figure({ age: 25 });
    const ear = channels["ear-canal.L"];
    if (!ear) throw new Error("no ear canal");
    const [a, u] = ear.halfSize(0);
    expect(2 * a).toBeCloseTo(0.0061, 3);
    expect(2 * u).toBeCloseTo(0.00775, 3);
    expect(ear.depth).toBeCloseTo(0.024, 3);
  });

  it("holds nothing in a closed mouth, and opens as wide as the figure's mouth", () => {
    const shut = figure({ age: 25 }, 0).channels.mouth;
    const open = figure({ age: 25 }, 1);
    const mouth = open.channels.mouth;
    if (!shut || !mouth) throw new Error("no mouth");
    expect(placeIn(shut, along(shut.origin, shut.inward, 0.01)).inside).toBe(false);
    expect(placeIn(mouth, along(mouth.origin, mouth.inward, 0.01)).inside).toBe(true);
    const corners = [
      open.marks["mouth-corner.L"].position,
      open.marks["mouth-corner.R"].position,
    ] as const;
    const width = Math.hypot(...([0, 1, 2] as const).map((k) => corners[0][k] - corners[1][k]));
    expect(2 * (mouth.halfSize(0)[0] ?? 0)).toBeCloseTo(width, 6);
    expect(2 * (mouth.halfSize(0)[1] ?? 0)).toBeCloseTo(0.045, 3);
  });

  it("is a child's size on a child", () => {
    const adult = figure({ age: 25 }).channels["ear-canal.L"];
    const child = figure({ age: 6 }).channels["ear-canal.L"];
    if (!adult || !child) throw new Error("no ear canal");
    expect(child.depth).toBeLessThan(adult.depth * 0.95);
    expect(child.halfSize(0)[0]).toBeLessThan(adult.halfSize(0)[0]);
  });
});
