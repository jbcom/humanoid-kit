import { describe, expect, it } from "vitest";
import { AttachedFluidField, type PosedSurfaceFrame } from "../src/fluid/attachedField.ts";
import { FluidState } from "../src/fluid/state.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const topology = {
  topology: bodyManifest.topology,
  bodySha256: bodyManifest.body.sha256,
  triangleCount: 2,
};
const options = () => ({
  figureId: "coverage-figure",
  seed: 7,
  fixedStepSeconds: 1 / 60,
  topology,
  recipe: createRecipe({ macros: { age: 17 } }),
  assets: loadFixtureAssets(),
});
const frame = (positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, -1, 0]) =>
  ({
    topology: topology.topology,
    bodySha256: topology.bodySha256,
    surface: "base" as const,
    positions: new Float32Array(positions),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    index: new Uint32Array([0, 1, 2, 1, 3, 2]),
  }) satisfies PosedSurfaceFrame;

const source = (triangle: number, materialId = "water") => ({
  id: `${materialId}-${triangle}`,
  materialId,
  rateKgPerSecond: 0,
  anchor: {
    kind: "surface" as const,
    topology: topology.topology,
    bodySha256: topology.bodySha256,
    triangle,
    barycentric: [1, 0, 0] as [number, number, number],
  },
});

function createField(mobilityPerSecond = 0) {
  const state = new FluidState(options());
  const first = source(0);
  const second = source(1, "oil");
  state.registerSource(first);
  state.registerSource(second);
  return {
    state,
    first,
    second,
    field: new AttachedFluidField(state, frame(), {
      maxCells: 2,
      mobilityPerSecond,
      gravity: [0, -1, 0],
    }),
  };
}

describe("AttachedFluidField coverage snapshots", () => {
  it("reports immutable material-separated support coverage with SI mass and area", () => {
    const { field, first, second } = createField();
    field.inject(first.id, first.anchor, first.materialId, 0.006);
    field.inject(second.id, second.anchor, second.materialId, 0.003);

    const snapshot = field.coverageSnapshot(frame());
    expect(snapshot.units).toEqual({
      area: "m2",
      arealMassDensity: "kg/m2",
      mass: "kg",
      position: "m",
    });
    expect(snapshot.attachedKg).toBeCloseTo(0.009, 12);
    expect(snapshot.cells).toEqual([
      {
        triangle: 0,
        materialId: "water",
        massKg: 0.006,
        supportAreaM2: 0.5,
        arealMassDensityKgPerM2: 0.012,
        coverage: 1,
        positionM: [0, 0, 0],
        normal: [0, 0, 1],
      },
      {
        triangle: 1,
        materialId: "oil",
        massKg: 0.003,
        supportAreaM2: 0.5,
        arealMassDensityKgPerM2: 0.006,
        coverage: 1,
        positionM: [1, 0, 0],
        normal: [0, 0, 1],
      },
    ]);
    expect(snapshot.materials).toEqual([
      { materialId: "oil", attachedKg: 0.003, coveredAreaM2: 0.5, vertexCoverage: [0, 1, 1, 1] },
      { materialId: "water", attachedKg: 0.006, coveredAreaM2: 0.5, vertexCoverage: [1, 1, 1, 0] },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.cells)).toBe(true);
    expect(Object.isFrozen(snapshot.cells[0])).toBe(true);
    expect(Object.isFrozen(snapshot.materials)).toBe(true);
    expect(Object.isFrozen(snapshot.materials[0]?.vertexCoverage)).toBe(true);
  });

  it("reprojects coverage through a posed frame without changing triangle identity or mass", () => {
    const { state, field, first } = createField();
    field.inject(first.id, first.anchor, first.materialId, 0.25);
    const rest = field.coverageSnapshot(frame());
    const posed = field.coverageSnapshot(frame([0, 2, 0, 1, 2, 0, 0, 3, 0, 1, 1, 0]));

    expect(posed.cells[0]).toMatchObject({ triangle: 0, materialId: "water", massKg: 0.25 });
    expect(posed.cells[0]?.positionM).toEqual([0, 2, 0]);
    expect(posed.cells[0]?.positionM).not.toEqual(rest.cells[0]?.positionM);
    expect(posed.materials).toEqual(rest.materials);
    expect(posed.attachedKg).toBeCloseTo(state.snapshot().ledger.attachedKg, 12);
  });

  it("keeps snapshot mass conserved after deterministic downhill transport", () => {
    const { state, field, first } = createField(1);
    field.inject(first.id, first.anchor, first.materialId, 0.25);
    field.step(frame(), 1);

    const snapshot = field.coverageSnapshot(frame());
    expect(snapshot.cells).toHaveLength(1);
    expect(snapshot.cells[0]).toMatchObject({ triangle: 1, materialId: "water", massKg: 0.25 });
    expect(snapshot.materials.reduce((sum, material) => sum + material.attachedKg, 0)).toBeCloseTo(
      state.snapshot().ledger.attachedKg,
      12,
    );
    expect(snapshot.attachedKg).toBeCloseTo(state.snapshot().ledger.attachedKg, 12);
  });
});
