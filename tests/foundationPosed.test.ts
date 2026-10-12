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
import {
  FOLD_KEYS,
  FOLD_OPENINGS,
  FOLD_ROW_TEXELS,
  type HipFold,
  type SurfaceFold,
} from "../src/rig/hipFold.ts";
import { bodyPoseRotations, rigData, skinNormals, skinPositions } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
const recipe = createRecipe({ macros: { age: 25, gender: 1 } });
const adultModel = new HumanoidModel(loadFixtureAssets(true), { subdivision: 1 });
const adultRecipe = createRecipe({ macros: { age: 30 } });

/**
 * A structurally valid, nonzero fold for one rendered vertex. The rest pose
 * must ignore it before reading its data; a flexed pose must not. Keeping this
 * small lets the rest contract cover the core and adult surfaces without
 * rebuilding either model's expensive collision table inside one assertion.
 * The native table's collision and interpolation semantics belong to
 * `tests/hipFold.test.ts`.
 */
function restFoldWitness(vertexCount: number): HipFold {
  const slot = new Int32Array(vertexCount).fill(-1);
  slot[0] = 0;
  const entries = FOLD_OPENINGS * FOLD_KEYS * 3;
  return {
    vertices: Uint32Array.of(0),
    slot,
    vectors: Float32Array.from({ length: entries }, (_, i) =>
      i % 3 === 0 ? 0.02 : i % 3 === 1 ? -0.01 : 0.015,
    ),
    normals: Float32Array.from({ length: entries }, (_, i) =>
      i % 3 === 0 ? 0.03 : i % 3 === 1 ? -0.02 : 0.01,
    ),
    side: Float32Array.of(0.5),
  };
}

/** A nonzero renderer-surface fold for dispatch testing, not a replacement for the native solve. */
function activeFoldWitness(vertexCount: number): SurfaceFold {
  const slot = new Float32Array(vertexCount).fill(-1);
  slot[0] = 0;
  const data = new Uint16Array(FOLD_ROW_TEXELS * 4);
  for (let key = 0; key < FOLD_OPENINGS * FOLD_KEYS; key++) {
    data[key * 8] = toHalf(0.02);
    data[key * 8 + 5] = toHalf(-0.01);
  }
  data[3] = toHalf(0.5);
  return { slot, rows: 1, data };
}

const maxY = (p: Float32Array) => {
  let m = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < p.length; i += 3) m = Math.max(m, p[i] as number);
  return m;
};

describe("the posed body", () => {
  // The first posed evaluation builds the model's subdivided surface and its
  // fold tables, about 8 s alone and over 30 s when the whole unit project
  // runs at once, so both immutable rest surfaces are built here rather than
  // charged to an individual assertion.
  let body: ReturnType<typeof posedSurface>;
  let adultBody: ReturnType<typeof posedSurface>;
  let restAtSetup: Float32Array;
  let adultRestAtSetup: Float32Array;
  beforeAll(() => {
    body = posedSurface(model, recipe, REST_POSE);
    adultBody = posedSurface(adultModel, adultRecipe, REST_POSE);
    // `posedSurface` copies the evaluator's scratch arrays. Retain snapshots so
    // later pose cases prove they did not mutate either shared rest witness.
    restAtSetup = body.rest.slice();
    adultRestAtSetup = adultBody.rest.slice();
  }, 120_000);

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
        fold,
      );
      const normalsWithFold = skinNormals(
        surface.bones,
        surface.rotations,
        surface.restNormals,
        surface.skinIndex,
        surface.skinWeight,
        new Float32Array(surface.restNormals.length),
        fold,
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
        restFoldWitness(surface.vertexCount),
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
      const hipFold = vi.spyOn(m, "hipFold").mockImplementation(() => {
        throw new Error("a rest pose must not solve a hip fold");
      });
      try {
        expect(() => posedSurface(m, r, REST_POSE)).not.toThrow();
        expect(hipFold).not.toHaveBeenCalled();
      } finally {
        hipFold.mockRestore();
      }
    }
  });

  it("raises the hands above the head in the overhead pose", () => {
    const body = posedSurface(model, recipe, "overhead");
    expect(maxY(body.positions)).toBeGreaterThan(maxY(body.rest) + 0.05);
  });

  it("does not solve a fold for an upper-body pose below the hip-fold onset", () => {
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
      const witness = restFoldWitness(surface.vertexCount);
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
      const hipFold = vi.spyOn(m, "hipFold").mockImplementation(() => {
        throw new Error("an upper-body pose must not solve a hip fold");
      });
      try {
        expect(() => posedSurface(m, r, "overhead")).not.toThrow();
        expect(hipFold).not.toHaveBeenCalled();
      } finally {
        hipFold.mockRestore();
      }
    }
  });

  it("carries the renderer's hip fold where the hips flex, and nowhere at rest", () => {
    const hipFold = vi.spyOn(model, "hipFold").mockImplementation(function* () {
      yield;
      return { surface: "base", fold: activeFoldWitness(body.vertexCount) };
    });
    try {
      const seated = posedSurface(model, recipe, "seated");
      expect(hipFold).toHaveBeenCalledTimes(1);
      const unfolded = skinPositions(
        seated.bones,
        seated.rotations,
        seated.rest,
        seated.skinIndex,
        seated.skinWeight,
        new Float32Array(seated.rest.length),
      );
      expect(seated.positions).not.toEqual(unfolded);
      hipFold.mockClear();
      const flexed = posedSurface(model, recipe, "flexed");
      expect(hipFold).toHaveBeenCalledTimes(1);
      expect(flexed.positions).not.toEqual(
        skinPositions(
          flexed.bones,
          flexed.rotations,
          flexed.rest,
          flexed.skinIndex,
          flexed.skinWeight,
          new Float32Array(flexed.rest.length),
        ),
      );
    } finally {
      hipFold.mockRestore();
    }
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

  it("welds as the model's topology does: the seams found by position are the surface's own", () => {
    for (const [m, b] of [
      [model, body],
      [adultModel, adultBody],
    ] as const) {
      expect(b.surface).toBe(m === model ? "base" : "adult");
      expect(m.renderWeld(b.surface)).toEqual(b.weld);
      expect(m.bodyIndex(b.surface)).toBe(b.index);
    }
    expect(body.rest).toEqual(restAtSetup);
    expect(adultBody.rest).toEqual(adultRestAtSetup);
  });
});
