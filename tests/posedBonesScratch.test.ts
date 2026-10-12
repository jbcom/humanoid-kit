import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { boneTransforms } from "../src/rig/bones.ts";
import { IDENTITY_POSE, posedBonesInto, posedBonesScratch, restBones } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const rest = restBones(assets, model.evaluate(createRecipe({ macros: { age: 30 } })).control);

describe("posedBonesInto", () => {
  it("is byte-parity with the allocating pose transform and reuses its buffers", () => {
    const rotations = IDENTITY_POSE(rest.names.length);
    const scratch = posedBonesScratch(rest);
    const first = posedBonesInto(rest, rotations, scratch);
    const expected = boneTransforms(rest, rotations);
    expect(first).toBe(scratch);
    expect(first.world).toBe(scratch.world);
    expect(first.heads).toBe(scratch.heads);
    expect([...first.world]).toEqual([...expected.world]);
    expect([...first.heads]).toEqual([...expected.origin]);

    rotations[4] = Math.sin(0.2);
    rotations[7] = Math.cos(0.2);
    const next = posedBonesInto(rest, rotations, scratch);
    const changed = boneTransforms(rest, rotations);
    expect(next.world).toBe(first.world);
    expect(next.heads).toBe(first.heads);
    expect([...next.world]).toEqual([...changed.world]);
    expect([...next.heads]).toEqual([...changed.origin]);
  });

  it("rejects an incorrectly sized rotation or scratch buffer", () => {
    const rotations = IDENTITY_POSE(rest.names.length);
    expect(() => posedBonesInto(rest, rotations.subarray(0, -1), posedBonesScratch(rest))).toThrow(
      RangeError,
    );
    expect(() =>
      posedBonesInto(rest, rotations, {
        world: new Float32Array(rest.names.length * 4 - 1),
        heads: new Float32Array(rest.names.length * 3),
      }),
    ).toThrow(RangeError);
  });
});
