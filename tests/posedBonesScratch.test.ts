import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { boneTransforms, type RestBones } from "../src/rig/bones.ts";
import { IDENTITY_POSE, posedBonesInto, posedBonesScratch, restBones } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const rest = restBones(assets, model.evaluate(createRecipe({ macros: { age: 30 } })).control);

function threeBone(restHeads = Float32Array.from([0, 0, 0, 0, 1, 0, 0, 2, 0])): RestBones {
  return {
    names: ["root", "parent", "child"],
    parents: Int16Array.from([-1, 0, 1]),
    heads: restHeads,
    order: Int16Array.from([0, 1, 2]),
  };
}

function rootTurn(rest: RestBones) {
  const rotations = IDENTITY_POSE(rest.names.length);
  rotations[2] = Math.SQRT1_2;
  rotations[3] = Math.SQRT1_2;
  return rotations;
}

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

  it("rejects overlapping source and scratch views before a rotated parent can corrupt a child", () => {
    const local = threeBone();
    const rotations = rootTurn(local);
    const before = Float32Array.from(local.heads);
    expect(() =>
      posedBonesInto(local, rotations, {
        world: new Float32Array(local.names.length * 4),
        heads: local.heads,
      }),
    ).toThrow("output overlaps an input view");
    expect(local.heads).toEqual(before);

    const buffer = new ArrayBuffer((9 + 12 + 12 + 9) * Float32Array.BYTES_PER_ELEMENT);
    const safe = threeBone(new Float32Array(buffer, 0, 9));
    safe.heads.set(before);
    const safeRotations = new Float32Array(buffer, 9 * 4, 12);
    safeRotations.set(rootTurn(safe));
    const posed = posedBonesInto(safe, safeRotations, {
      world: new Float32Array(buffer, (9 + 12) * 4, 12),
      heads: new Float32Array(buffer, (9 + 12 + 12) * 4, 9),
    });
    expect(posed.heads[6]).toBeCloseTo(-2, 6);
    expect(posed.heads[7]).toBeCloseTo(0, 6);
    expect(posed.heads[8]).toBeCloseTo(0, 6);
  });
});
