/**
 * The finger surface solver closes an actual skinned pad, through the
 * MakeHuman BVH channel layout.  It does not invent a separate finger rig.
 */
import { Group } from "three";
import { describe, expect, it } from "vitest";
import { HumanoidAffordances, type LiveFigure } from "../src/affordance/live.ts";
import { frameOut, landmarkAnchors } from "../src/foundation/landmarks.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { skinPose } from "../src/rig/dual.ts";
import {
  type FingerSurfaceFrame,
  fingerChannelLimits,
  solveFingerSurfaceTarget,
} from "../src/rig/fingerTarget.ts";
import {
  IDENTITY_POSE,
  jointChannelRotations,
  posedBones,
  type RotationChannel,
  restBones,
  rigData,
} from "../src/rig/pose.ts";
import { poseShare, skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const rig = rigData(assets);
const recipe = createRecipe({ macros: { age: 30, gender: 0.5, height: 0.5 } });
const evaluation = model.evaluate(recipe);
const rest = restBones(assets, evaluation.control);
const base = IDENTITY_POSE(rig.bones.length);
const anchors = { base: landmarkAnchors(model, "base"), adult: null };
const world = new Group();
const surfaceRest = Float32Array.from(evaluation.positions);
const surfaceNormals = Float32Array.from(evaluation.normals);

function live(rotations: Float32Array): LiveFigure {
  const pose = skinPose(rest, rotations, poseShare(rest, rotations, skinDualShare(rest.names)));
  return {
    surface: evaluation.surface,
    rest: surfaceRest,
    restNormals: surfaceNormals,
    skinIndex: model.topology().body.skinIndex,
    skinWeight: model.topology().body.skinWeight,
    pose: () => pose,
    folds: () => [],
    skeleton: () => posedBones(rest, rotations),
    world,
  };
}

function padReader(side: "L" | "R") {
  const handle = new HumanoidAffordances();
  handle.setRecipe(recipe);
  handle.setAnchors(anchors);
  return (rotations: Float32Array, out: FingerSurfaceFrame): FingerSurfaceFrame => {
    handle.attach(live(rotations));
    const posed = handle.frame(`finger-pad-2.${side}` as const, "figure", frameOut());
    if (!posed) throw new Error(`missing ${side} index pad`);
    out.position[0] = posed.position[0];
    out.position[1] = posed.position[1];
    out.position[2] = posed.position[2];
    out.normal[0] = posed.normal[0];
    out.normal[1] = posed.normal[1];
    out.normal[2] = posed.normal[2];
    return out;
  };
}

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );

describe("finger surface target", () => {
  const limits = fingerChannelLimits(rig, 2, "R", -75, 75);
  const pad = padReader("R");

  it("moves the actual skinned index pad through only its declared source channels", () => {
    const source = Float32Array.from(base);
    const head = rig.bones.indexOf("head");
    source[head * 4] = 0.1;
    source[head * 4 + 3] = Math.sqrt(0.99);
    const before: FingerSurfaceFrame = { position: [0, 0, 0], normal: [0, 0, 0] };
    pad(source, before);
    const exact = Float32Array.from(source);
    const values: Record<string, Partial<Record<RotationChannel, number>>> = {};
    limits.forEach((limit, index) => {
      let joint = values[limit.joint];
      if (!joint) {
        joint = {};
        values[limit.joint] = joint;
      }
      joint[limit.channel] = index === 0 ? 20 : limit.sourceDegrees;
    });
    jointChannelRotations(rig, values, exact);
    const targetFrame: FingerSurfaceFrame = { position: [0, 0, 0], normal: [0, 0, 0] };
    pad(exact, targetFrame);
    const target = targetFrame.position;
    const firstStep = Float32Array.from(source);
    const firstValues: Record<string, Partial<Record<RotationChannel, number>>> = {};
    limits.forEach((limit, index) => {
      let joint = firstValues[limit.joint];
      if (!joint) {
        joint = {};
        firstValues[limit.joint] = joint;
      }
      joint[limit.channel] = index === 0 ? 8 : limit.sourceDegrees;
    });
    jointChannelRotations(rig, firstValues, firstStep);
    const firstFrame: FingerSurfaceFrame = { position: [0, 0, 0], normal: [0, 0, 0] };
    pad(firstStep, firstFrame);
    expect(distance(firstFrame.position, target)).toBeLessThan(distance(before.position, target));
    const out = new Float32Array(source.length);
    const result = solveFingerSurfaceTarget({
      rest,
      rig,
      rotations: source,
      side: "R",
      digit: 2,
      channels: limits,
      sample: pad,
      target: () => ({ position: target, normal: [0, 0, 1] }),
      tolerance: 0.003,
      out,
    });
    expect(result.status, JSON.stringify(result)).toBe("reached");
    expect(result.distance).toBeLessThanOrEqual(0.003);
    expect(result.surfaceSamples).toBeGreaterThan(1);
    expect(result.surfaceSamples).toBeLessThanOrEqual(1 + 20 * (limits.length * 3 + 2));
    expect(distance(result.pad.position, target)).toBeLessThanOrEqual(0.003);
    expect(Math.hypot(...result.pad.normal)).toBeCloseTo(1, 5);
    expect(out[head * 4 + 3]).toBe(source[head * 4 + 3]);
    expect(source[head * 4]).toBeCloseTo(0.1);
    for (let bone = 0; bone < rig.bones.length; bone++) {
      const name = rig.bones[bone] as string;
      if (name.startsWith("finger2-") && name.endsWith(".R")) continue;
      expect(Array.from(out.subarray(bone * 4, bone * 4 + 4))).toEqual(
        Array.from(source.subarray(bone * 4, bone * 4 + 4)),
      );
    }
    const reordered = solveFingerSurfaceTarget({
      rest,
      rig,
      rotations: source,
      side: "R",
      digit: 2,
      channels: [...limits].reverse(),
      sample: pad,
      target: () => ({ position: target }),
      tolerance: 0.003,
    });
    expect(reordered.status, JSON.stringify(reordered)).toBe("reached");
  });

  it("reports a fixed-surface target that its declared channels cannot reach", () => {
    const before: FingerSurfaceFrame = { position: [0, 0, 0], normal: [0, 0, 0] };
    pad(base, before);
    const frozen = limits.map((limit) => ({ ...limit, minDegrees: 0, maxDegrees: 0 }));
    const result = solveFingerSurfaceTarget({
      rest,
      rig,
      rotations: base,
      side: "R",
      digit: 2,
      channels: frozen,
      sample: pad,
      target: () => ({
        position: [before.position[0] + 0.04, before.position[1], before.position[2]],
      }),
      tolerance: 0.001,
    });
    expect(result.status).toBe("unreached");
    expect(result.reason).toBe("limits");
  });

  it("rejects an incomplete or mismatched source-channel declaration", () => {
    const missing = limits.slice(1);
    expect(() =>
      solveFingerSurfaceTarget({
        rest,
        rig,
        rotations: base,
        side: "R",
        digit: 2,
        channels: missing,
        sample: pad,
        target: () => ({ position: [0, 0, 0] }),
      }),
    ).toThrow(/every source rotation channel/);
  });

  it("uses the source layout on the left as well as the right", () => {
    const leftLimits = fingerChannelLimits(rig, 2, "L", -75, 75);
    const leftPad = padReader("L");
    const exact = Float32Array.from(base);
    const values: Record<string, Partial<Record<RotationChannel, number>>> = {};
    leftLimits.forEach((limit, index) => {
      let joint = values[limit.joint];
      if (!joint) {
        joint = {};
        values[limit.joint] = joint;
      }
      joint[limit.channel] = index === 0 ? 12 : limit.sourceDegrees;
    });
    jointChannelRotations(rig, values, exact);
    const target: FingerSurfaceFrame = { position: [0, 0, 0], normal: [0, 0, 0] };
    leftPad(exact, target);
    const result = solveFingerSurfaceTarget({
      rest,
      rig,
      rotations: base,
      side: "L",
      digit: 2,
      channels: leftLimits,
      sample: leftPad,
      target: () => ({ position: target.position }),
      tolerance: 0.003,
    });
    expect(result.status, JSON.stringify(result)).toBe("reached");
  });
});
