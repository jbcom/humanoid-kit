import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  DUAL_STRIDE,
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

  it("rejects malformed posed, scratch and share shapes before writing output", () => {
    const rotations = IDENTITY_POSE(rest.names.length);
    const posed = posedBones(rest, rotations);
    const output = new Float32Array(rest.names.length * DUAL_STRIDE).fill(17);
    const outputBefore = Float32Array.from(output);
    expect(() =>
      dualBonesFromPosedInto(
        rest,
        { world: new Float32Array(rest.names.length * 4 - 1), heads: posed.heads },
        output,
      ),
    ).toThrow("posed skeleton does not match");
    expect(output).toEqual(outputBefore);

    const malformedScratch = skinPoseScratch(rest, share);
    malformedScratch.pose.matrix = new Float32Array(rest.names.length * 9 - 1).fill(23);
    const scratchOutputs = [
      Float32Array.from(malformedScratch.pose.dual),
      Float32Array.from(malformedScratch.pose.matrix),
      Float32Array.from(malformedScratch.pose.trans),
      Float32Array.from(malformedScratch.skeleton.world),
      Float32Array.from(malformedScratch.skeleton.heads),
    ];
    expect(() => skinPoseInto(rest, rotations, share, malformedScratch)).toThrow(
      "scratch does not match",
    );
    expect(malformedScratch.pose.dual).toEqual(scratchOutputs[0]);
    expect(malformedScratch.pose.matrix).toEqual(scratchOutputs[1]);
    expect(malformedScratch.pose.trans).toEqual(scratchOutputs[2]);
    expect(malformedScratch.skeleton.world).toEqual(scratchOutputs[3]);
    expect(malformedScratch.skeleton.heads).toEqual(scratchOutputs[4]);

    const malformedShareScratch = skinPoseScratch(rest, share);
    malformedShareScratch.pose.dual.fill(29);
    const dualBefore = Float32Array.from(malformedShareScratch.pose.dual);
    expect(() =>
      skinPoseInto(rest, rotations, new Float32Array(rest.names.length - 1), malformedShareScratch),
    ).toThrow("share does not match");
    expect(malformedShareScratch.pose.dual).toEqual(dualBefore);
  });

  it("rejects offset overlapping views in dual and combined pose scratch", () => {
    const rotations = IDENTITY_POSE(rest.names.length);
    const skeleton = posedBones(rest, rotations);
    const dualBuffer = new ArrayBuffer(
      (rest.names.length * 12 + 1) * Float32Array.BYTES_PER_ELEMENT,
    );
    const overlappingDual = new Float32Array(
      dualBuffer,
      Float32Array.BYTES_PER_ELEMENT,
      rest.names.length * 8,
    );
    const worldAlias = new Float32Array(dualBuffer, 0, rest.names.length * 4);
    expect(() =>
      dualBonesFromPosedInto(rest, { world: worldAlias, heads: skeleton.heads }, overlappingDual),
    ).toThrow("output overlaps an input view");

    const scratch = skinPoseScratch(rest, share);
    const poseBuffer = new ArrayBuffer(
      (rest.names.length * (DUAL_STRIDE + 9 + 3) + 1) * Float32Array.BYTES_PER_ELEMENT,
    );
    scratch.pose.dual = new Float32Array(poseBuffer, 0, rest.names.length * DUAL_STRIDE);
    scratch.pose.matrix = new Float32Array(
      poseBuffer,
      Float32Array.BYTES_PER_ELEMENT,
      rest.names.length * 9,
    );
    scratch.pose.trans = new Float32Array(
      poseBuffer,
      rest.names.length * (DUAL_STRIDE + 9) * Float32Array.BYTES_PER_ELEMENT,
      rest.names.length * 3,
    );
    expect(() => skinPoseInto(rest, rotations, share, scratch)).toThrow(
      "output overlaps an input view",
    );

    const duplicated = skinPoseScratch(rest, share);
    const writableSkeleton = duplicated.skeleton as { world: Float32Array; heads: Float32Array };
    writableSkeleton.heads = duplicated.pose.trans;
    expect(() => skinPoseInto(rest, rotations, share, duplicated)).toThrow(
      "output overlaps an input view",
    );
  });
});
