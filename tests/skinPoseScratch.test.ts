import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  dualBones,
  dualBonesFromPosedInto,
  skinPose,
  skinPoseInto,
  skinPoseScratch,
} from "../src/rig/dual.ts";
import { IDENTITY_POSE, posedBones, restBones } from "../src/rig/pose.ts";
import { skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const rest = restBones(assets, model.evaluate(createRecipe({ macros: { age: 30 } })).control);
const share = skinDualShare(rest.names);

describe("scratch skin pose", () => {
  it("is byte-parity with allocating dual and skin pose paths", () => {
    const rotations = IDENTITY_POSE(rest.names.length);
    rotations[4] = Math.sin(0.17);
    rotations[7] = Math.cos(0.17);
    const scratch = skinPoseScratch(rest, share);
    const into = skinPoseInto(rest, rotations, share, scratch);
    const allocating = skinPose(rest, rotations, share);
    expect([...into.dual]).toEqual([...allocating.dual]);
    expect([...into.matrix]).toEqual([...allocating.matrix]);
    expect([...into.trans]).toEqual([...allocating.trans]);
    expect([...scratch.skeleton.world]).toEqual([...posedBones(rest, rotations).world]);
    expect([...scratch.skeleton.heads]).toEqual([...posedBones(rest, rotations).heads]);
    expect([...dualBonesFromPosedInto(rest, scratch.skeleton)]).toEqual([
      ...dualBones(rest, rotations),
    ]);
  });

  it("retains its arrays while replacing the transient pose", () => {
    const scratch = skinPoseScratch(rest, share);
    const rotations = IDENTITY_POSE(rest.names.length);
    const first = skinPoseInto(rest, rotations, share, scratch);
    rotations[8] = Math.sin(0.11);
    rotations[11] = Math.cos(0.11);
    const next = skinPoseInto(rest, rotations, share, scratch);
    expect(next).toBe(first);
    expect(next.dual).toBe(scratch.pose.dual);
    expect(next.matrix).toBe(scratch.pose.matrix);
    expect(next.trans).toBe(scratch.pose.trans);
  });
});
