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
  rotationVectors,
  skinPositions,
  skinPositionsLinear,
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

  it("ships MakeHuman's CC0 T-pose and rigging benchmark, and the authored poses", () => {
    expect(rig.poses.map((p) => p.name)).toEqual([
      "tpose",
      "benchmark",
      "abducted",
      "bent",
      "bowed",
      "flexed",
      "overhead",
      "relaxed",
      "seated",
      "squat",
      "tucked",
      "twisted",
    ]);
    expect(() => bodyPoseRotations(rig, "dab")).toThrow(/dab/);
  });

  it("folds the trunk forward 60° along the spine in the bowed pose, each of the five bones a fifth", () => {
    const heads = posedBoneHeads(rest, bodyPoseRotations(rig, "bowed"));
    const at = (h: Float32Array, n: string, k: number) => h[bone(n) * 3 + k] as number;
    const pitch = (h: Float32Array) => {
      const dy = at(h, "spine01", 1) - at(h, "spine05", 1);
      const dz = at(h, "spine01", 2) - at(h, "spine05", 2);
      return (Math.atan2(dz, dy) * 180) / Math.PI;
    };
    // The rest pose: `bowed` is the rest A-pose with the spine turned, as `bent` is.
    const standing = posedBoneHeads(rest, IDENTITY_POSE(rest.names.length));
    // The line from the lowest spine head to the highest leans over by the average of the bones'
    // turns up to the highest head: 12°, 24°, 36° and 48° (the last bone turns that head's
    // successor, not the head), about 30°.
    expect(pitch(heads) - pitch(standing)).toBeGreaterThan(26);
    expect(pitch(heads) - pitch(standing)).toBeLessThan(40);
    // The legs stay where they were.
    for (const n of ["upperleg01.L", "lowerleg01.L", "foot.L"])
      for (let k = 0; k < 3; k++) expect(at(heads, n, k), n).toBeCloseTo(at(standing, n, k), 5);
  });

  it("draws the knees up in the tucked pose: each thigh flexed 120° at the hip, the shin back down", () => {
    const heads = posedBoneHeads(rest, bodyPoseRotations(rig, "tucked"));
    const at = (n: string, k: number) => heads[bone(n) * 3 + k] as number;
    for (const side of ["L", "R"]) {
      const thigh = [0, 1, 2].map(
        (k) => at(`lowerleg01.${side}`, k) - at(`upperleg01.${side}`, k),
      ) as [number, number, number];
      const len = Math.hypot(...thigh);
      // From straight down, flexed 120° about the hip: forward and 30° above level.
      const lift = Math.asin(thigh[1] / len) * (180 / Math.PI);
      expect(lift, `thigh ${side}`).toBeGreaterThan(25);
      expect(lift, `thigh ${side}`).toBeLessThan(35);
      expect(thigh[2] / len, `thigh ${side}`).toBeGreaterThan(0.8);
      // The knee is bent far enough to bring the shin back down toward the thigh's start.
      expect(
        bend(heads, `upperleg02.${side}`, `lowerleg01.${side}`, `foot.${side}`),
      ).toBeGreaterThan(110);
    }
  });

  it("sits in the seated pose: thighs level and forward, shins upright, soles flat", () => {
    const heads = posedBoneHeads(rest, bodyPoseRotations(rig, "seated"));
    const standing = posedBoneHeads(rest, bodyPoseRotations(rig, "tpose"));
    const at = (h: Float32Array, n: string, k: number) => h[bone(n) * 3 + k] as number;
    const dir = (h: Float32Array, a: string, b: string) => {
      const v = [0, 1, 2].map((k) => at(h, b, k) - at(h, a, k));
      const l = Math.hypot(...v);
      return v.map((x) => x / l) as [number, number, number];
    };
    for (const side of ["L", "R"]) {
      const thigh = dir(heads, `upperleg01.${side}`, `lowerleg01.${side}`);
      const shin = dir(heads, `lowerleg01.${side}`, `foot.${side}`);
      // The thigh runs forward (+z) within 12° of level, the shin hangs down within 12° of upright.
      expect(Math.abs(thigh[1]), `thigh ${side}`).toBeLessThan(Math.sin((12 * Math.PI) / 180));
      expect(thigh[2], `thigh ${side}`).toBeGreaterThan(0.95);
      expect(shin[1], `shin ${side}`).toBeLessThan(-Math.cos((12 * Math.PI) / 180));
      // The foot keeps its rest pitch (the knee's and the hip's bends cancel at the ankle).
      const pitch = (h: Float32Array) =>
        (Math.atan2(
          at(h, `toe3-1.${side}`, 1) - at(h, `foot.${side}`, 1),
          Math.abs(at(h, `toe3-1.${side}`, 2) - at(h, `foot.${side}`, 2)),
        ) *
          180) /
        Math.PI;
      expect(Math.abs(pitch(heads) - pitch(standing)), `foot ${side}`).toBeLessThan(8);
    }
  });

  it("raises both arms straight overhead, the hands above the crown", () => {
    const heads = posedBoneHeads(rest, bodyPoseRotations(rig, "overhead"));
    const at = (n: string, k: number) => heads[bone(n) * 3 + k] as number;
    let crown = Number.NEGATIVE_INFINITY;
    for (let v = 1; v < control.length; v += 3) crown = Math.max(crown, control[v] as number);
    for (const side of ["L", "R"]) {
      const arm = [0, 1, 2].map((k) => at(`wrist.${side}`, k) - at(`upperarm01.${side}`, k));
      // The line from shoulder to wrist within 20° of straight up.
      expect((arm[1] as number) / Math.hypot(...arm), side).toBeGreaterThan(
        Math.cos((20 * Math.PI) / 180),
      );
      expect(at(`wrist.${side}`, 1), side).toBeGreaterThan(crown);
      // Each arm on its own side of the body.
      expect(Math.sign(at(`wrist.${side}`, 0)), side).toBe(side === "L" ? 1 : -1);
    }
  });

  it("squats deep: hips below the knees, knees bent past 130°, soles flat, knees apart", () => {
    const heads = posedBoneHeads(rest, bodyPoseRotations(rig, "squat"));
    const standing = posedBoneHeads(rest, IDENTITY_POSE(rest.names.length));
    const at = (h: Float32Array, n: string, k: number) => h[bone(n) * 3 + k] as number;
    for (const side of ["L", "R"]) {
      expect(at(heads, `upperleg01.${side}`, 1), side).toBeLessThan(
        at(heads, `lowerleg01.${side}`, 1),
      );
      expect(
        bend(heads, `upperleg02.${side}`, `lowerleg01.${side}`, `foot.${side}`),
        side,
      ).toBeGreaterThan(130);
      // The foot keeps its rest pitch within 15°: the heel stays down.
      const pitch = (h: Float32Array) =>
        (Math.atan2(
          at(h, `toe3-1.${side}`, 1) - at(h, `foot.${side}`, 1),
          Math.abs(at(h, `toe3-1.${side}`, 2) - at(h, `foot.${side}`, 2)),
        ) *
          180) /
        Math.PI;
      expect(Math.abs(pitch(heads) - pitch(standing)), `foot ${side}`).toBeLessThan(15);
    }
    // The knees part wider than the feet, as in a squat with the heels down.
    const gap = (n: string) => at(heads, `${n}.L`, 0) - at(heads, `${n}.R`, 0);
    expect(gap("lowerleg01")).toBeGreaterThan(gap("foot"));
  });

  it("swings both thighs 40° apart in the abducted pose, the legs open rather than crossed", () => {
    const vectors = rotationVectors(bodyPoseRotations(rig, "abducted"));
    const tpose = posedBoneHeads(rest, bodyPoseRotations(rig, "tpose"));
    const heads = posedBoneHeads(rest, bodyPoseRotations(rig, "abducted"));
    const foot = (h: Float32Array, side: string, k: number) =>
      h[bone(`foot.${side}`) * 3 + k] as number;
    for (const side of ["L", "R"]) {
      const b = bone(`upperleg01.${side}`);
      const v = [0, 1, 2].map((k) => vectors[b * 3 + k] as number);
      expect((Math.hypot(...v) * 180) / Math.PI).toBeCloseTo(40, 0);
      // The thigh turns about the line from front to back, so the foot stays at its depth.
      expect(foot(heads, side, 2)).toBeCloseTo(foot(tpose, side, 2), 3);
    }
    // The left of the body is at +x: opening the legs moves the feet apart, by about
    // twice the leg's reach times the sine of the angle (and crossing them would close the gap).
    const gap = (h: Float32Array) => foot(h, "L", 0) - foot(h, "R", 0);
    expect(gap(heads) - gap(tpose)).toBeGreaterThan(0.8);
  });

  /** The angle (degrees) between the direction from `a` to `b` and the one from `b` to `c`. */
  const bend = (heads: Float32Array, a: string, b: string, c: string) => {
    const at = (n: string, k: number) => heads[bone(n) * 3 + k] as number;
    const u = [0, 1, 2].map((k) => at(b, k) - at(a, k));
    const l = [0, 1, 2].map((k) => at(c, k) - at(b, k));
    const dot = u.reduce((s, v, k) => s + v * (l[k] as number), 0);
    return (Math.acos(dot / Math.hypot(...u) / Math.hypot(...l)) * 180) / Math.PI;
  };

  it("flexes every hinge near its extreme in the flexed pose, the check for volume lost in a fold", () => {
    const heads = posedBoneHeads(rest, bodyPoseRotations(rig, "flexed"));
    for (const side of ["L", "R"]) {
      expect(
        bend(heads, `upperarm02.${side}`, `lowerarm01.${side}`, `wrist.${side}`),
      ).toBeGreaterThan(120);
      expect(
        bend(heads, `upperleg02.${side}`, `lowerleg01.${side}`, `foot.${side}`),
      ).toBeGreaterThan(110);
      // The wrists bend to opposite sides, so one pose shows both.
      expect(
        bend(heads, `lowerarm02.${side}`, `wrist.${side}`, `finger3-1.${side}`),
      ).toBeGreaterThan(40);
    }
  });

  it("bends every hinge about half way in the bent pose, open enough to see each crook", () => {
    const heads = posedBoneHeads(rest, bodyPoseRotations(rig, "bent"));
    for (const side of ["L", "R"]) {
      const elbow = bend(heads, `upperarm02.${side}`, `lowerarm01.${side}`, `wrist.${side}`);
      const knee = bend(heads, `upperleg02.${side}`, `lowerleg01.${side}`, `foot.${side}`);
      const wrist = bend(heads, `lowerarm02.${side}`, `wrist.${side}`, `finger3-1.${side}`);
      expect(elbow).toBeGreaterThan(80);
      expect(elbow).toBeLessThan(105);
      expect(knee).toBeGreaterThan(70);
      expect(knee).toBeLessThan(95);
      expect(wrist).toBeGreaterThan(25);
      expect(wrist).toBeLessThan(55);
    }
  });

  it("keeps the soles as level as at rest in the bent pose, so the figure stands on its feet and not its toes", () => {
    const pitch = (heads: Float32Array, side: string) => {
      const at = (n: string, k: number) => heads[bone(n) * 3 + k] as number;
      const dy = at(`toe3-1.${side}`, 1) - at(`foot.${side}`, 1);
      const dz = at(`toe3-1.${side}`, 2) - at(`foot.${side}`, 2);
      return (Math.atan2(dy, Math.abs(dz)) * 180) / Math.PI;
    };
    const standing = posedBoneHeads(rest, bodyPoseRotations(rig, "tpose"));
    const bentHeads = posedBoneHeads(rest, bodyPoseRotations(rig, "bent"));
    for (const side of ["L", "R"])
      expect(Math.abs(pitch(bentHeads, side) - pitch(standing, side))).toBeLessThan(8);
  });

  it("twists each limb about its own axis in the twisted pose, the candy wrapper's check", () => {
    const vectors = rotationVectors(bodyPoseRotations(rig, "twisted"));
    const axis = (from: string, to: string) => {
      const v = [0, 1, 2].map(
        (k) =>
          (rest.heads[bone(to) * 3 + k] as number) - (rest.heads[bone(from) * 3 + k] as number),
      );
      const len = Math.hypot(...v);
      return v.map((x) => x / len);
    };
    const twists: [string, string, string, number][] = [
      ["upperarm01", "upperarm01", "lowerarm01", 110],
      ["wrist", "lowerarm01", "wrist", 170],
      ["upperleg01", "upperleg01", "lowerleg01", 60],
    ];
    for (const side of ["L", "R"]) {
      const sign = side === "L" ? 1 : -1;
      for (const [name, from, to, degrees] of twists) {
        const b = bone(`${name}.${side}`);
        const v = [0, 1, 2].map((k) => vectors[b * 3 + k] as number);
        const angle = (Math.hypot(...v) * 180) / Math.PI;
        const a = axis(`${from}.${side}`, `${to}.${side}`);
        const along = v.reduce((s, x, k) => s + x * (a[k] as number), 0);
        expect(angle).toBeCloseTo(degrees, 0);
        // Pure twist: the rotation vector lies along the limb (the right side turns the other way).
        expect(Math.abs(along) / Math.hypot(...v)).toBeGreaterThan(0.999);
        expect(Math.sign(along)).toBe(sign);
      }
    }
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

  it("skins by the shipped blend: linear where no bone asks for dual quaternions, not where an arm turns", () => {
    const skinWith = (rotations: Float32Array, scheme: typeof skinPositions) =>
      scheme(
        rest,
        rotations,
        control,
        assets.skinIndex,
        assets.skinWeight,
        new Float32Array(control.length),
      );
    // How far apart the visible body's vertices land (the helper geometry between the legs is not drawn).
    const body = model.rigSkin().bodyVertices;
    const farthest = (a: Float32Array, b: Float32Array) => {
      let d = 0;
      for (const v of body)
        for (let k = 0; k < 3; k++)
          d = Math.max(d, Math.abs((a[v * 3 + k] as number) - (b[v * 3 + k] as number)));
      return d;
    };
    // The face's bones are all linear: the blend is the old scheme, to a tenth of a millimetre (float error).
    const smile = faceUnitRotations(rig, { JawDrop: 1, MouthMoveLeft: 0.5 });
    expect(
      farthest(skinWith(smile, skinPositions), skinWith(smile, skinPositionsLinear)),
    ).toBeLessThan(1e-4);
    // An arm's are not: raised overhead it differs from linear skinning, by millimetres to a few centimetres.
    const benchmark = bodyPoseRotations(rig, "benchmark");
    const d = farthest(
      skinWith(benchmark, skinPositions),
      skinWith(benchmark, skinPositionsLinear),
    );
    expect(d).toBeGreaterThan(0.005);
    expect(d).toBeLessThan(0.05);
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
