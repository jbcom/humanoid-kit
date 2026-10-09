/**
 * The dual quaternion share that falls as a bone swings (src/rig/skinShare.ts,
 * docs/ARCHITECTURE.md, "Skinning artefacts"): the thigh's, so a flexed hip does
 * not bulge, while a twisted thigh keeps dual quaternion skinning.
 */
import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { DualBones } from "../src/render/dualSkinning.ts";
import { IDENTITY_POSE, restBones } from "../src/rig/pose.ts";
import { mul, type Quat } from "../src/rig/quat.ts";
import { poseShare, SKIN_SWING_SHARE, skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const rest = restBones(
  assets,
  new HumanoidModel(assets, { subdivision: 0 }).evaluate(createRecipe()).control,
);
const base = skinDualShare(rest.names);
const n = rest.names.length;
const bone = (name: string) => rest.names.indexOf(name);

type Vec = [number, number, number];
const unit = (v: number[]): Vec => {
  const l = Math.hypot(...v);
  return [(v[0] as number) / l, (v[1] as number) / l, (v[2] as number) / l];
};
const cross = (a: number[], b: number[]): Vec => [
  (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
  (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
  (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
];
/** The unit vector along the thigh at rest. */
const thighAxis = (side: "L" | "R"): Vec => {
  const [a, b] = [bone(`upperleg01.${side}`), bone(`lowerleg01.${side}`)];
  return unit(
    [0, 1, 2].map((k) => (rest.heads[b * 3 + k] as number) - (rest.heads[a * 3 + k] as number)),
  );
};
/** Two axes at right angles to the thigh and to each other: turning about one is a pure swing. */
const swingAxes = (side: "L" | "R"): [Vec, Vec] => {
  const a = thighAxis(side);
  const p = unit(cross(a, [1, 0, 0]));
  return [p, unit(cross(a, p))];
};
const quat = (axis: Vec, degrees: number): Quat => {
  const h = (degrees * Math.PI) / 360;
  return [axis[0] * Math.sin(h), axis[1] * Math.sin(h), axis[2] * Math.sin(h), Math.cos(h)];
};
const pose = (name: string, q: Quat) => {
  const r = IDENTITY_POSE(n);
  r.set(q, bone(name) * 4);
  return r;
};
const shareOf = (rotations: Float32Array, name: string) =>
  (poseShare(rest, rotations, base) as Float32Array)[bone(name)] as number;

describe("the share that falls as a bone swings", () => {
  it("names the thigh, falling to a quarter by 120° of swing", () => {
    expect(SKIN_SWING_SHARE.upperleg01).toEqual({ share: 0.25, degrees: 120, along: "lowerleg01" });
  });

  it("is the table's share at rest, and leaves the table itself alone", () => {
    const before = Array.from(base);
    const share = poseShare(rest, IDENTITY_POSE(n), base);
    expect(Array.from(share)).toEqual(before);
    expect(share).not.toBe(base);
    poseShare(rest, pose("upperleg01.L", quat(swingAxes("L")[0], -120)), base);
    expect(Array.from(base)).toEqual(before);
  });

  it("falls from the table's share to the swung share as the thigh flexes, in proportion", () => {
    for (const side of ["L", "R"] as const) {
      const name = `upperleg01.${side}`;
      const [axis] = swingAxes(side);
      expect(shareOf(pose(name, quat(axis, -120)), name)).toBeCloseTo(0.25, 4);
      expect(shareOf(pose(name, quat(axis, -60)), name)).toBeCloseTo(0.625, 4);
      // Past the end of the range it stays there.
      expect(shareOf(pose(name, quat(axis, -150)), name)).toBeCloseTo(0.25, 4);
    }
  });

  it("counts a swing in any direction alike", () => {
    const [p, q] = swingAxes("L");
    const forward = shareOf(pose("upperleg01.L", quat(p, -90)), "upperleg01.L");
    const sideways = shareOf(pose("upperleg01.L", quat(q, -90)), "upperleg01.L");
    expect(forward).toBeCloseTo(0.4375, 4);
    expect(sideways).toBeCloseTo(forward, 4);
  });

  it("does not count a twist about the thigh as a swing: a twisted thigh stays dual quaternion", () => {
    for (const degrees of [30, 90, 180])
      expect(
        shareOf(pose("upperleg01.L", quat(thighAxis("L"), degrees)), "upperleg01.L"),
      ).toBeCloseTo(1, 3);
  });

  it("counts only the swing of a thigh that also twists", () => {
    // A 90° twist about the thigh, then a 60° swing: the share is the swing's alone.
    const twisted = mul(quat(swingAxes("L")[0], -60), quat(thighAxis("L"), 90));
    expect(shareOf(pose("upperleg01.L", twisted), "upperleg01.L")).toBeCloseTo(0.625, 3);
  });

  it("leaves every other bone's share where the table has it", () => {
    const share = poseShare(rest, pose("upperleg01.L", quat(swingAxes("L")[0], -120)), base);
    rest.names.forEach((name, b) => {
      if (name !== "upperleg01.L") expect(share[b], name).toBe(base[b]);
    });
  });
});

describe("the renderer's bone texture", () => {
  it("carries the swung share, as the CPU reference uses it", () => {
    const dual = new DualBones(n, base);
    dual.update(rest, pose("upperleg01.R", quat(swingAxes("R")[0], -120)));
    const b = bone("upperleg01.R");
    // Three texels a bone: the dual quaternion, then the share in the third's first channel.
    expect(dual.data[b * 12 + 8]).toBeCloseTo(0.25, 4);
    expect(dual.data[bone("upperleg01.L") * 12 + 8]).toBeCloseTo(1, 4);
    const posed = dual.pose();
    expect(posed).not.toBeNull();
    expect((posed as NonNullable<typeof posed>).share as Float32Array).toHaveProperty("length", n);
    expect(((posed as NonNullable<typeof posed>).share as Float32Array)[b]).toBeCloseTo(0.25, 4);
  });
});
