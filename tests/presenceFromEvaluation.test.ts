import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import {
  clonePresence,
  type Placement,
  placePresence,
  presenceFromEvaluation,
  presenceJoints,
  tryPresenceJoints,
} from "../src/presence/fromEvaluation.ts";
import type { FigurePresence, Vec3 } from "../src/presence/presence.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { luminance, SKIN_F0, skinAlbedo } from "../src/surface/skinTone.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 0 });
const joints = presenceJoints(assets);

const AT_ORIGIN: Placement = { id: "p", position: [0, 0, 0], facing: [0, 0, 1] };

const presence = (recipe: Recipe, placement: Placement = AT_ORIGIN): FigurePresence =>
  presenceFromEvaluation({ evaluation: model.evaluate(recipe), recipe, joints, placement });

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("presenceFromEvaluation", () => {
  it("stands a human-scale figure on the ground with its anchors where the body is", () => {
    const p = presence(createRecipe());
    expect(p.id).toBe("p");
    expect(p.position).toEqual([0, 0, 0]);
    const { head, face, chest, leftHand, rightHand, leftFoot, rightFoot } = p.anchors;
    // Feet on the ground, head about 1.5–1.9 m up, chest between them.
    expect(p.bounds.min[1]).toBeCloseTo(0, 3);
    expect(p.bounds.max[1]).toBeGreaterThan(1.5);
    expect(p.bounds.max[1]).toBeLessThan(2);
    expect(leftFoot[1]).toBeLessThan(0.15);
    expect(rightFoot[1]).toBeLessThan(0.15);
    expect(chest[1]).toBeGreaterThan(0.9 * 1);
    expect(chest[1]).toBeLessThan(head[1]);
    expect(head[1]).toBeGreaterThan(1.4);
    expect(head[1]).toBeLessThan(p.bounds.max[1]);
    // The face is the front of the head: ahead of it along the facing.
    expect(face[2]).toBeGreaterThan(head[2]);
    // Left (+x) and right (-x) mirror each other, hands out at the sides of the hips.
    expect(leftHand[0]).toBeGreaterThan(0);
    expect(rightHand[0]).toBeCloseTo(-leftHand[0], 3);
    expect(leftFoot[0]).toBeCloseTo(-rightFoot[0], 3);
    expect(leftHand[1]).toBeGreaterThan(leftFoot[1]);
    expect(leftHand[1]).toBeLessThan(chest[1]);
    // Everything lies inside the bounds.
    for (const a of Object.values(p.anchors))
      for (let k = 0; k < 3; k++) {
        expect(a[k] as number).toBeGreaterThanOrEqual((p.bounds.min[k] as number) - 1e-4);
        expect(a[k] as number).toBeLessThanOrEqual((p.bounds.max[k] as number) + 1e-4);
      }
  });

  it("gives a taller figure a higher head, face and bounds, and a child a smaller face", () => {
    const short = presence(createRecipe({ macros: { height: 0 } }));
    const tall = presence(createRecipe({ macros: { height: 1 } }));
    expect(tall.anchors.head[1]).toBeGreaterThan(short.anchors.head[1]);
    expect(tall.anchors.face[1]).toBeGreaterThan(short.anchors.face[1]);
    expect(tall.bounds.max[1]).toBeGreaterThan(short.bounds.max[1]);
    // Both still stand on the ground.
    expect(short.bounds.min[1]).toBeCloseTo(0, 3);
    expect(tall.bounds.min[1]).toBeCloseTo(0, 3);
    const child = presence(createRecipe({ macros: { age: 5 } }));
    const adult = presence(createRecipe({ macros: { age: 30 } }));
    expect(child.faceRadius).toBeLessThan(adult.faceRadius);
    expect(child.anchors.head[1]).toBeLessThan(adult.anchors.head[1]);
  });

  it("places the figure: translated onto its ground position and turned to face its heading", () => {
    const recipe = createRecipe();
    const home = presence(recipe);
    const moved = presence(recipe, { id: "m", position: [2, 0.5, -3], facing: [1, 0, 0] });
    expect(moved.id).toBe("m");
    expect(moved.position).toEqual([2, 0.5, -3]);
    expect(moved.facing).toEqual([1, 0, 0]);
    // The face now leads the head along +x, at the same height above the ground.
    const lead = sub(moved.anchors.face, moved.anchors.head);
    expect(lead[0]).toBeGreaterThan(0);
    expect(Math.abs(lead[2])).toBeLessThan(1e-4);
    expect(dot(lead, moved.facing)).toBeCloseTo(home.anchors.face[2] - home.anchors.head[2], 4);
    expect(moved.anchors.head[1]).toBeCloseTo(home.anchors.head[1] + 0.5, 4);
    expect(moved.bounds.min[1]).toBeCloseTo(0.5, 3);
    // The figure's left hand (+x when facing +z) is on the facing's left when turned to +x.
    expect(moved.anchors.leftHand[2]).toBeLessThan(-3 - 0.2);
    expect(moved.anchors.rightHand[2]).toBeGreaterThan(-3 + 0.2);
    // The turn is the same figure rotated: distances from the origin are kept.
    const reach = (p: FigurePresence) =>
      Math.hypot(p.anchors.leftHand[0] - p.position[0], p.anchors.leftHand[2] - p.position[2]);
    expect(reach(moved)).toBeCloseTo(reach(home), 4);
  });

  it("re-places a published presence without re-deriving it", () => {
    const recipe = createRecipe({ macros: { height: 0.8 } });
    const placement: Placement = { id: "q", position: [-1, 0, 4], facing: [0.6, 0, 0.8] };
    const direct = presence(recipe, placement);
    const replaced = placePresence(presence(recipe), placement);
    expect(replaced.id).toBe("q");
    expect(replaced.footprint.radius).toBe(direct.footprint.radius);
    for (const name of Object.keys(direct.anchors) as (keyof FigurePresence["anchors"])[])
      for (let k = 0; k < 3; k++)
        expect(replaced.anchors[name][k] as number).toBeCloseTo(
          direct.anchors[name][k] as number,
          5,
        );
    expect(replaced.footprint.points).toEqual(direct.footprint.points);
    expect(replaced.bounds).toEqual(direct.bounds);
    expect(replaced.facing).toEqual(direct.facing);
  });

  it("publishes the soles of the feet as the footprint, half a foot's length across", () => {
    const home = presence(createRecipe());
    expect(home.footprint.points).toHaveLength(2);
    const [left, right] = home.footprint.points as [[number, number], [number, number]];
    // Each sole lies under its foot, on its own side.
    expect(left[0]).toBeGreaterThan(0);
    expect(right[0]).toBeLessThan(0);
    expect(left[0]).toBeCloseTo(-right[0], 3);
    expect(Math.abs(left[0] - home.anchors.leftFoot[0])).toBeLessThan(0.05);
    expect(Math.abs(left[1] - home.anchors.leftFoot[2])).toBeLessThan(0.1);
    expect(home.footprint.radius).toBeGreaterThan(0.08);
    expect(home.footprint.radius).toBeLessThan(0.2);
    // Standing elsewhere moves the footprint with the figure.
    const there = presence(createRecipe(), { id: "t", position: [5, 0, 5], facing: [0, 0, 1] });
    expect(there.footprint.points[0]?.[0]).toBeCloseTo(left[0] + 5, 4);
    expect(there.footprint.points[0]?.[1]).toBeCloseTo(left[1] + 5, 4);
  });

  it("measures the skin: linear albedo, its luminance and the skin specular level", () => {
    const fair = presence(createRecipe({ skin: { melanin: 0.05 } }));
    const deep = presence(createRecipe({ skin: { melanin: 0.95 } }));
    expect(deep.appearance.luminance).toBeLessThan(fair.appearance.luminance);
    expect(deep.appearance.albedo[0]).toBeLessThan(fair.appearance.albedo[0]);
    for (const p of [fair, deep]) {
      expect(p.appearance.specular).toBe(SKIN_F0);
      expect(p.appearance.luminance).toBeCloseTo(luminance(p.appearance.albedo), 8);
    }
    const recipe = createRecipe({ skin: { melanin: 0.6, haemoglobin: 0.8, undertone: -0.4 } });
    expect(presence(recipe).appearance.albedo).toEqual(
      skinAlbedo({ melanin: 0.6, haemoglobin: 0.8, undertone: -0.4, override: null }),
    );
    // Non-natural skin publishes what is drawn.
    const blue = presence(createRecipe({ skin: { override: [0.05, 0.1, 0.4] } }));
    expect(blue.appearance.albedo).toEqual([0.05, 0.1, 0.4]);
  });

  it("follows the age policy: adult from 18 on, never below", () => {
    const adult = (age: number) => presence(createRecipe({ macros: { age } })).adult;
    expect(adult(15)).toBe(false);
    expect(adult(17)).toBe(false);
    expect(adult(18)).toBe(true);
    expect(adult(30)).toBe(true);
  });
});

describe("placePresence", () => {
  const recipe = createRecipe({ macros: { height: 0.8 } });
  const rest = presence(recipe);
  const same = (a: FigurePresence, b: FigurePresence) => {
    expect(a.id).toBe(b.id);
    for (let k = 0; k < 3; k++) {
      expect(a.position[k]).toBeCloseTo(b.position[k] as number, 6);
      expect(a.facing[k]).toBeCloseTo(b.facing[k] as number, 6);
      expect(a.bounds.min[k]).toBeCloseTo(b.bounds.min[k] as number, 5);
      expect(a.bounds.max[k]).toBeCloseTo(b.bounds.max[k] as number, 5);
      for (const name of Object.keys(b.anchors) as (keyof FigurePresence["anchors"])[])
        expect(a.anchors[name][k]).toBeCloseTo(b.anchors[name][k] as number, 5);
    }
    a.footprint.points.forEach((pt, i) => {
      expect(pt[0]).toBeCloseTo(b.footprint.points[i]?.[0] as number, 5);
      expect(pt[1]).toBeCloseTo(b.footprint.points[i]?.[1] as number, 5);
    });
    expect(a.footprint.radius).toBe(b.footprint.radius);
  };

  it("re-places a presence that already stands elsewhere, facing any way", () => {
    const first: Placement = { id: "q", position: [2, 0.4, -1], facing: [1, 0, 0] };
    const second: Placement = { id: "r", position: [-3, 0, 5], facing: [-0.6, 0, -0.8] };
    // Chaining a turned source gives what placing the rest directly gives.
    same(placePresence(placePresence(rest, first), second), placePresence(rest, second));
    // Bounds stay valid boxes when turned a quarter turn: the figure's height is unchanged.
    const turned = placePresence(rest, { id: "t", position: [0, 0, 0], facing: [0, 0, -1] });
    expect(turned.bounds.max[1] - turned.bounds.min[1]).toBeCloseTo(
      rest.bounds.max[1] - rest.bounds.min[1],
      5,
    );
  });

  it("writes into `out` without allocating, and may re-place a presence in place", () => {
    const placement: Placement = { id: "q", position: [-1, 0, 4], facing: [0.6, 0, 0.8] };
    const out = clonePresence(rest);
    const parts = () => [
      out.position,
      out.facing,
      out.bounds.min,
      out.anchors.head,
      out.footprint.points,
    ];
    const before = parts();
    const result = placePresence(rest, placement, out);
    expect(result).toBe(out);
    // Every nested object is the one it was: only their numbers changed.
    const after = parts();
    for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
    same(out, placePresence(rest, placement));
    // The source is untouched by placing it elsewhere.
    same(rest, presence(recipe));
    // Re-placing a presence onto itself, in place, equals placing a copy.
    const mine = clonePresence(rest);
    placePresence(mine, placement, mine);
    same(mine, placePresence(rest, placement));
  });

  it("copies deeply when cloned", () => {
    const copy = clonePresence(rest);
    same(copy, { ...rest, id: rest.id });
    copy.anchors.head[1] = 99;
    (copy.footprint.points[0] as [number, number])[0] = 99;
    copy.appearance.albedo[0] = 99;
    expect(rest.anchors.head[1]).not.toBe(99);
    expect(rest.footprint.points[0]?.[0]).not.toBe(99);
    expect(rest.appearance.albedo[0]).not.toBe(99);
  });

  it("refuses a heading with no horizontal component, on either side", () => {
    expect(() => placePresence(rest, { id: "up", position: [0, 0, 0], facing: [0, 1, 0] })).toThrow(
      RangeError,
    );
    expect(() =>
      placePresence(rest, { id: "zero", position: [0, 0, 0], facing: [0, 0, 0] }),
    ).toThrow(RangeError);
    const lying = { ...rest, facing: [0, 1, 0] as Vec3 };
    expect(() =>
      placePresence(lying, { id: "ok", position: [0, 0, 0], facing: [0, 0, 1] }),
    ).toThrow(RangeError);
  });
});

describe("presenceJoints", () => {
  it("names the missing joint, and the tolerant form says only that presence is unavailable", () => {
    const missing = {
      ...assets,
      manifest: {
        ...assets.manifest,
        skeleton: {
          ...assets.manifest.skeleton,
          joints: { ...assets.manifest.skeleton.joints, oris01____head: [] },
        },
      },
    };
    expect(() => presenceJoints(missing)).toThrow(/no joint oris01____head/);
    expect(tryPresenceJoints(missing)).toBeNull();
    expect(tryPresenceJoints(assets)).toEqual(presenceJoints(assets));
  });
});
