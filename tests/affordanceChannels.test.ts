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
  it("is behind each of the head's openings, oriented as the openings are", () => {
    const { channels } = figure({ age: 25 }, 1);
    expect(Object.keys(channels).sort()).toEqual([
      "ear-canal.L",
      "ear-canal.R",
      "mouth",
      "nostril.L",
      "nostril.R",
    ]);
    // An ear canal is taller than wide; a nostril runs front to back; the mouth is wide
    // across the face and opens up and down.
    for (const side of ["L", "R"] as const) {
      const ear = channels[`ear-canal.${side}`];
      const nose = channels[`nostril.${side}`];
      if (!ear || !nose) throw new Error(side);
      expect(Math.abs(ear.up[1]), `ear ${side}`).toBeGreaterThan(0.8);
      expect(Math.abs(nose.up[2]), `nostril ${side}`).toBeGreaterThan(Math.abs(nose.up[0]));
    }
    const mouth = channels.mouth;
    if (!mouth) throw new Error("no mouth");
    expect(Math.abs(mouth.across[0])).toBeGreaterThan(0.9);
    expect(Math.abs(mouth.up[1])).toBeGreaterThan(0.8);
  });

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
      const [halfAcross, halfUp] = c.halfSize(0.002);
      const at = along(c.origin, c.inward, 0.002);
      expect(placeIn(c, along(at, c.across, halfAcross * 0.9)).inside, `${id} near the side`).toBe(
        true,
      );
      expect(placeIn(c, along(at, c.across, halfAcross * 1.1)).inside, `${id} side wall`).toBe(
        false,
      );
      expect(placeIn(c, along(at, c.up, halfUp * 0.9)).inside, `${id} near the top`).toBe(true);
      expect(placeIn(c, along(at, c.up, halfUp * 1.1)).inside, `${id} top wall`).toBe(false);
      expect(placeIn(c, along(c.origin, c.inward, 0.005)).depth, id).toBeCloseTo(0.005, 9);
    }
  });

  it("is the ear canal's measured size on the default adult", () => {
    const { channels } = figure({ age: 25 });
    const ear = channels["ear-canal.L"];
    if (!ear) throw new Error("no ear canal");
    // To a tenth of a millimetre: the default adult's head is the span's own, to 0.1%.
    const [a, u] = ear.halfSize(0);
    expect(Math.abs(2 * a - 0.0061)).toBeLessThan(1e-4);
    expect(Math.abs(2 * u - 0.00775)).toBeLessThan(1e-4);
    expect(Math.abs(ear.depth - 0.024)).toBeLessThan(1e-4);
    // The isthmus, a third of the way in: 6.8 high by 5.2 wide.
    const [ia, iu] = ear.halfSize(ear.depth / 3);
    expect(Math.abs(2 * ia - 0.0052)).toBeLessThan(1e-4);
    expect(Math.abs(2 * iu - 0.0068)).toBeLessThan(1e-4);
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
