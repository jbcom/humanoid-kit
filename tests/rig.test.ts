import { describe, expect, it } from "vitest";
import { jointPosition } from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import {
  OCCLUSION_KEYS,
  occlusionCornerUnits,
  occlusionCornerWeights,
  occlusionKeyBasis,
  occlusionKeyWeights,
} from "../src/rig/occlusionKeys.ts";
import {
  bodyPoseRotations,
  composeRotations,
  faceUnitRotations,
  IDENTITY_POSE,
  posedBoneHeads,
  posedGroundOffset,
  restBones,
  restBonesFrom,
  rigData,
  skinPositions,
} from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const rig = rigData(assets);
const model = new HumanoidModel(assets, { subdivision: 0 });
const control = model.evaluate(createRecipe()).control;
const rest = restBones(assets, control);
const bone = (name: string) => rest.names.indexOf(name);

/** Vertices whose strongest skin weight, above `min`, is on `name`. */
function ownedBy(name: string, min = 0.6): number[] {
  const b = bone(name);
  const out: number[] = [];
  for (let v = 0; v < assets.manifest.vertexCount; v++)
    if (assets.skinIndex[v * 4] === b && (assets.skinWeight[v * 4] as number) > min) out.push(v);
  return out;
}

const pose = (weights: Record<string, number>) =>
  skinPositions(
    rest,
    faceUnitRotations(rig, weights),
    control,
    assets.skinIndex,
    assets.skinWeight,
    new Float32Array(control.length),
  );

describe("the rest skeleton", () => {
  it("puts every bone at its head joint over the morphed body, children after parents", () => {
    expect(rest.names.length).toBe(assets.manifest.skeleton.bones.length);
    const p = new Float32Array(3);
    assets.manifest.skeleton.bones.forEach((b, i) => {
      jointPosition(assets, control, b.head, p);
      for (let k = 0; k < 3; k++) expect(rest.heads[i * 3 + k]).toBeCloseTo(p[k] as number, 6);
      const parent = rest.parents[i] as number;
      expect(parent).toBe(b.parent === null ? -1 : rest.names.indexOf(b.parent));
    });
    expect(rest.order.length).toBe(rest.names.length);
    const seen = new Set<number>();
    for (const i of rest.order) {
      const parent = rest.parents[i] as number;
      if (parent >= 0) expect(seen.has(parent)).toBe(true);
      seen.add(i);
    }
  });

  it("fits the figure: a taller figure's head bone sits higher", () => {
    const tall = model.evaluate(createRecipe({ macros: { height: 1 } })).control;
    expect(restBones(assets, tall).heads[bone("head") * 3 + 1]).toBeGreaterThan(
      rest.heads[bone("head") * 3 + 1] as number,
    );
  });
});

describe("posing", () => {
  it("leaves the body exactly where it was at rest", () => {
    const out = skinPositions(
      rest,
      IDENTITY_POSE(rest.names.length),
      control,
      assets.skinIndex,
      assets.skinWeight,
      new Float32Array(control.length),
    );
    let worst = 0;
    for (let i = 0; i < out.length; i++)
      worst = Math.max(worst, Math.abs((out[i] as number) - (control[i] as number)));
    expect(worst).toBeLessThan(1e-6);
  });

  it("opens the jaw with JawDrop: the chin swings down and the skull stays put", () => {
    const open = pose({ JawDrop: 1 });
    const chin = ownedBy("jaw");
    expect(chin.length).toBeGreaterThan(20);
    const dy = chin.map((v) => (open[v * 3 + 1] as number) - (control[v * 3 + 1] as number));
    // A 20° jaw rotation lowers the chin by centimetres.
    expect(Math.min(...dy)).toBeLessThan(-0.01);
    expect(dy.reduce((s, d) => s + d, 0) / dy.length).toBeLessThan(-0.003);
    // Vertices on the skull alone do not move (partly face-weighted ones blend, as LBS does).
    const skull = ownedBy("head", 0.999);
    expect(skull.length).toBeGreaterThan(20);
    for (const v of skull)
      for (let k = 0; k < 3; k++)
        expect(Math.abs((open[v * 3 + k] as number) - (control[v * 3 + k] as number))).toBeLessThan(
          1e-6,
        );
  });

  it("closes the left upper lid only with LeftUpperLidClosed", () => {
    const closed = pose({ LeftUpperLidClosed: 1 });
    const left = ownedBy("orbicularis03.L");
    const right = ownedBy("orbicularis03.R");
    expect(left.length).toBeGreaterThan(3);
    const drop = (vs: number[]) =>
      Math.min(...vs.map((v) => (closed[v * 3 + 1] as number) - (control[v * 3 + 1] as number)));
    expect(drop(left)).toBeLessThan(-0.003);
    expect(drop(right)).toBeGreaterThan(-1e-6);
  });

  it("turns the eyes about the vertical axis, toward the side the unit names", () => {
    // MakeHuman's BVH is Z-up facing -Y; the figure is Y-up facing +Z, its left at +X.
    const turned = pose({ LeftEyeturnLeft: 1 });
    const eye = ownedBy("eye.L", 0.99);
    expect(eye.length).toBeGreaterThan(10);
    let front = eye[0] as number;
    for (const v of eye)
      if ((control[v * 3 + 2] as number) > (control[front * 3 + 2] as number)) front = v;
    const d = [0, 1, 2].map(
      (k) => (turned[front * 3 + k] as number) - (control[front * 3 + k] as number),
    );
    // The front of the eye swings sideways, toward the figure's left, not up or down.
    expect(d[0] as number).toBeGreaterThan(0.002);
    expect(Math.abs(d[1] as number)).toBeLessThan(Math.abs(d[0] as number) / 4);
  });

  it("moves the mouth sideways with MouthMoveLeft, toward the figure's left", () => {
    const moved = pose({ MouthMoveLeft: 1 });
    const lips = ownedBy("oris01", 0.5).concat(ownedBy("oris05", 0.5));
    expect(lips.length).toBeGreaterThan(3);
    const dx = lips.map((v) => (moved[v * 3] as number) - (control[v * 3] as number));
    const dy = lips.map((v) => (moved[v * 3 + 1] as number) - (control[v * 3 + 1] as number));
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(mean(dx)).toBeGreaterThan(0.001);
    expect(Math.abs(mean(dy))).toBeLessThan(Math.abs(mean(dx)));
  });

  it("blends units in log space: one unit at weight 1 is that unit, weights scale its angle", () => {
    const jaw = bone("jaw");
    const angle = (q: Float32Array) =>
      2 * Math.acos(Math.min(1, Math.abs(q[jaw * 4 + 3] as number)));
    const full = angle(faceUnitRotations(rig, { JawDrop: 1 }));
    expect(full).toBeCloseTo((20.189 * Math.PI) / 180, 3);
    expect(angle(faceUnitRotations(rig, { JawDrop: 0.5 }))).toBeCloseTo(full / 2, 4);
    // Order-independent.
    const a = faceUnitRotations(rig, { JawDrop: 0.7, LipsKiss: 0.4 });
    const b = faceUnitRotations(rig, { LipsKiss: 0.4, JawDrop: 0.7 });
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(() => faceUnitRotations(rig, { NotAUnit: 1 })).toThrow(/NotAUnit/);
  });
});

describe("occlusion key weights", () => {
  const basis = occlusionKeyBasis(rig);
  const weights = (units: Record<string, number>) =>
    Array.from(occlusionKeyWeights(basis, faceUnitRotations(rig, units)));
  const close = (got: number[], want: number[]) =>
    want.forEach((w, i) => {
      expect(got[i], `key ${OCCLUSION_KEYS[i]?.id}`).toBeCloseTo(w, 3);
    });

  it("are zero at rest and exactly one at each key", () => {
    close(weights({}), [0, 0, 0]);
    OCCLUSION_KEYS.forEach((k, i) => {
      close(
        weights(k.faceUnits),
        OCCLUSION_KEYS.map((_, j) => (i === j ? 1 : 0)),
      );
    });
  });

  it("scale with a key and add across keys", () => {
    close(weights({ JawDrop: 0.4 }), [0.4, 0, 0]);
    close(weights({ JawDrop: 0.6, MouthLeftPullUp: 1, MouthRightPullUp: 1 }), [0.6, 0, 1]);
  });

  it("read a pose that is no key by what it shares with them, clamped to [0, 1]", () => {
    const w = weights({ JawDropStretched: 1 });
    expect(w[0]).toBeGreaterThan(0.3);
    for (const x of w) expect(x >= 0 && x <= 1).toBe(true);
  });
});

describe("occlusion corners", () => {
  it("name each corner's keys by bit and blend multilinearly, exactly at corners", () => {
    expect(occlusionCornerUnits(0)).toEqual({});
    expect(occlusionCornerUnits(3)).toEqual({ JawDrop: 1, UpperLipUp: 1, lowerLipDown: 1 });
    // At a corner, that corner alone.
    expect(Array.from(occlusionCornerWeights([1, 0, 1]))).toEqual([0, 0, 0, 0, 0, 1, 0, 0]);
    // Between corners the weights are products and sum to one.
    const w = occlusionCornerWeights([0.3, 0.6, 0.1]);
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    expect(w[3]).toBeCloseTo(0.3 * 0.6 * 0.9, 6);
  });
});

describe("body poses", () => {
  const posed = (rotations: Float32Array) =>
    skinPositions(
      rest,
      rotations,
      control,
      assets.skinIndex,
      assets.skinWeight,
      new Float32Array(control.length),
    );

  it("ships MakeHuman's CC0 T-pose and rigging benchmark, and the authored relaxed pose", () => {
    expect(rig.poses.map((p) => p.name)).toEqual(["tpose", "benchmark", "relaxed"]);
    expect(() => bodyPoseRotations(rig, "dab")).toThrow(/dab/);
  });

  it("lets the arms hang beside the thighs in the relaxed pose", () => {
    const r = posedBoneHeads(rest, bodyPoseRotations(rig, "relaxed"));
    const head = (h: Float32Array, name: string) =>
      Array.from(h.slice(bone(name) * 3, bone(name) * 3 + 3)) as [number, number, number];
    for (const side of ["L", "R"]) {
      const shoulder = head(r, `upperarm01.${side}`);
      const elbow = head(r, `lowerarm01.${side}`);
      const wrist = head(r, `wrist.${side}`);
      const hip = head(r, `upperleg01.${side}`);
      // The upper arm hangs within 12° of vertical (the rest A-pose is about 42°).
      const up = [elbow[0] - shoulder[0], elbow[1] - shoulder[1], elbow[2] - shoulder[2]];
      const fromVertical = Math.acos(-(up[1] as number) / Math.hypot(...up));
      expect(fromVertical).toBeLessThan((12 * Math.PI) / 180);
      // The elbow bends a little (about 17°), as a relaxed arm does.
      const fore = [wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]];
      const bend = Math.acos(
        ((up[0] as number) * (fore[0] as number) +
          (up[1] as number) * (fore[1] as number) +
          (up[2] as number) * (fore[2] as number)) /
          (Math.hypot(...up) * Math.hypot(...fore)),
      );
      expect(bend).toBeGreaterThan((10 * Math.PI) / 180);
      expect(bend).toBeLessThan((25 * Math.PI) / 180);
      // The wrist ends near hip height, just outside the hip joint, a little in front.
      expect(Math.abs(wrist[1] - hip[1])).toBeLessThan(0.06);
      expect(Math.abs(wrist[0]) - Math.abs(hip[0])).toBeGreaterThan(0.05);
      expect(Math.abs(wrist[0]) - Math.abs(hip[0])).toBeLessThan(0.15);
      expect(wrist[2]).toBeGreaterThan(0.03);
      expect(wrist[2]).toBeLessThan(0.12);
    }
  });

  it("raises the arms level with the shoulders in the T-pose", () => {
    const t = posedBoneHeads(rest, bodyPoseRotations(rig, "tpose"));
    const head = (h: Float32Array, name: string) =>
      Array.from(h.slice(bone(name) * 3, bone(name) * 3 + 3));
    for (const side of ["L", "R"]) {
      const shoulder = head(rest.heads, `upperarm01.${side}`);
      const atRest = head(rest.heads, `wrist.${side}`);
      const raised = head(t, `wrist.${side}`);
      // From the rest A-pose the wrist rises to about shoulder height and moves outward.
      expect(raised[1] as number).toBeGreaterThan(atRest[1] as number);
      expect(Math.abs((raised[1] as number) - (shoulder[1] as number))).toBeLessThan(0.08);
      expect(Math.abs(raised[0] as number)).toBeGreaterThan(Math.abs(atRest[0] as number));
    }
  });

  it("bends every joint in the benchmark without breaking the mesh", () => {
    const b = posed(bodyPoseRotations(rig, "benchmark"));
    expect(b.every(Number.isFinite)).toBe(true);
    let moved = 0;
    for (let i = 0; i < b.length; i++)
      moved = Math.max(moved, Math.abs((b[i] as number) - (control[i] as number)));
    expect(moved).toBeGreaterThan(0.1);
  });

  it("grounds a posed figure on its lowest body point, and at rest exactly as evaluated", () => {
    const skin = model.rigSkin();
    const ev = model.evaluate(createRecipe());
    const fromHeads = restBonesFrom(rest.names, rest.parents, ev.boneHeads);
    expect(
      posedGroundOffset(fromHeads, IDENTITY_POSE(rest.names.length), ev.control, skin),
    ).toBeCloseTo(ev.groundOffset, 6);
    const kneel = bodyPoseRotations(rig, "benchmark");
    const lift = posedGroundOffset(fromHeads, kneel, ev.control, skin);
    const p = skinPositions(
      fromHeads,
      kneel,
      ev.control,
      assets.skinIndex,
      assets.skinWeight,
      new Float32Array(ev.control.length),
    );
    let lowest = Number.POSITIVE_INFINITY;
    for (const v of skin.bodyVertices) lowest = Math.min(lowest, (p[v * 3 + 1] as number) + lift);
    expect(lowest).toBeCloseTo(0, 6);
    // Kneeling brings the hips down: less lift than standing.
    expect(lift).not.toBeCloseTo(ev.groundOffset, 2);
  });

  it("layers an expression over a body pose", () => {
    const body = bodyPoseRotations(rig, "tpose");
    const both = composeRotations(body, faceUnitRotations(rig, { JawDrop: 1 }));
    const jaw = bone("jaw");
    // The jaw takes the expression; the arms keep the pose.
    expect(both[jaw * 4 + 3]).toBeLessThan(0.999);
    const arm = bone("upperarm01.L");
    expect(Array.from(both.slice(arm * 4, arm * 4 + 4))).toEqual(
      Array.from(body.slice(arm * 4, arm * 4 + 4)),
    );
  });
});
