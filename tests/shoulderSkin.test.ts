/**
 * The shoulder under a raised arm (issue #67): the skin over the clavicle and
 * the deltoid must bend, not tear. Its weights come from MakeHuman, which
 * skins with every influence a vertex has (up to 12 on the shoulder), and the
 * arm's raise must be shared along the clavicle, shoulder and upper arm, as
 * MakeHuman's own poses share it. Cut either and the cap tears: a vertex that
 * loses its smaller influences stays behind while its neighbour follows the arm
 * (the notch between the clavicle and the deltoid), and a raise put on the
 * upper arm alone folds the cap over (the plate).
 */
import { describe, expect, it } from "vitest";
import { bodyTriangles, patchCreases, shoulderCap } from "../scripts/lib/skinMeasure.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyPoseRotations, restBones, rigData, skinPositions } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const rig = rigData(assets);
const tris = bodyTriangles(assets);
const model = new HumanoidModel(assets, { subdivision: 0 });
const figures = [0, 1].map((gender) => {
  const control = model.evaluate(createRecipe({ macros: { gender } })).control;
  const rest = restBones(assets, control);
  const b = rest.names.indexOf("upperarm01.L");
  const head = [0, 1, 2].map((k) => rest.heads[b * 3 + k] as number) as [number, number, number];
  return { gender, control, rest, cap: shoulderCap(control, tris, head) };
});
const creases = (f: (typeof figures)[number], pose: string) =>
  patchCreases(
    f.control,
    skinPositions(
      f.rest,
      bodyPoseRotations(rig, pose),
      f.control,
      assets.skinIndex,
      assets.skinWeight,
      new Float32Array(f.control.length),
    ),
    tris,
    f.cap,
  );

describe("the shoulder under a raised arm", () => {
  it("keeps up to eight of MakeHuman's influences a vertex", () => {
    const n = assets.manifest.vertexCount;
    expect(assets.skinWeight.length).toBe(n * 8);
    let past4 = 0;
    for (let v = 0; v < n; v++) if ((assets.skinWeight[v * 8 + 4] as number) > 0) past4++;
    // MakeHuman's default weights give 3,665 of the base mesh's vertices five or more.
    expect(past4).toBeGreaterThan(3000);
  });

  // [pose, the 99th percentile an edge may gain, the edges allowed past 60°]
  const bounds: [string, number, number][] = [
    ["tpose", 30, 0],
    ["benchmark", 55, 2],
    ["overhead", 60, 2],
  ];
  for (const [pose, p99, over60] of bounds)
    it(`bends the cap without a tear in ${pose}`, () => {
      for (const f of figures) {
        const c = creases(f, pose);
        expect(c.edges, "the cap is found").toBeGreaterThan(200);
        expect(c.p99, `gender ${f.gender} ${pose} p99`).toBeLessThan(p99);
        expect(c.over60, `gender ${f.gender} ${pose} edges past 60°`).toBeLessThanOrEqual(over60);
      }
    });

  it("shares the overhead raise along the clavicle and the shoulder, as MakeHuman's benchmark does", () => {
    const r = bodyPoseRotations(rig, "overhead");
    const angle = (bone: string) => {
      const b = rig.bones.indexOf(bone);
      return (2 * Math.acos(Math.min(1, Math.abs(r[b * 4 + 3] as number))) * 180) / Math.PI;
    };
    for (const side of ["L", "R"]) {
      const clavicle = angle(`clavicle.${side}`);
      const shoulder = angle(`shoulder01.${side}`);
      const arm = angle(`upperarm01.${side}`);
      // The benchmark's arms overhead: clavicle 43°, shoulder 13°, upper arm 75°.
      expect(clavicle, side).toBeGreaterThan(20);
      expect(shoulder, side).toBeGreaterThan(5);
      expect(arm / (clavicle + shoulder + arm), side).toBeLessThan(0.75);
    }
  });
});
