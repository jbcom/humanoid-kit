/**
 * Frozen CPU outputs recorded from commit dd05b50 before the transient-pose
 * allocation refactor. They deliberately do not compare old and new helpers:
 * this catches a shared regression in dual/quaternion math.
 */
import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { skinOfEvaluation } from "../src/model/reservoirSkin.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  skinFold,
  skinNormalAt,
  skinPoseInto,
  skinPoseScratch,
  skinPositionAt,
} from "../src/rig/dual.ts";
import { renderFold } from "../src/rig/hipFold.ts";
import { bodyPoseRotations, restBones, rigData } from "../src/rig/pose.ts";
import { poseShare, skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const recipe = createRecipe({ macros: { age: 31, gender: 0.76, height: 0.78 } });

const expectVector = (actual: ArrayLike<number>, expected: readonly number[]) => {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index] as number).toBeCloseTo(value, 6);
  });
};

function solvedFold() {
  const steps = model.hipFold(recipe);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value.fold;
}

describe("pre-refactor CPU skinning goldens", { timeout: 300_000 }, () => {
  it("preserves a dynamic-share seated fold and nonzero hand contact", () => {
    const evaluation = model.evaluate(recipe);
    const rest = restBones(assets, evaluation.control);
    const rotations = bodyPoseRotations(rigData(assets), "seated");
    const share = poseShare(rest, rotations, skinDualShare(rest.names));
    const scratch = skinPoseScratch(rest, share);
    const pose = skinPoseInto(rest, rotations, share, scratch);
    const fold = skinFold(rest, rotations, renderFold(solvedFold()), 1);
    expect(fold).not.toBeNull();
    if (!fold) throw new Error("expected seated fold");
    const { skinIndex, skinWeight } = skinOfEvaluation(evaluation, model.topology().body);
    expectVector(
      [
        share[rest.names.indexOf("upperleg01.L")] as number,
        share[rest.names.indexOf("upperleg01.R")] as number,
      ],
      [0.4406425654888153, 0.4406425654888153],
    );
    const upperleg = rest.names.indexOf("upperleg01.R");
    expectVector(
      pose.dual.subarray(upperleg * 8, upperleg * 8 + 8),
      [
        -0.7071067690849304, 0, 0, 0.7071067690849304, 0, 0.0007376911235041916, 0.2291368991136551,
        0,
      ],
    );
    const sample = (vertex: number) => {
      const point = new Float32Array(3);
      const normal = new Float32Array(3);
      skinPositionAt(
        pose,
        skinIndex,
        skinWeight,
        vertex,
        evaluation.positions[vertex * 3] as number,
        evaluation.positions[vertex * 3 + 1] as number,
        evaluation.positions[vertex * 3 + 2] as number,
        point,
        0,
        fold,
      );
      skinNormalAt(
        pose,
        skinIndex,
        skinWeight,
        vertex,
        evaluation.normals[vertex * 3] as number,
        evaluation.normals[vertex * 3 + 1] as number,
        evaluation.normals[vertex * 3 + 2] as number,
        normal,
        0,
        fold,
      );
      return { point, normal };
    };
    const hand = sample(14601);
    expectVector(hand.point, [-0.5851667523384094, 0.4323972761631012, 0.2781054675579071]);
    expectVector(hand.normal, [0.7272409200668335, -0.6389861702919006, 0.2506338953971863]);
    const folded = sample(7008);
    expectVector(folded.point, [-0.10972228646278381, 0.7321313619613647, 0.16601873934268951]);
    expectVector(folded.normal, [-0.3272184133529663, -0.30382823944091797, 0.8947717547416687]);
  });
});
