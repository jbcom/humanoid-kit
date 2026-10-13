/**
 * The posed body on the CPU (src/foundation/posed.ts): the rest pose leaves
 * every vertex where the evaluation put it, a pose moves the skin as it moves
 * the bones, and the seams' duplicates move together. That `skinPositions` is
 * what the shader draws is tests/browser/dualSkinning.test.ts's.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { REST_POSE } from "../src/foundation/permutations.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { toHalf } from "../src/rig/half.ts";
import { HIP_FOLD } from "../src/rig/hipFold.ts";
import { type JointFold, rowTexels, type SurfaceFold } from "../src/rig/jointFold.ts";
import { bodyPoseRotations, rigData, skinNormals, skinPositions } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const recipe = createRecipe({ macros: { age: 25, gender: 1 } });
const adultModel = new HumanoidModel(loadFixtureAssets(true), { subdivision: 1 });
const adultRecipe = createRecipe({ macros: { age: 30, gender: 0 } });

/**
 * A structurally valid, nonzero hip fold for one rendered vertex. The rest pose
 * must ignore it before reading its data; a flexed pose must not. Keeping this
 * small lets the rest contract cover the core and adult surfaces without
 * solving either model's folds inside one assertion. The native solve's
 * collision and interpolation semantics belong to `tests/hipFold.test.ts`.
 */
function restFoldWitness(vertexCount: number): JointFold {
  const slot = new Int32Array(vertexCount).fill(-1);
  slot[0] = 0;
  const entries = HIP_FOLD.openings * HIP_FOLD.keys;
  return {
    joint: HIP_FOLD,
    vertices: Uint32Array.of(0),
    slot,
    vectors: Float32Array.from({ length: entries * 3 }, (_, i) =>
      i % 3 === 0 ? 0.02 : i % 3 === 1 ? -0.01 : 0.015,
    ),
    normals: Float32Array.from({ length: entries * 3 }, (_, i) =>
      i % 3 === 0 ? 0.03 : i % 3 === 1 ? -0.02 : 0.01,
    ),
    side: Float32Array.of(0.5),
    strains: new Float32Array(entries),
  };
}

/** A nonzero renderer-surface hip fold for dispatch testing, not a replacement for the native solve. */
function activeFoldWitness(vertexCount: number): SurfaceFold {
  const slot = new Float32Array(vertexCount).fill(-1);
  slot[0] = 0;
  const data = new Uint16Array(rowTexels(HIP_FOLD) * 4);
  for (let key = 0; key < HIP_FOLD.openings * HIP_FOLD.keys; key++) {
    data[key * 8] = toHalf(0.02);
    data[key * 8 + 5] = toHalf(-0.01);
  }
  data[3] = toHalf(0.5);
  return { joint: HIP_FOLD, slot, rows: 1, data };
}

const maxY = (p: Float32Array) => {
  let m = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < p.length; i += 3) m = Math.max(m, p[i] as number);
  return m;
};

describe("the posed body", () => {
  // The first posed evaluation builds the model's subdivided surface, and the first that
  // flexes a joint solves the figure's folds (kept by its shape for the poses after):
  // seconds each alone, and far more when the whole unit project runs at once, so both
  // immutable rest surfaces and the seated body are made here rather than charged to
  // the first tests.
  let body: ReturnType<typeof posedSurface>;
  let adultBody: ReturnType<typeof posedSurface>;
  let seated: ReturnType<typeof posedSurface>;
  let restAtSetup: Float32Array;
  let adultRestAtSetup: Float32Array;
  beforeAll(() => {
    body = posedSurface(model, recipe, REST_POSE);
    adultBody = posedSurface(adultModel, adultRecipe, REST_POSE);
    seated = posedSurface(model, recipe, "seated");
    // `posedSurface` copies the evaluator's scratch arrays. Retain snapshots so
    // later pose cases prove they did not mutate either shared rest witness.
    restAtSetup = body.rest.slice();
    adultRestAtSetup = adultBody.rest.slice();
  }, 300_000);

  it("is the evaluated body itself at rest", () => {
    let worst = 0;
    for (let i = 0; i < body.positions.length; i++)
      worst = Math.max(worst, Math.abs((body.positions[i] as number) - (body.rest[i] as number)));
    expect(worst).toBeLessThan(1e-6);
    expect(body.positions.length).toBe(body.vertexCount * 3);
    expect(body.index.reduce((m, i) => Math.max(m, i), 0)).toBeLessThan(body.vertexCount);
  });

  it("at rest, ignores a valid nonzero fold and does not solve one", () => {
    for (const [m, r, surface] of [
      [model, recipe, body],
      [adultModel, adultRecipe, adultBody],
    ] as const) {
      const fold = restFoldWitness(surface.vertexCount);
      const withFold = skinPositions(
        surface.bones,
        surface.rotations,
        surface.rest,
        surface.skinIndex,
        surface.skinWeight,
        new Float32Array(surface.rest.length),
        [fold],
      );
      const normalsWithFold = skinNormals(
        surface.bones,
        surface.rotations,
        surface.restNormals,
        surface.skinIndex,
        surface.skinWeight,
        new Float32Array(surface.restNormals.length),
        [fold],
      );
      expect(surface.positions).toEqual(withFold);
      expect(surface.normals).toEqual(normalsWithFold);
      const flexedRotations = bodyPoseRotations(rigData(m.assets), "seated");
      const flexedWithFold = skinPositions(
        surface.bones,
        flexedRotations,
        surface.rest,
        surface.skinIndex,
        surface.skinWeight,
        new Float32Array(surface.rest.length),
        [restFoldWitness(surface.vertexCount)],
      );
      const flexedWithoutFold = skinPositions(
        surface.bones,
        flexedRotations,
        surface.rest,
        surface.skinIndex,
        surface.skinWeight,
        new Float32Array(surface.rest.length),
      );
      expect(flexedWithoutFold).not.toEqual(flexedWithFold);
      const folds = vi.spyOn(m, "folds").mockImplementation(() => {
        throw new Error("a rest pose must not solve a fold");
      });
      try {
        expect(() => posedSurface(m, r, REST_POSE)).not.toThrow();
        expect(folds).not.toHaveBeenCalled();
      } finally {
        folds.mockRestore();
      }
    }
  });

  it("raises the hands above the head in the overhead pose", () => {
    const body = posedSurface(model, recipe, "overhead");
    expect(maxY(body.positions)).toBeGreaterThan(maxY(body.rest) + 0.05);
  });

  it("does not solve a fold for an upper-body pose that flexes no joint past its fold's start", () => {
    for (const [m, r, surface] of [
      [model, recipe, body],
      [adultModel, adultRecipe, adultBody],
    ] as const) {
      const rotations = bodyPoseRotations(rigData(m.assets), "overhead");
      const positionsWithoutFold = skinPositions(
        surface.bones,
        rotations,
        surface.rest,
        surface.skinIndex,
        surface.skinWeight,
        new Float32Array(surface.rest.length),
      );
      const normalsWithoutFold = skinNormals(
        surface.bones,
        rotations,
        surface.restNormals,
        surface.skinIndex,
        surface.skinWeight,
        new Float32Array(surface.restNormals.length),
      );
      const witness = [restFoldWitness(surface.vertexCount)];
      expect(
        skinPositions(
          surface.bones,
          rotations,
          surface.rest,
          surface.skinIndex,
          surface.skinWeight,
          new Float32Array(surface.rest.length),
          witness,
        ),
      ).toEqual(positionsWithoutFold);
      expect(
        skinNormals(
          surface.bones,
          rotations,
          surface.restNormals,
          surface.skinIndex,
          surface.skinWeight,
          new Float32Array(surface.restNormals.length),
          witness,
        ),
      ).toEqual(normalsWithoutFold);
      const folds = vi.spyOn(m, "folds").mockImplementation(() => {
        throw new Error("an upper-body pose must not solve a fold");
      });
      try {
        expect(() => posedSurface(m, r, "overhead")).not.toThrow();
        expect(folds).not.toHaveBeenCalled();
      } finally {
        folds.mockRestore();
      }
    }
  });

  it("asks for the renderer's folds once per flexed pose, and carries them", () => {
    const folds = vi.spyOn(model, "folds").mockImplementation(function* () {
      yield;
      return { surface: "base" as const, folds: [activeFoldWitness(body.vertexCount)] };
    });
    try {
      for (const pose of ["seated", "flexed"]) {
        folds.mockClear();
        const posed = posedSurface(model, recipe, pose);
        expect(folds).toHaveBeenCalledTimes(1);
        expect(posed.positions).not.toEqual(
          skinPositions(
            posed.bones,
            posed.rotations,
            posed.rest,
            posed.skinIndex,
            posed.skinWeight,
            new Float32Array(posed.rest.length),
          ),
        );
      }
    } finally {
      folds.mockRestore();
    }
  });

  it("carries the renderer's joint folds where the hips and the knees flex", () => {
    const unfolded = skinPositions(
      seated.bones,
      seated.rotations,
      seated.rest,
      seated.skinIndex,
      seated.skinWeight,
      new Float32Array(seated.rest.length),
    );
    let moved = 0;
    for (let v = 0; v < seated.vertexCount; v++) {
      const d = Math.hypot(
        (seated.positions[v * 3] as number) - (unfolded[v * 3] as number),
        (seated.positions[v * 3 + 1] as number) - (unfolded[v * 3 + 1] as number),
        (seated.positions[v * 3 + 2] as number) - (unfolded[v * 3 + 2] as number),
      );
      if (d > 0.001) moved++;
    }
    expect(moved).toBeGreaterThan(50);
  });

  it("keeps the seams' duplicates together in a pose", () => {
    const body = posedSurface(model, recipe, "squat");
    let seams = 0;
    let worst = 0;
    for (let v = 0; v < body.vertexCount; v++) {
      const w = body.weld[v] as number;
      if (w === v) continue;
      seams++;
      for (let k = 0; k < 3; k++)
        worst = Math.max(
          worst,
          Math.abs((body.positions[v * 3 + k] as number) - (body.positions[w * 3 + k] as number)),
        );
    }
    expect(seams).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-6);
  });

  it("welds as the model's topology does: a seam's duplicates, each one point of the surface", () => {
    for (const [m, b] of [
      [model, body],
      [adultModel, adultBody],
    ] as const) {
      expect(b.surface).toBe(m === model ? "base" : "adult");
      expect(m.renderWeld(b.surface)).toEqual(b.weld);
      expect(m.bodyIndex(b.surface)).toBe(b.index);
      // A seam's duplicates are one point of the surface.
      const at = (v: number) => [0, 1, 2].map((k) => b.rest[v * 3 + k]).join(",");
      for (let v = 0; v < b.vertexCount; v++)
        if (b.weld[v] !== v) expect(at(v)).toBe(at(b.weld[v] as number));
      if (b.surface !== "adult") continue;
      // A closed canal's two lips meet at rest, and are not one vertex: posed, they part.
      const first = new Map<string, number>();
      let meeting = 0;
      for (let v = 0; v < b.vertexCount; v++) {
        const w = first.get(at(v));
        if (w === undefined) first.set(at(v), v);
        else if (b.weld[v] !== b.weld[w]) meeting++;
      }
      expect(meeting).toBeGreaterThan(0);
    }
    expect(body.rest).toEqual(restAtSetup);
    expect(adultBody.rest).toEqual(adultRestAtSetup);
  });
});
