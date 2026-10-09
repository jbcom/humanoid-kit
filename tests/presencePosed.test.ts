import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { presenceFromEvaluation, presenceJoints } from "../src/presence/fromEvaluation.ts";
import {
  groundOffsetOf,
  type PosedRig,
  posedControl,
  presenceFromPose,
} from "../src/presence/posed.ts";
import type { FigurePresence, Vec3 } from "../src/presence/presence.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  bodyPoseRotations,
  composeRotations,
  IDENTITY_POSE,
  posedGroundOffset,
  restBonesFrom,
  rigData,
} from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const joints = presenceJoints(assets);
const data = rigData(assets);
const rig: PosedRig = { bones: data.bones, parents: model.boneParents(), skin: model.rigSkin() };
const recipe = createRecipe();
const evaluation = model.evaluate(recipe);
const placement = { id: "p", position: [0, 0, 0] as Vec3, facing: [0, 0, 1] as Vec3 };

const standing = presenceFromEvaluation({ evaluation, recipe, joints, placement });
const posedIn = (rotations: Float32Array, ev = evaluation, r = recipe): FigurePresence =>
  presenceFromPose({ evaluation: ev, recipe: r, joints, rig, rotations, placement });
const body = (name: string) => bodyPoseRotations(data, name);

describe("presence from the posed skeleton", () => {
  it("is the rest presence when nothing is rotated", () => {
    const posed = posedIn(IDENTITY_POSE(data.bones.length));
    for (const name of Object.keys(standing.anchors) as (keyof FigurePresence["anchors"])[])
      for (let k = 0; k < 3; k++)
        expect(posed.anchors[name][k]).toBeCloseTo(standing.anchors[name][k] as number, 5);
    // Bounds are the posed body's, with the rest surface's inset kept: the same box.
    for (let k = 0; k < 3; k++) {
      expect(posed.bounds.min[k]).toBeCloseTo(standing.bounds.min[k] as number, 5);
      expect(posed.bounds.max[k]).toBeCloseTo(standing.bounds.max[k] as number, 5);
    }
    // Soles come from the control mesh rather than the subdivided surface: a centimetre or two apart.
    posed.footprint.points.forEach((p, i) => {
      expect(Math.abs(p[0] - (standing.footprint.points[i]?.[0] as number))).toBeLessThan(0.02);
      expect(Math.abs(p[1] - (standing.footprint.points[i]?.[1] as number))).toBeLessThan(0.02);
    });
    expect(Math.abs(posed.footprint.radius - standing.footprint.radius)).toBeLessThan(0.02);
    expect(posed.adult).toBe(standing.adult);
    expect(posed.appearance).toEqual(standing.appearance);
    expect(posed.faceRadius).toBeCloseTo(standing.faceRadius, 6);
  });

  it("brings a kneeling figure's head down and keeps it on the ground", () => {
    const kneeling = posedIn(body("benchmark"));
    expect(kneeling.anchors.head[1]).toBeLessThan(standing.anchors.head[1] - 0.25);
    expect(kneeling.bounds.max[1]).toBeLessThan(standing.bounds.max[1] - 0.25);
    // Grounded: the posed body's lowest point is on the floor, as the renderer lifts it.
    expect(kneeling.bounds.min[1]).toBeCloseTo(0, 2);
    // The ground contact is whatever touches it, near the floor.
    expect(kneeling.footprint.points.length).toBeGreaterThan(0);
  });

  it("moves the hands to where the pose puts them", () => {
    const t = posedIn(body("tpose"));
    // Arms out level with the shoulders: higher and wider than the resting hands.
    expect(t.anchors.leftHand[1]).toBeGreaterThan(standing.anchors.leftHand[1] + 0.25);
    expect(t.anchors.leftHand[0]).toBeGreaterThan(standing.anchors.leftHand[0] + 0.1);
    expect(t.anchors.rightHand[0]).toBeLessThan(standing.anchors.rightHand[0] - 0.1);
    // The face is in front of the head as before, and the figure stands as tall.
    expect(t.anchors.face[2]).toBeGreaterThan(t.anchors.head[2]);
    expect(Math.abs(t.anchors.head[1] - standing.anchors.head[1])).toBeLessThan(0.03);
    expect(t.bounds.max[0]).toBeGreaterThan(standing.bounds.max[0]);
  });

  it("derives each pose from the evaluation, never from the one before", () => {
    const a = posedIn(body("benchmark"));
    const b = posedIn(body("tpose"));
    const aAgain = posedIn(body("benchmark"));
    expect(b.anchors.head[1]).not.toBeCloseTo(a.anchors.head[1], 2);
    for (const name of Object.keys(a.anchors) as (keyof FigurePresence["anchors"])[])
      for (let k = 0; k < 3; k++)
        expect(aAgain.anchors[name][k]).toBeCloseTo(a.anchors[name][k] as number, 6);
    // A different evaluation of a taller figure is posed from its own control mesh.
    const tallRecipe = createRecipe({ macros: { height: 1 } });
    const tall = model.evaluate(tallRecipe);
    const tallKneeling = posedIn(body("benchmark"), tall, tallRecipe);
    expect(tallKneeling.anchors.head[1]).toBeGreaterThan(a.anchors.head[1] + 0.02);
  });

  it("places like any presence", () => {
    const rest = posedIn(body("benchmark"));
    const moved = presenceFromPose({
      evaluation,
      recipe,
      joints,
      rig,
      rotations: body("benchmark"),
      placement: { id: "m", position: [2, 0.5, -1], facing: [1, 0, 0] },
    });
    expect(moved.position).toEqual([2, 0.5, -1]);
    expect(moved.anchors.head[1]).toBeCloseTo(rest.anchors.head[1] + 0.5, 5);
    expect(moved.anchors.face[0]).toBeGreaterThan(moved.anchors.head[0]);
  });
});

describe("the posed control mesh", () => {
  const kneel = body("benchmark");

  it("shares one skinning between grounding and presence, per evaluation and pose", () => {
    const first = posedControl(rig, evaluation, kneel);
    // The same pose again is the cached array, not a second skinning.
    expect(posedControl(rig, evaluation, kneel)).toBe(first);
    const kneeling = Float32Array.from(first);
    // Another pose of the evaluation overwrites that array (nothing is allocated per pose)…
    const t = body("tpose");
    const other = posedControl(rig, evaluation, t);
    expect(other).toBe(first);
    expect(other).not.toEqual(kneeling);
    expect(posedControl(rig, evaluation, t)).toBe(other);
    // …and asking for the kneel again skins it again, to what it was.
    expect(posedControl(rig, evaluation, kneel)).toEqual(kneeling);
    // Another evaluation has its own.
    expect(posedControl(rig, model.evaluate(recipe), kneel)).not.toBe(first);
  });

  it("grounds as the pose lifts it", () => {
    for (const rotations of [kneel, body("tpose"), composeRotations(kneel, body("tpose"))]) {
      const lift = groundOffsetOf(posedControl(rig, evaluation, rotations), rig.skin.bodyVertices);
      expect(lift).toBeCloseTo(
        posedGroundOffset(
          restBonesFrom(rig.bones, rig.parents, evaluation.boneHeads),
          rotations,
          evaluation.control,
          rig.skin,
        ),
        6,
      );
    }
  });

  it("puts a crouching figure's whole soles on the ground, heel and toe, not its toe tips", () => {
    const standingSole = (rotations: Float32Array, side: 1 | -1) => {
      const posed = posedControl(rig, evaluation, rotations);
      const lift = groundOffsetOf(posed, rig.skin.bodyVertices);
      const depths: number[] = [];
      for (const v of rig.skin.bodyVertices) {
        const x = posed[v * 3] as number;
        // The left foot is at +x; a vertex within 1 cm of the floor and over that foot.
        if (x * side > 0.04 && (posed[v * 3 + 1] as number) + lift < 0.01) {
          depths.push(posed[v * 3 + 2] as number);
        }
      }
      return Math.max(...depths) - Math.min(...depths);
    };
    // The bent pose folds the knees about 80° with the ankles bent back to keep the
    // soles level: the foot rests on its length, a good part of what it does standing.
    for (const side of [1, -1] as const)
      expect(standingSole(body("bent"), side)).toBeGreaterThan(
        0.6 * standingSole(body("tpose"), side),
      );
  });
});
