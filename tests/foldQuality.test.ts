import { afterEach, describe, expect, it, vi } from "vitest";
import { HipContact, KneeContact } from "../scripts/lib/foldContact.ts";
import { bodyTriangles } from "../scripts/lib/skinMeasure.ts";
import { SKIN_INFLUENCES } from "../src/format/assetFormat.ts";
import { HumanoidModel, type ModelOptions } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { IDENTITY_POSE, type RestBones } from "../src/rig/bones.ts";
import { PosedSkin, TriangleCrossings } from "../src/rig/contact.ts";
import { type FoldSetup, runSolve, solveFold } from "../src/rig/foldSolve.ts";
import { jointRotations } from "../src/rig/folds.ts";
import { HIP_FOLD } from "../src/rig/hipFold.ts";
import * as hipSolver from "../src/rig/hipFoldSolve.ts";
import { type JointFold, noFold } from "../src/rig/jointFold.ts";
import { KNEE_FOLD } from "../src/rig/kneeFold.ts";
import * as kneeSolver from "../src/rig/kneeFoldSolve.ts";
import { restBones, skinPositions } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const arrays = ["vertices", "slot", "vectors", "normals", "side", "strains"] as const;
const bytes = (array: ArrayBufferView) =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/** Every keyed vertex, including a vertex only one of the solves retains. */
function error(full: JointFold, reduced: JointFold, field: "vectors" | "normals" | "strains") {
  const width = full.joint.keys * full.joint.openings * (field === "strains" ? 1 : 3);
  let sum = 0;
  let max = 0;
  let count = 0;
  for (let v = 0; v < full.slot.length; v++) {
    const a = full.slot[v] as number;
    const b = reduced.slot[v] as number;
    if (a < 0 && b < 0) continue;
    for (let k = 0; k < width; k++) {
      const d = Math.abs(
        (a < 0 ? 0 : (full[field][a * width + k] as number)) -
          (b < 0 ? 0 : (reduced[field][b * width + k] as number)),
      );
      sum += d;
      max = Math.max(max, d);
      count++;
    }
  }
  return { mae: sum / Math.max(1, count), max };
}

describe("fold solve quality", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects invalid ceilings before model work or an empty solver can hide them", () => {
    const assets = loadFixtureAssets();
    const rest: RestBones = {
      names: [],
      parents: new Int16Array(),
      heads: new Float32Array(),
      order: new Int16Array(),
    };
    for (const value of [0, -1, 1.5, 61, Number.NaN, Number.POSITIVE_INFINITY, null, "20"]) {
      const foldSolvePasses = value as number;
      expect(() => new HumanoidModel(assets, { foldSolvePasses })).toThrow(/foldSolvePasses/);
      for (const solve of [hipSolver.solveHipFold, kneeSolver.solveKneeFold])
        expect(() =>
          solve(
            rest,
            new Float32Array(),
            new Uint8Array(),
            new Float32Array(),
            new Uint32Array(),
            foldSolvePasses,
          ),
        ).toThrow(/foldSolvePasses/);
    }
  });

  it("copies the ceiling once, passes it to both joint solvers and keeps the model's cache", () => {
    const assets = loadFixtureAssets();
    const options: ModelOptions = { subdivision: 0, foldSolvePasses: 1 };
    const model = new HumanoidModel(assets, options);
    options.foldSolvePasses = 60;
    const hip = vi
      .spyOn(hipSolver, "solveHipFoldSteps")
      .mockImplementation(function* (_rest, control) {
        yield;
        return noFold(control.length / 3, HIP_FOLD);
      });
    const knee = vi
      .spyOn(kneeSolver, "solveKneeFoldSteps")
      .mockImplementation(function* (_rest, control) {
        yield;
        return noFold(control.length / 3, KNEE_FOLD);
      });
    const recipe = createRecipe();
    runModel(model.folds(recipe));
    runModel(model.folds(recipe));
    for (const solver of [hip, knee]) {
      expect(solver).toHaveBeenCalledTimes(1);
      expect(solver.mock.calls[0]?.[5]).toBe(1);
    }
  });

  it.each([0.01, 0.03])("retains rounded grid-boundary triangles at scale %f", (scale) => {
    // The original .01 triangle's Float32 centroid rounds below its double
    // centroid. Grid bounds must use the same precision as bucket insertion.
    const control = Float32Array.from([0, 0, 0, scale, 0, 0, 0, scale, 0, 0.002, 0.002, 0.001]);
    const rest: RestBones = {
      names: ["root"],
      parents: Int16Array.of(-1),
      heads: new Float32Array(3),
      order: Int16Array.of(0),
    };
    const skinIndex = new Uint8Array(4 * SKIN_INFLUENCES);
    const skinWeight = new Float32Array(4 * SKIN_INFLUENCES);
    for (let v = 0; v < 4; v++) skinWeight[v * SKIN_INFLUENCES] = 1;
    const setup: FoldSetup = {
      joint: {
        name: "hip",
        bone: "root",
        above: null,
        from: 0,
        step: 1,
        to: 1,
        keys: 1,
        openings: 1,
        opened: 0,
      },
      movers: Uint32Array.of(3),
      patch: Uint32Array.of(0, 1, 2),
      givers: new Uint8Array(4),
      pressing: new Uint32Array(),
      give: 0,
      press: { near: 0.01, far: 0.02 },
      patchSmooths: "touched",
      mutual: false,
      smoothsShaded: false,
      taper: new Float32Array(4).fill(1),
      sides: new Float32Array(4).fill(1),
      rotationsAt: () => IDENTITY_POSE(1),
    };
    // A deliberately unresolved contact with no separating direction: the
    // actual solver keeps trying, rather than settling or moving out of reach.
    const contacts = vi.spyOn(PosedSkin.prototype, "signed").mockImplementation(function (
      this: PosedSkin,
      _x,
      _y,
      _z,
      _point,
      _candidates,
      outward,
    ) {
      this.nearest = 0;
      outward?.fill(0);
      return -0.001;
    });
    const crossings = vi.spyOn(TriangleCrossings.prototype, "find");
    const solve = (passes: number) => {
      contacts.mockClear();
      crossings.mockClear();
      runSolve(
        solveFold(
          rest,
          control,
          skinIndex,
          skinWeight,
          Uint32Array.of(0, 1, 2, 0, 1, 3),
          setup,
          passes,
        ),
      );
      return { contacts: contacts.mock.calls.length, crossings: crossings.mock.calls.length };
    };
    const full = solve(60);
    const reduced = solve(20);
    expect(full.contacts).toBe(60 + 15);
    expect(reduced.contacts).toBe(20 + 15);
    expect(full.crossings).toBeGreaterThan(reduced.crossings);
    expect(reduced.crossings / full.crossings).toBeCloseTo(35 / 75, 8);
  });

  it("preserves every default source byte and measures the explicit lower ceiling's CPU and geometry tradeoff", {
    timeout: 180_000,
  }, () => {
    const assets = loadFixtureAssets();
    const model = new HumanoidModel(assets, { subdivision: 0 });
    const control = model.evaluate(
      createRecipe({ macros: { age: 25, weight: 1, muscle: 0.3 } }),
    ).control;
    const rest = restBones(assets, control);
    const tris = bodyTriangles(assets);
    const observations = [];
    for (const solve of [hipSolver.solveHipFold, kneeSolver.solveKneeFold]) {
      const input = [rest, control, assets.skinIndex, assets.skinWeight, tris] as const;
      const omitted = solve(...input);
      const started = performance.now();
      const full = solve(...input, 60);
      const fullMs = performance.now() - started;
      const lowerStarted = performance.now();
      const reduced = solve(...input, 5);
      const reducedMs = performance.now() - lowerStarted;
      for (const field of arrays) expect(bytes(full[field]), field).toEqual(bytes(omitted[field]));
      expect(reduced.joint).toBe(full.joint);
      // This source hip needs more than five passes: dropping the option in
      // either wrapper must fail, even if a naturally settling knee is exact.
      if (full.joint.name === "hip") expect(reduced.vectors).not.toEqual(full.vectors);
      expect(reduced.vertices.length).toBeGreaterThan(50);
      for (const field of ["vectors", "normals", "strains"] as const)
        expect([...reduced[field]].every(Number.isFinite), field).toBe(true);
      const contact =
        full.joint.name === "hip"
          ? new HipContact(assets, rest, control, tris)
          : new KneeContact(assets, rest, control, tris);
      const poses = [90, 120, 135, full.joint.to].flatMap((degrees) =>
        (full.joint.openings > 1 ? [0, full.joint.opened / 2, full.joint.opened] : [0]).map(
          (opening) => ({ degrees, opening }),
        ),
      );
      const depths = (fold: JointFold) =>
        poses.map(({ degrees, opening }) => {
          const rotations = jointRotations(full.joint, rest, degrees, opening);
          const posed = skinPositions(
            rest,
            rotations,
            control,
            assets.skinIndex,
            assets.skinWeight,
            new Float32Array(control.length),
            [fold],
          );
          return {
            degrees,
            opening,
            ...(contact instanceof KneeContact
              ? contact.penetration(posed, rotations)
              : contact.penetration(posed)),
          };
        });
      observations.push({
        joint: full.joint.name,
        firstRoundPasses: [60, 5],
        fullMs,
        reducedMs,
        displacementMetres: error(full, reduced, "vectors"),
        normalDelta: error(full, reduced, "normals"),
        strain: error(full, reduced, "strains"),
        fullPenetration: depths(full),
        reducedPenetration: depths(reduced),
      });
    }
    console.info("fold-quality-source-measurement", JSON.stringify(observations));
  });
});

function runModel<T>(steps: Generator<void, T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
