import { Group, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createArmSkinnedFrameSampler } from "../src/affordance/armSkinnedFrameSampler.ts";
import { HumanoidAffordances, type LiveFigure } from "../src/affordance/live.ts";
import { type FrameOut, frameOut, landmarkAnchors } from "../src/foundation/landmarks.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe, type Recipe } from "../src/recipe/recipe.ts";
import { armChain, armTip, solveArmTarget } from "../src/rig/armTarget.ts";
import { NO_FOLDS, type SkinFold, skinFolds, skinPose } from "../src/rig/dual.ts";
import { renderFold } from "../src/rig/jointFold.ts";
import {
  bodyPoseRotations,
  IDENTITY_POSE,
  posedBones,
  restBones,
  rigData,
} from "../src/rig/pose.ts";
import { poseShare, skinDualShare } from "../src/rig/skinShare.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const anchors = landmarkAnchors(model, "base");

function live(
  evaluation: ReturnType<typeof model.evaluate>,
  rotations: Float32Array,
  world: Group,
  folds: readonly SkinFold[] = NO_FOLDS,
  skinMode: "mixed" | "linear" = "mixed",
): LiveFigure {
  const rest = restBones(assets, evaluation.control);
  const pose = skinPose(
    rest,
    rotations,
    skinMode === "linear" ? 0 : poseShare(rest, rotations, skinDualShare(rest.names)),
  );
  return {
    surface: evaluation.surface,
    rest: evaluation.positions,
    restNormals: evaluation.normals,
    skinIndex: model.topology().body.skinIndex,
    skinWeight: model.topology().body.skinWeight,
    pose: () => pose,
    folds: () => folds,
    skeleton: () => posedBones(rest, rotations),
    world,
  };
}

function slowFrame(
  recipe: Recipe,
  evaluation: ReturnType<typeof model.evaluate>,
  rotations: Float32Array,
  side: "L" | "R",
  folds: readonly SkinFold[] = NO_FOLDS,
  skinMode: "mixed" | "linear" = "mixed",
  effector = `hand.${side}`,
): FrameOut {
  const affordances = new HumanoidAffordances();
  affordances.setRecipe(recipe);
  affordances.setAnchors({ base: anchors, adult: null });
  affordances.attach(live(evaluation, rotations, new Group(), folds, skinMode));
  const frame = affordances.frame(effector, "figure", frameOut());
  if (!frame) throw new Error("slow hand frame was unavailable");
  return frame;
}

/** The recipe's joint folds (hips and knees) on its body surface, solved to the end. */
function solvedFolds(recipe: Recipe) {
  const steps = model.folds(recipe);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value.folds;
}

const orientation = (frame: FrameOut) => {
  const q = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(
      new Vector3(...frame.tangent),
      new Vector3(...frame.bitangent),
      new Vector3(...frame.normal),
    ),
  );
  return q;
};

const orientationTuple = (frame: FrameOut): [number, number, number, number] => {
  const q = orientation(frame);
  return [q.x, q.y, q.z, q.w];
};

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );

// The seated case solves the figure's hip and knee folds, which takes minutes on a busy machine.
describe("arm skinned-frame sampler", { timeout: 300_000 }, () => {
  it("matches the trusted live affordance path across adult heights, sides, and allowed arm poses", () => {
    for (const recipe of [
      createRecipe({ macros: { age: 25, gender: 0.85, height: 0.8 } }),
      createRecipe({ macros: { age: 25, gender: 0.15, height: 0.2 } }),
    ]) {
      const evaluation = model.evaluate(recipe);
      const rest = restBones(assets, evaluation.control);
      for (const side of ["L", "R"] as const) {
        const source = IDENTITY_POSE(rest.names.length);
        const chain = armChain(rest, side);
        source[(chain[0] as number) * 4] = Math.sin(0.12);
        source[(chain[0] as number) * 4 + 3] = Math.cos(0.12);
        const generation = {};
        const sampler = createArmSkinnedFrameSampler({
          generation,
          rest: evaluation.positions,
          restNormals: evaluation.normals,
          skinIndex: model.topology().body.skinIndex,
          skinWeight: model.topology().body.skinWeight,
          anchors,
          restBones: rest,
          sourceRotations: source,
          armBones: chain,
          side,
        });
        const candidate = Float32Array.from(source);
        const wrist = chain.at(-1) as number;
        candidate[wrist * 4 + 1] = Math.sin(0.08);
        candidate[wrist * 4 + 3] = Math.cos(0.08);
        const actual = sampler.frame(generation, candidate, frameOut());
        const expected = slowFrame(recipe, evaluation, candidate, side);
        expect(distance(actual.position, expected.position)).toBeLessThanOrEqual(1e-6);
        expect(orientation(actual).angleTo(orientation(expected))).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it.each([false, true])(
    "matches custom linear hand and touched-site skin (reset source: %s)",
    (reset) => {
      const recipe = createRecipe({ macros: { age: 30, height: 0.8 } });
      const evaluation = model.evaluate(recipe);
      const rest = restBones(assets, evaluation.control);
      for (const side of ["L", "R"] as const) {
        const generation = {};
        const source = bodyPoseRotations(rigData(assets), "benchmark");
        const chain = armChain(rest, side);
        const sampler = createArmSkinnedFrameSampler({
          generation,
          rest: evaluation.positions,
          restNormals: evaluation.normals,
          skinIndex: model.topology().body.skinIndex,
          skinWeight: model.topology().body.skinWeight,
          anchors,
          restBones: rest,
          sourceRotations: source,
          armBones: chain,
          side,
          skinMode: "linear",
        });
        const baseline = Float32Array.from(source);
        if (reset) {
          const hip = rest.names.indexOf("upperleg01.R");
          baseline.set([Math.sin(0.4), 0, 0, Math.cos(0.4)], hip * 4);
          sampler.resetSource(generation, baseline);
        }
        const candidate = Float32Array.from(baseline);
        const wrist = chain.at(-1) as number;
        candidate.set([Math.sin(0.45), 0, 0, Math.cos(0.45)], wrist * 4);
        // The actual palm is rigid in this fixture, while the touched sternum
        // blends bones and exposes an incorrect mixed share in the same sample.
        const expectedHand = slowFrame(recipe, evaluation, candidate, side, NO_FOLDS, "linear");
        const expectedSite = slowFrame(
          recipe,
          evaluation,
          candidate,
          side,
          NO_FOLDS,
          "linear",
          "sternum-notch",
        );
        const mixedSite = slowFrame(
          recipe,
          evaluation,
          candidate,
          side,
          NO_FOLDS,
          "mixed",
          "sternum-notch",
        );
        expect(
          distance(expectedSite.position, mixedSite.position),
          "fixture distinguishes skin modes",
        ).toBeGreaterThan(1e-5);
        const actualHand = frameOut();
        const actualSite = frameOut();
        sampler.frames(generation, candidate, actualHand, "sternum-notch", actualSite);
        expect(distance(actualHand.position, expectedHand.position)).toBeLessThanOrEqual(1e-6);
        expect(orientation(actualHand).angleTo(orientation(expectedHand))).toBeLessThanOrEqual(
          1e-6,
        );
        expect(distance(actualSite.position, expectedSite.position)).toBeLessThanOrEqual(1e-6);
        expect(orientation(actualSite).angleTo(orientation(expectedSite))).toBeLessThanOrEqual(
          1e-6,
        );
      }
    },
  );

  it("preserves the default mixed frames exactly when mixed skinning is explicit", () => {
    const recipe = createRecipe({ macros: { age: 30 } });
    const evaluation = model.evaluate(recipe);
    const rest = restBones(assets, evaluation.control);
    const generation = {};
    const input = {
      generation,
      rest: evaluation.positions,
      restNormals: evaluation.normals,
      skinIndex: model.topology().body.skinIndex,
      skinWeight: model.topology().body.skinWeight,
      anchors,
      restBones: rest,
      sourceRotations: bodyPoseRotations(rigData(assets), "benchmark"),
      armBones: armChain(rest, "R"),
      side: "R" as const,
    };
    const implicit = createArmSkinnedFrameSampler(input);
    const explicit = createArmSkinnedFrameSampler({ ...input, skinMode: "mixed" });
    for (const source of [input.sourceRotations, bodyPoseRotations(rigData(assets), "seated")]) {
      implicit.resetSource(generation, source);
      explicit.resetSource(generation, source);
      expect(explicit.frame(generation, source, frameOut())).toEqual(
        implicit.frame(generation, source, frameOut()),
      );
    }
  });

  it("rejects stale generations and candidate changes outside the arm while caller output remains reusable", () => {
    const recipe = createRecipe({ macros: { age: 30 } });
    const evaluation = model.evaluate(recipe);
    const rest = restBones(assets, evaluation.control);
    const source = IDENTITY_POSE(rest.names.length);
    const chain = armChain(rest, "R");
    const generation = {};
    const sampler = createArmSkinnedFrameSampler({
      generation,
      rest: evaluation.positions,
      restNormals: evaluation.normals,
      skinIndex: model.topology().body.skinIndex,
      skinWeight: model.topology().body.skinWeight,
      anchors,
      restBones: rest,
      sourceRotations: source,
      armBones: chain,
      side: "R",
    });
    const out = frameOut();
    expect(sampler.frame(generation, source, out)).toBe(out);
    const first = [...out.position];
    const candidate = Float32Array.from(source);
    const wrist = chain.at(-1) as number;
    candidate[wrist * 4] = Math.sin(0.05);
    candidate[wrist * 4 + 3] = Math.cos(0.05);
    expect(sampler.frame(generation, candidate, out)).toBe(out);
    expect([...out.position]).not.toEqual(first);
    expect(() => sampler.frame({}, candidate, out)).toThrow("generation is stale");
    const hip = rest.names.indexOf("upperleg01.R");
    candidate[hip * 4] = Math.sin(0.1);
    candidate[hip * 4 + 3] = Math.cos(0.1);
    expect(() => sampler.frame(generation, candidate, out)).toThrow("non-arm pose bone");
  });

  it("rejects non-finite source and candidate rotations before a frame is written", () => {
    const recipe = createRecipe({ macros: { age: 30 } });
    const evaluation = model.evaluate(recipe);
    const rest = restBones(assets, evaluation.control);
    const chain = armChain(rest, "R");
    const source = IDENTITY_POSE(rest.names.length);
    const hip = rest.names.indexOf("upperleg01.R");
    source[hip * 4] = Number.NaN;
    expect(() =>
      createArmSkinnedFrameSampler({
        generation: {},
        rest: evaluation.positions,
        restNormals: evaluation.normals,
        skinIndex: model.topology().body.skinIndex,
        skinWeight: model.topology().body.skinWeight,
        anchors,
        restBones: rest,
        sourceRotations: source,
        armBones: chain,
        side: "R",
      }),
    ).toThrow("source rotations must be finite");

    const validSource = IDENTITY_POSE(rest.names.length);
    const generation = {};
    const sampler = createArmSkinnedFrameSampler({
      generation,
      rest: evaluation.positions,
      restNormals: evaluation.normals,
      skinIndex: model.topology().body.skinIndex,
      skinWeight: model.topology().body.skinWeight,
      anchors,
      restBones: rest,
      sourceRotations: validSource,
      armBones: chain,
      side: "R",
    });
    const candidate = Float32Array.from(validSource);
    candidate[(chain[0] as number) * 4] = Number.NaN;
    expect(() => sampler.frame(generation, candidate, frameOut())).toThrow(
      "candidate rotations must be finite",
    );
    candidate[(chain[0] as number) * 4] = Number.POSITIVE_INFINITY;
    expect(() => sampler.frame(generation, candidate, frameOut())).toThrow(
      "candidate rotations must be finite",
    );
  });

  it("refreshes its full-body source without stale shares and rejects invalid resets atomically", () => {
    const recipe = createRecipe({ macros: { age: 30, height: 0.8 } });
    const evaluation = model.evaluate(recipe);
    const rest = restBones(assets, evaluation.control);
    const generation = {};
    const source = IDENTITY_POSE(rest.names.length);
    const input = {
      generation,
      rest: evaluation.positions,
      restNormals: evaluation.normals,
      skinIndex: model.topology().body.skinIndex,
      skinWeight: model.topology().body.skinWeight,
      anchors,
      restBones: rest,
      sourceRotations: source,
      armBones: armChain(rest, "R"),
      side: "R" as const,
    };
    const sampler = createArmSkinnedFrameSampler(input);
    const before = new Uint8Array(source.buffer).slice();
    for (const name of ["seated", "tpose", "benchmark", "seated"]) {
      const changed = bodyPoseRotations(rigData(assets), name);
      sampler.resetSource(generation, changed);
      const fresh = createArmSkinnedFrameSampler({ ...input, sourceRotations: changed });
      expect(sampler.frame(generation, changed, frameOut())).toEqual(
        fresh.frame(generation, changed, frameOut()),
      );
      const accepted = Float32Array.from(changed);
      changed.fill(0);
      expect(sampler.frame(generation, accepted, frameOut())).toEqual(
        fresh.frame(generation, accepted, frameOut()),
      );
      const invalid = Float32Array.from(accepted);
      invalid[invalid.length - 1] = NaN;
      expect(() => sampler.resetSource(generation, invalid)).toThrow(
        "source rotations must be finite",
      );
      expect(() => sampler.resetSource({}, accepted)).toThrow("generation is stale");
      expect(() => sampler.resetSource(generation, new Float32Array(1))).toThrow(
        "source rotations do not match",
      );
      expect(sampler.frame(generation, accepted, frameOut())).toEqual(
        fresh.frame(generation, accepted, frameOut()),
      );
    }
    expect(new Uint8Array(source.buffer)).toEqual(before);
  });

  it("copies its source baseline and preserves output when candidate validation fails", () => {
    const recipe = createRecipe({ macros: { age: 30 } });
    const evaluation = model.evaluate(recipe);
    const rest = restBones(assets, evaluation.control);
    const source = IDENTITY_POSE(rest.names.length);
    const chain = armChain(rest, "R");
    const generation = {};
    const sampler = createArmSkinnedFrameSampler({
      generation,
      rest: evaluation.positions,
      restNormals: evaluation.normals,
      skinIndex: model.topology().body.skinIndex,
      skinWeight: model.topology().body.skinWeight,
      anchors,
      restBones: rest,
      sourceRotations: source,
      armBones: chain,
      side: "R",
    });
    const hip = rest.names.indexOf("upperleg01.R");
    source[hip * 4] = Math.sin(0.11);
    source[hip * 4 + 3] = Math.cos(0.11);
    expect(sampler.frame(generation, IDENTITY_POSE(rest.names.length), frameOut())).toBeTruthy();

    const candidate = IDENTITY_POSE(rest.names.length);
    candidate[(chain[0] as number) * 4] = Number.NaN;
    const out: FrameOut = {
      position: [1, 2, 3],
      normal: [4, 5, 6],
      tangent: [7, 8, 9],
      bitangent: [10, 11, 12],
    };
    const before = structuredClone(out);
    expect(() => sampler.frame(generation, candidate, out)).toThrow(
      "candidate rotations must be finite",
    );
    expect(out).toEqual(before);
  });

  it("matches a folded seated source pose through an allowed arm candidate", () => {
    const recipe = createRecipe({ macros: { age: 31, gender: 0.76, height: 0.78 } });
    const evaluation = model.evaluate(recipe);
    const rest = restBones(assets, evaluation.control);
    const source = bodyPoseRotations(rigData(assets), "seated");
    const folds = skinFolds(rest, source, solvedFolds(recipe).map(renderFold), 1);
    expect(folds.map((f) => f.fold.joint.name)).toContain("hip");
    const side = "R" as const;
    const chain = armChain(rest, side);
    const generation = {};
    const sampler = createArmSkinnedFrameSampler({
      generation,
      rest: evaluation.positions,
      restNormals: evaluation.normals,
      skinIndex: model.topology().body.skinIndex,
      skinWeight: model.topology().body.skinWeight,
      anchors,
      restBones: rest,
      sourceRotations: source,
      armBones: chain,
      side,
      folds,
    });
    const candidate = Float32Array.from(source);
    const wrist = chain.at(-1) as number;
    candidate[wrist * 4 + 1] = Math.sin(0.09);
    candidate[wrist * 4 + 3] = Math.cos(0.09);
    const actual = sampler.frame(generation, candidate, frameOut());
    const expected = slowFrame(recipe, evaluation, candidate, side, folds);
    expect(distance(actual.position, expected.position)).toBeLessThanOrEqual(1e-6);
    expect(orientation(actual).angleTo(orientation(expected))).toBeLessThanOrEqual(1e-6);
  });

  it("keeps final sampled hand position within one centimetre and orientation equal to the trusted path", () => {
    for (const recipe of [
      createRecipe({ macros: { age: 25, gender: 0.85, height: 0.8 } }),
      createRecipe({ macros: { age: 25, gender: 0.15, height: 0.2 } }),
    ]) {
      const evaluation = model.evaluate(recipe);
      const rest = restBones(assets, evaluation.control);
      for (const side of ["L", "R"] as const) {
        const source = IDENTITY_POSE(rest.names.length);
        const chain = armChain(rest, side);
        const generation = {};
        const sampler = createArmSkinnedFrameSampler({
          generation,
          rest: evaluation.positions,
          restNormals: evaluation.normals,
          skinIndex: model.topology().body.skinIndex,
          skinWeight: model.topology().body.skinWeight,
          anchors,
          restBones: rest,
          sourceRotations: source,
          armBones: chain,
          side,
        });
        const before = sampler.frame(generation, source, frameOut());
        const target: [number, number, number] = [
          before.position[0] + (side === "L" ? -0.08 : 0.08),
          before.position[1] + 0.04,
          before.position[2] - 0.08,
        ];
        const solve = (
          effector: (rotations: Float32Array) => {
            position: readonly [number, number, number];
            orientation: [number, number, number, number];
          },
        ) =>
          solveArmTarget({
            rest,
            rotations: source,
            chain,
            tip: armTip(rest, source, chain, before.position, orientationTuple(before)),
            target: { position: target },
            tolerance: 0.01,
            effector,
          });
        const sampled = frameOut();
        const baseline = solve((rotations) => {
          const frame = slowFrame(recipe, evaluation, rotations, side);
          return { position: frame.position, orientation: orientationTuple(frame) };
        });
        expect(baseline.status, `${side} slow ${baseline.distance}`).toBe("reached");
        const result = solve((rotations) => {
          const frame = sampler.frame(generation, rotations, sampled);
          return { position: frame.position, orientation: orientationTuple(frame) };
        });
        expect(result.status, `${side} ${result.distance}`).toBe("reached");
        expect(result.distance).toBeLessThanOrEqual(0.01);
        const trusted = slowFrame(recipe, evaluation, result.rotations, side);
        const actual = sampler.frame(generation, result.rotations, sampled);
        expect(distance(actual.position, trusted.position)).toBeLessThanOrEqual(1e-6);
        expect(orientation(actual).angleTo(orientation(trusted))).toBeLessThanOrEqual(1e-6);
      }
    }
  });
});
