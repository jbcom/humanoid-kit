import { expect, it } from "vitest";
import { landmarkAnchors } from "../src/foundation/landmarks.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { measuredHandWorkspaces } from "../src/presence/handWorkspace.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyPoseRotations, restBones, restBonesFrom, rigData } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

it("matches fresh workspaces through mutable source poses and replacement geometry", () => {
  const assets = loadFixtureAssets();
  const model = new HumanoidModel(assets, { subdivision: 1 });
  const evaluation = model.evaluate(createRecipe({ macros: { age: 30, height: 0.8 } }));
  const rest = restBones(assets, evaluation.control);
  const geometry = {
    anchors: landmarkAnchors(model, "base"),
    skinIndex: model.topology().body.skinIndex,
    skinWeight: model.topology().body.skinWeight,
  };
  const originalAnchors = structuredClone(geometry.anchors);
  const buffers = [
    evaluation.positions,
    evaluation.normals,
    rest.heads,
    rest.parents,
    geometry.skinIndex,
    geometry.skinWeight,
  ];
  const before = buffers.map((buffer) =>
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice(),
  );
  const rotations = bodyPoseRotations(rigData(assets), "tpose");
  for (const name of ["tpose", "seated", "benchmark", "tpose"]) {
    rotations.set(bodyPoseRotations(rigData(assets), name));
    // presenceFromPose recreates the RestBones wrapper; identical rig values still reuse scratch.
    const wrapper = restBonesFrom(rest.names, rest.parents, rest.heads);
    const sourceBytes = new Uint8Array(rotations.buffer).slice();
    const actual = measuredHandWorkspaces(evaluation, wrapper, rotations, geometry, 0.1);
    const saved = structuredClone(actual);
    const fresh = measuredHandWorkspaces({ ...evaluation }, wrapper, rotations, geometry, 0.1);
    expect(actual).toEqual(fresh);
    expect(measuredHandWorkspaces(evaluation, wrapper, rotations, geometry, 0.1)).toBe(actual);
    const lifted = measuredHandWorkspaces(evaluation, wrapper, rotations, geometry, 0.2);
    expect(lifted.L.shoulder[1]).toBeCloseTo(actual.L.shoulder[1] + 0.1, 14);
    expect(actual).toEqual(saved);
    expect(new Uint8Array(rotations.buffer)).toEqual(sourceBytes);
    expect(geometry.anchors).toEqual(originalAnchors);
  }
  // Replace properties on the same wrapper: identity snapshots must not accidentally follow it.
  const oldGeometry = measuredHandWorkspaces(evaluation, rest, rotations, geometry, 0);
  geometry.skinWeight = Float32Array.from(geometry.skinWeight);
  geometry.skinIndex = geometry.skinIndex.slice();
  geometry.anchors = landmarkAnchors(model, "base");
  expect(measuredHandWorkspaces(evaluation, rest, rotations, geometry, 0)).not.toBe(oldGeometry);
  expect(measuredHandWorkspaces(evaluation, rest, rotations, geometry, 0)).toEqual(
    measuredHandWorkspaces({ ...evaluation }, rest, rotations, geometry, 0),
  );
  buffers.forEach((buffer, i) => {
    expect(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)).toEqual(before[i]);
  });
});
