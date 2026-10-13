import { describe, expect, it } from "vitest";
import {
  AssetFormatError,
  type ClothingManifest,
  parseHumanoidAssets,
  SKIN_INFLUENCES,
} from "../src/format/assetFormat.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { placeRigid, rigidFit, rigidSkin } from "../src/model/rigidFit.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyPackData, clothingManifest, clothingPackData } from "./fixtures.ts";

/** Rotates `p` by the unit quaternion (w, x, y, z). */
function rotate(q: readonly number[], p: readonly number[]): number[] {
  const [w, x, y, z] = q as [number, number, number, number];
  const [px, py, pz] = p as [number, number, number];
  const tx = 2 * (y * pz - z * py);
  const ty = 2 * (z * px - x * pz);
  const tz = 2 * (x * py - y * px);
  return [
    px + w * tx + (y * tz - z * ty),
    py + w * ty + (z * tx - x * tz),
    pz + w * tz + (x * ty - y * tx),
  ];
}

type Vec3 = [number, number, number];
const at = (a: Float32Array, i: number) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]] as Vec3;
const dist = (a: Float32Array, i: number, j: number) => {
  const [px, py, pz] = at(a, i);
  const [qx, qy, qz] = at(a, j);
  return Math.hypot(px - qx, py - qy, pz - qz);
};

/** Six points that span all three axes, like a small box. */
const shape = Float32Array.from([
  0, 0, 0, 0.1, 0, 0, 0, 0.2, 0, 0, 0, 0.05, 0.1, 0.2, 0.05, 0.03, 0.1, 0,
]);
const s = Math.SQRT1_2;
const q: [number, number, number, number] = [
  Math.cos(0.4),
  Math.sin(0.4) * s,
  0,
  Math.sin(0.4) * s,
];
const moved = (f: (p: Vec3) => number[]) => {
  const out = new Float32Array(shape.length);
  for (let i = 0; i < shape.length / 3; i++) out.set(f(at(shape, i)), i * 3);
  return out;
};

describe("fitting a rigid piece to where its binding put it", () => {
  it("recovers a rotation and translation exactly", () => {
    const shift: Vec3 = [0.5, 1.2, -0.3];
    const to = moved((p) => rotate(q, p).map((c, k) => c + (shift[k] as number)));
    const fit = rigidFit(shape, to);
    // q and -q are the same rotation.
    const sign = Math.sign(fit.rotation[0]) * Math.sign(q[0]);
    for (const [k, c] of fit.rotation.entries()) expect(c * sign).toBeCloseTo(q[k] as number, 5);
    expect(fit.translation[0]).toBeCloseTo(0.5, 5);
    const out = placeRigid(shape, to, new Float32Array(shape.length));
    for (const [i, c] of out.entries()) expect(c).toBeCloseTo(to[i] as number, 5);
  });

  it("keeps the piece's shape when the body under it was stretched, centred where the binding put it", () => {
    const to = moved(([x, y, z]) => rotate(q, [x * 1.6, y * 0.7, z * 1.3]));
    const out = placeRigid(shape, to, new Float32Array(shape.length));
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++) expect(dist(out, i, j)).toBeCloseTo(dist(shape, i, j), 5);
    for (let k = 0; k < 3; k++) {
      const mean = (a: Float32Array) =>
        a.filter((_, i) => i % 3 === k).reduce((t, c) => t + c, 0) / 6;
      expect(mean(out)).toBeCloseTo(mean(to), 5);
    }
  });
});

describe("a rigid piece's skin", () => {
  it("follows the one bone that carries most of the whole piece", () => {
    // Two vertices: the first mostly bone 3, the second split 2 and 3; bone 3 wins overall.
    const pad = (...values: number[]) => [
      ...values,
      ...new Array<number>(SKIN_INFLUENCES - values.length).fill(0),
    ];
    const skin = {
      index: Uint8Array.from([...pad(3, 2), ...pad(2, 3)]),
      weight: Float32Array.from([...pad(0.8, 0.2), ...pad(0.6, 0.4)]),
    };
    expect(rigidSkin(skin)).toEqual({
      index: Uint8Array.from([...pad(3), ...pad(3)]),
      weight: Float32Array.from([...pad(1), ...pad(1)]),
    });
  });
});

describe("a garment the pack declares rigid", () => {
  const HAT = "hats/fedora01";
  const flagged = (rigid: unknown) =>
    ({
      ...clothingManifest,
      garments: {
        ...clothingManifest.garments,
        entries: clothingManifest.garments.entries.map((g) => (g.id === HAT ? { ...g, rigid } : g)),
      },
    }) as ClothingManifest;
  const { garments } = clothingPackData();
  const modelWith = (manifest: ClothingManifest) =>
    new HumanoidModel(
      parseHumanoidAssets(bodyPackData(), undefined, {
        manifest,
        garments: garments as ArrayBuffer,
      }),
      { subdivision: 0 },
    );

  it("keeps its shape on every figure, where a cloth hat does not", () => {
    const placed = (m: HumanoidModel, age: number) => {
      const e = m.evaluate(createRecipe({ macros: { age, gender: 1 }, outfit: [HAT] }));
      return e.garments[0]?.positions as Float32Array;
    };
    const span = (a: Float32Array) => dist(a, 0, Math.floor(a.length / 6));
    const rigid = modelWith(flagged(true));
    expect(span(placed(rigid, 8))).toBeCloseTo(span(placed(rigid, 30)), 5);
    const cloth = modelWith(clothingManifest);
    expect(Math.abs(span(placed(cloth, 8)) - span(placed(cloth, 30)))).toBeGreaterThan(1e-3);
  });

  it("refuses a rigid flag that is not true or false", () => {
    expect(() => modelWith(flagged("yes"))).toThrow(AssetFormatError);
  });
});
