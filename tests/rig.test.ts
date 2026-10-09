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
  faceUnitRotations,
  IDENTITY_POSE,
  restBones,
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
