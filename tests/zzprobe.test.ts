import { Group, Vector3 } from "three";
import { it } from "vitest";
import { HumanoidAffordances, type LiveFigure } from "../src/affordance/live.ts";
import { frameOut, landmarkAnchors } from "../src/foundation/landmarks.ts";
import { type Evaluation, HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { armChain, armTip, solveArmTarget } from "../src/rig/armTarget.ts";
import { skinPose } from "../src/rig/dual.ts";
import { IDENTITY_POSE, posedBones, restBones, rigData } from "../src/rig/pose.ts";
import { poseShare, skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const rigDataFor = rigData(assets);
const base = IDENTITY_POSE(rigDataFor.bones.length);
const anchors = { base: landmarkAnchors(model, "base"), adult: null };

function live(evaluation: Evaluation, rotations: Float32Array, world: Group): LiveFigure {
  const rest = restBones(assets, evaluation.control);
  const pose = skinPose(rest, rotations, poseShare(rest, rotations, skinDualShare(rest.names)));
  return {
    surface: evaluation.surface,
    rest: Float32Array.from(evaluation.positions),
    restNormals: Float32Array.from(evaluation.normals),
    skinIndex: model.topology().body.skinIndex,
    skinWeight: model.topology().body.skinWeight,
    pose: () => pose,
    folds: () => [],
    skeleton: () => posedBones(rest, rotations),
    world,
  };
}
function handFrame(recipe: Recipe, evaluation: Evaluation, rotations: Float32Array, world: Group) {
  const handle = new HumanoidAffordances();
  handle.setRecipe(recipe);
  handle.setAnchors(anchors);
  handle.attach(live(evaluation, rotations, world));
  const frame = handle.frame("hand.R", "world", frameOut());
  if (!frame) throw new Error("no frame");
  return frame;
}
function toLocal(world: Group, point: readonly number[]) {
  world.updateWorldMatrix(true, false);
  return new Vector3(...point).applyMatrix4(world.matrixWorld.clone().invert()).toArray() as [
    number,
    number,
    number,
  ];
}
const d = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

it("probe", { timeout: 600_000 }, () => {
  const target: [number, number, number] = [0.043, 1.15, 0];
  for (const [label, macros, x, ry] of [
    ["tall", { age: 25, gender: 0.85, height: 0.8 }, -0.3, Math.PI / 2],
    ["short", { age: 25, gender: 0.15, height: 0.2 }, 0.3, -Math.PI / 2],
  ] as const) {
    const recipe = createRecipe({ macros });
    const evaluation = model.evaluate(recipe);
    const rest = restBones(assets, evaluation.control);
    const world = new Group();
    world.position.set(x, evaluation.groundOffset, 0);
    world.rotation.y = ry;
    const chain = armChain(rest, "R");
    const before = handFrame(recipe, evaluation, base, world);
    const localTarget = toLocal(world, target);
    const tip = armTip(rest, base, chain, toLocal(world, before.position));
    const trace: number[] = [];
    const rigid: number[] = [];
    const result = solveArmTarget({
      rest,
      rotations: base,
      chain,
      tip,
      target: { position: localTarget },
      tolerance: 0.01,
      effector: (rotations) => {
        const p = toLocal(world, handFrame(recipe, evaluation, rotations, world).position);
        trace.push(d(p, localTarget));
        // rigid tip end
        const posed = posedBones(rest, rotations);
        const f = chain.at(-1)!;
        const q = [
          posed.world[f * 4]!,
          posed.world[f * 4 + 1]!,
          posed.world[f * 4 + 2]!,
          posed.world[f * 4 + 3]!,
        ];
        const v = new Vector3(...tip.position).applyQuaternion({
          x: q[0],
          y: q[1],
          z: q[2],
          w: q[3],
        } as never);
        const e = [
          posed.heads[f * 3]! + v.x,
          posed.heads[f * 3 + 1]! + v.y,
          posed.heads[f * 3 + 2]! + v.z,
        ];
        rigid.push(d(e, p));
        return { position: p };
      },
    });
    const norms = chain.map((b) => {
      const r = result.rotations;
      return Math.hypot(r[b * 4]!, r[b * 4 + 1]!, r[b * 4 + 2]!, r[b * 4 + 3]!).toFixed(6);
    });
    const angles = chain.map((b) => {
      const r = result.rotations;
      return (
        (2 *
          Math.acos(
            Math.min(
              1,
              Math.abs(r[b * 4 + 3]!) /
                Math.hypot(r[b * 4]!, r[b * 4 + 1]!, r[b * 4 + 2]!, r[b * 4 + 3]!),
            ),
          ) *
          180) /
        Math.PI
      ).toFixed(1);
    });
    console.log(label, result.status, result.distance.toFixed(4), "steps", trace.length);
    console.log(" trace", trace.map((t) => t.toFixed(4)).join(" "));
    console.log(
      " skin-vs-rigid",
      rigid
        .filter((_, i) => i % 6 === 5)
        .map((t) => t.toFixed(4))
        .join(" "),
    );
    console.log(" norms", norms.join(" "), "angles", angles.join(" "));
  }
});
