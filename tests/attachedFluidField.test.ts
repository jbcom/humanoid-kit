import { describe, expect, it } from "vitest";
import { AttachedFluidField, type PosedSurfaceFrame } from "../src/fluid/attachedField.ts";
import { FluidState, FluidStateError } from "../src/fluid/state.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const topology = {
  topology: bodyManifest.topology,
  bodySha256: bodyManifest.body.sha256,
  triangleCount: 2,
};
const options = () => ({
  figureId: "f",
  seed: 1,
  fixedStepSeconds: 1 / 60,
  topology,
  recipe: createRecipe({ macros: { age: 17 } }),
  assets: loadFixtureAssets(),
});
const source = {
  id: "s",
  materialId: "water",
  rateKgPerSecond: 0,
  anchor: {
    kind: "surface" as const,
    topology: topology.topology,
    bodySha256: topology.bodySha256,
    triangle: 0,
    barycentric: [1, 0, 0] as [number, number, number],
  },
};
const frame = (positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, -1, 0]) =>
  ({
    topology: topology.topology,
    bodySha256: topology.bodySha256,
    surface: "base" as const,
    positions: new Float32Array(positions),
    normals: new Float32Array(positions.length).fill(1),
    index: new Uint32Array([0, 1, 2, 1, 3, 2]),
  }) satisfies PosedSurfaceFrame;
function createField(maxCells = 2, mobility = 1) {
  const state = new FluidState(options());
  state.registerSource(source);
  return {
    state,
    field: new AttachedFluidField(state, frame(), {
      maxCells,
      mobilityPerSecond: mobility,
      gravity: [0, -1, 0],
    }),
  };
}
describe("AttachedFluidField", () => {
  it("moves only downhill while conserving the state ledger", () => {
    const { state, field } = createField();
    field.inject("s", source.anchor, "water", 1);
    field.step(frame(), 1);
    expect(field.frame()).toEqual([
      { triangle: 1, barycentric: [1 / 3, 1 / 3, 1 / 3], materialId: "water", massKg: 1 },
    ]);
    expect(state.snapshot().ledger.attachedKg).toBe(1);
  });
  it("carries anchors through a pose when mobility is zero", () => {
    const { field } = createField(2, 0);
    field.inject("s", source.anchor, "water", 0.25);
    const before = field.frame();
    field.step(frame([0, 2, 0, 1, 2, 0, 0, 3, 0, 1, 1, 0]), 1);
    expect(field.frame()).toEqual(before);
  });
  it("rejects capacity and malformed frames without creating ledger mass", () => {
    const { state, field } = createField(1);
    const second = {
      ...source,
      id: "s2",
      materialId: "oil",
      anchor: { ...source.anchor, triangle: 1 },
    };
    state.registerSource(second);
    field.inject("s", source.anchor, "water", 0.1);
    const before = state.snapshot();
    expect(() => field.inject("s2", second.anchor, "oil", 0.1)).toThrow("capacity");
    expect(() =>
      field.step({ ...frame(), index: new Uint32Array([0, 1, 99, 1, 3, 2]) }, 1),
    ).toThrow(FluidStateError);
    expect(() => field.step({ ...frame(), index: new Uint32Array([1, 3, 2, 0, 1, 2]) }, 1)).toThrow(
      "topology differs",
    );
    expect(state.snapshot()).toEqual(before);
  });
  it("applies simultaneous chain transfers without creating mass", () => {
    const chainTopology = { ...topology, triangleCount: 3 };
    const chainOptions = { ...options(), topology: chainTopology };
    const state = new FluidState(chainOptions);
    const chainFrame = {
      topology: chainTopology.topology,
      bodySha256: chainTopology.bodySha256,
      surface: "base" as const,
      positions: new Float32Array([0, 3, 0, 1, 2, 0, 0, 2, 0, 1, 1, 0, 0, 0, 0]),
      normals: new Float32Array(15).fill(1),
      index: new Uint32Array([0, 1, 2, 1, 3, 2, 3, 4, 2]),
    } satisfies PosedSurfaceFrame;
    const sources = [0, 1, 2].map((triangle) => ({
      ...source,
      id: `s${triangle}`,
      anchor: { ...source.anchor, triangle },
    }));
    for (const registration of sources) state.registerSource(registration);
    const field = new AttachedFluidField(state, chainFrame, {
      maxCells: 3,
      mobilityPerSecond: 1,
      gravity: [0, -1, 0],
    });
    for (const registration of sources)
      field.inject(registration.id, registration.anchor, "water", 1);
    field.step(chainFrame, 1);
    expect(field.frame().reduce((sum, cell) => sum + cell.massKg, 0)).toBeCloseTo(3);
    expect(state.snapshot().ledger.attachedKg).toBe(3);
  });

  it("applies simultaneous chain transfers without creating mass", () => {
    const chainTopology = { ...topology, triangleCount: 3 };
    const state = new FluidState({ ...options(), topology: chainTopology });
    const chainFrame = {
      topology: chainTopology.topology,
      bodySha256: chainTopology.bodySha256,
      surface: "base" as const,
      positions: new Float32Array([0, 3, 0, 1, 2, 0, 0, 2, 0, 1, 1, 0, 0, 0, 0]),
      normals: new Float32Array(15).fill(1),
      index: new Uint32Array([0, 1, 2, 1, 3, 2, 3, 4, 2]),
    } satisfies PosedSurfaceFrame;
    const sources = [0, 1, 2].map((triangle) => ({
      ...source,
      id: `s${triangle}`,
      anchor: { ...source.anchor, triangle },
    }));
    for (const registration of sources) state.registerSource(registration);
    const field = new AttachedFluidField(state, chainFrame, {
      maxCells: 3,
      mobilityPerSecond: 1,
      gravity: [0, -1, 0],
    });
    for (const registration of sources)
      field.inject(registration.id, registration.anchor, "water", 1);
    field.step(chainFrame, 1);
    expect(field.frame().reduce((sum, cell) => sum + cell.massKg, 0)).toBeCloseTo(3);
    expect(state.snapshot().ledger.attachedKg).toBe(3);
  });
});
