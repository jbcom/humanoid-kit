import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  bodyPoseRotations,
  IDENTITY_POSE,
  posedGroundOffset,
  restBonesFrom,
  rigData,
  skinPositions,
} from "../src/rig/pose.ts";
import { loadClothedAssets } from "./fixtures.ts";

describe("a posed figure in shoes", { timeout: 120_000 }, () => {
  const assets = loadClothedAssets();
  const model = new HumanoidModel(assets, { subdivision: 0 });
  const rig = rigData(assets);

  it("stands on its shoes in any pose, not on the feet inside them", () => {
    // shoes03's soles reach 2.2 cm below the foot inside them.
    const ev = model.evaluate(createRecipe({ outfit: ["shoes/shoes03"] }));
    const t = model.garmentTopology("shoes/shoes03");
    const positions = (ev.garments[0] as { positions: Float32Array }).positions;
    const worn = [{ positions, skinIndex: t.skinIndex, skinWeight: t.skinWeight }];
    const fromHeads = restBonesFrom(rig.bones, model.boneParents(), ev.boneHeads);
    const skin = model.rigSkin();
    // At rest it agrees with the evaluation's own ground offset, which counts the soles.
    const rest = IDENTITY_POSE(rig.bones.length);
    expect(posedGroundOffset(fromHeads, rest, ev.control, skin, worn)).toBeCloseTo(
      ev.groundOffset,
      6,
    );
    expect(posedGroundOffset(fromHeads, rest, ev.control, skin)).toBeLessThan(
      ev.groundOffset - 0.02,
    );
    // Kneeling, the lowest point of body and shoes together rests on the ground.
    const kneel = bodyPoseRotations(rig, "benchmark");
    const lift = posedGroundOffset(fromHeads, kneel, ev.control, skin, worn);
    expect(lift).toBeGreaterThanOrEqual(posedGroundOffset(fromHeads, kneel, ev.control, skin));
    const posed = skinPositions(
      fromHeads,
      kneel,
      positions,
      t.skinIndex,
      t.skinWeight,
      new Float32Array(positions.length),
    );
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 1; i < posed.length; i += 3) lowest = Math.min(lowest, posed[i] as number);
    expect(lowest + lift).toBeGreaterThanOrEqual(-1e-6);
  });
});
