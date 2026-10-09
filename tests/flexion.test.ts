import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { FLEXION_JOINTS, flexionRig, jointFlexion } from "../src/rig/flexion.ts";
import {
  bodyPoseRotations,
  faceUnitRotations,
  IDENTITY_POSE,
  posedBones,
  restBones,
  rigData,
} from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const model = new HumanoidModel(assets, { subdivision: 0 });
const rest = restBones(assets, model.evaluate(createRecipe()).control);
const rig = rigData(assets);
const flex = flexionRig(rest);
const at = (rotations: Float32Array) => jointFlexion(flex, rest, rotations);
const bone = (name: string) => rest.names.indexOf(name);

/** The rest pose with one joint turned `degrees` about its (oriented) hinge. */
function bent(joint: string, degrees: number): Float32Array {
  const k = FLEXION_JOINTS.findIndex((j) => j.name === joint);
  const axis = Array.from(flex.hinges.slice(k * 3, k * 3 + 3));
  const half = (degrees * Math.PI) / 360;
  const q = IDENTITY_POSE(rest.names.length);
  q.set(
    [
      (axis[0] as number) * Math.sin(half),
      (axis[1] as number) * Math.sin(half),
      (axis[2] as number) * Math.sin(half),
      Math.cos(half),
    ],
    bone(FLEXION_JOINTS[k]?.joint as string) * 4,
  );
  return q;
}

describe("joint flexion", () => {
  it("reads the A-pose's own bends from straight, and a T-pose's arms as straight", () => {
    const still = at(IDENTITY_POSE(rest.names.length));
    // MakeHuman's rest bends each elbow about 43° forward; knees and wrists barely.
    for (const side of ["L", "R"]) {
      expect(still[`flex.elbow.${side}`]).toBeGreaterThan(0.25);
      expect(still[`flex.elbow.${side}`]).toBeLessThan(0.35);
      expect(still[`flex.knee.${side}`]).toBeLessThan(0.1);
      expect(still[`flex.wrist.${side}`]).toBeLessThan(0.15);
    }
    const t = at(bodyPoseRotations(rig, "tpose"));
    for (const name of ["elbow.L", "elbow.R", "knee.L", "knee.R"])
      expect(t[`flex.${name}`], name).toBeLessThan(0.05);
  });

  it("adds a bend as its share of the joint's range, and only when it flexes", () => {
    const still = at(IDENTITY_POSE(rest.names.length));
    for (const j of FLEXION_JOINTS) {
      const key = `flex.${j.name}`;
      const more = (at(bent(j.name, j.range / 4))[key] as number) - (still[key] as number);
      expect(more, j.name).toBeGreaterThan(0.2);
      expect(more, j.name).toBeLessThan(0.3);
      // Straightening reads less flexion, never more.
      expect(at(bent(j.name, -20))[key] as number, j.name).toBeLessThanOrEqual(
        still[key] as number,
      );
    }
  });

  it("flexes the way the body does: the joint closes, the shin swinging back", () => {
    const heads = (rotations: Float32Array) => posedBones(rest, rotations).heads;
    const gap = (h: Float32Array, a: string, b: string) =>
      Math.hypot(
        ...[0, 1, 2].map((k) => (h[bone(a) * 3 + k] as number) - (h[bone(b) * 3 + k] as number)),
      );
    const still = heads(IDENTITY_POSE(rest.names.length));
    // Flexing brings the far end of the limb nearer its root, at every joint.
    // (At rest the A-pose already bends each forearm about 43° forward.)
    for (const j of FLEXION_JOINTS) {
      const bentHeads = heads(bent(j.name, 60));
      expect(gap(bentHeads, j.above, j.below), j.name).toBeLessThan(gap(still, j.above, j.below));
    }
    // And the knee folds backward, not forward.
    expect(heads(bent("knee.L", 90))[bone("foot.L") * 3 + 2] as number).toBeLessThan(
      (still[bone("foot.L") * 3 + 2] as number) - 0.1,
    );
  });

  it("ignores expressions and the benchmark's hips and shoulders", () => {
    const still = at(IDENTITY_POSE(rest.names.length));
    const f = at(faceUnitRotations(rig, { JawDrop: 1, LeftBrowDown: 1 }));
    for (const j of FLEXION_JOINTS)
      expect(f[`flex.${j.name}`], j.name).toBeCloseTo(still[`flex.${j.name}`] as number, 6);
    // MakeHuman's rigging benchmark swings hips and shoulders but leaves the
    // knees and elbows at their rest bend (its thigh twist moves the knee's
    // measured angle by about 2.5°).
    const b = at(bodyPoseRotations(rig, "benchmark"));
    for (const name of ["knee.L", "knee.R", "elbow.L", "elbow.R"])
      expect(
        Math.abs((b[`flex.${name}`] as number) - (still[`flex.${name}`] as number)),
        name,
      ).toBeLessThan(0.03);
  });
});
