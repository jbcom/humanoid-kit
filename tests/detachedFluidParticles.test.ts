import { describe, expect, it } from "vitest";
import { AttachedFluidField, type PosedSurfaceFrame } from "../src/fluid/attachedField.ts";
import { DetachedFluidParticles } from "../src/fluid/detachedParticles.ts";
import { FluidState } from "../src/fluid/state.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const topology = {
  topology: bodyManifest.topology,
  bodySha256: bodyManifest.body.sha256,
  triangleCount: 1,
};
const source = {
  id: "surface-water",
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
const frame = {
  topology: topology.topology,
  bodySha256: topology.bodySha256,
  surface: "base" as const,
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  index: new Uint32Array([0, 1, 2]),
} satisfies PosedSurfaceFrame;

function released() {
  const state = new FluidState({
    figureId: "particle-figure",
    seed: 23,
    fixedStepSeconds: 0.5,
    topology,
    recipe: createRecipe({ macros: { age: 17 } }),
    assets: loadFixtureAssets(),
  });
  state.registerSource(source);
  const field = new AttachedFluidField(state, frame, {
    maxCells: 1,
    mobilityPerSecond: 0,
    gravity: [0, -1, 0],
  });
  field.inject(source.id, source.anchor, source.materialId, 0.5);
  const [release] = field.detach(frame, [{ triangle: 0, materialId: "water", massKg: 0.5 }]);
  if (!release) throw new Error("particle fixture needs one detached release");
  return { state, release };
}

describe("DetachedFluidParticles", () => {
  it("moves exact released mass by caller velocity and SI gravity at fixed steps", () => {
    const { state, release } = released();
    const particles = new DetachedFluidParticles(state, {
      maxParticles: 1,
      gravityMps2: [0, -2, 0],
    });

    const [spawned] = particles.spawn([{ release, velocityMps: [1, 2, 3] }]);
    if (!spawned) throw new Error("particle fixture needs one spawned particle");
    expect(spawned).toMatchObject({ materialId: "water", massKg: 0.5, positionM: [0, 0, 0] });
    expect(Object.isFrozen(spawned)).toBe(true);
    particles.stepFixed(2);

    const [moved] = particles.frame();
    if (!moved) throw new Error("particle fixture needs one moved particle");
    expect(moved.positionM[0]).toBeCloseTo(1, 12);
    expect(moved.positionM[1]).toBeCloseTo(0.5, 12);
    expect(moved.positionM[2]).toBeCloseTo(3, 12);
    expect(moved.velocityMps).toEqual([1, 0, 3]);
    expect(particles.massKg()).toBeCloseTo(0.5, 12);
    expect(state.snapshot().ledger).toMatchObject({ detachedKg: 0.5 });
    expect(state.snapshot().fixedSteps).toBe(2);
    particles.dispose();
  });

  it("refuses a concurrent second particle pool for one detached ledger", () => {
    const { state, release } = released();
    const first = new DetachedFluidParticles(state, {
      maxParticles: 1,
      gravityMps2: [0, 0, 0],
    });
    first.spawn([{ release, velocityMps: [0, 0, 0] }]);

    expect(
      () =>
        new DetachedFluidParticles(state, {
          maxParticles: 1,
          gravityMps2: [0, 0, 0],
        }),
    ).toThrow("active detached particle pool");
    expect(first.massKg()).toBeCloseTo(state.snapshot().ledger.detachedKg, 12);

    first.dispose();
    const replacement = new DetachedFluidParticles(state, {
      maxParticles: 1,
      gravityMps2: [0, 0, 0],
    });
    replacement.spawn([{ release, velocityMps: [0, 0, 0] }]);
    expect(replacement.massKg()).toBeCloseTo(state.snapshot().ledger.detachedKg, 12);
    replacement.dispose();
  });

  it("rejects capacity and detached-ledger overclaim without changing particles or ledger", () => {
    const { state, release } = released();
    const particles = new DetachedFluidParticles(state, {
      maxParticles: 1,
      gravityMps2: [0, 0, 0],
    });
    particles.spawn([{ release, velocityMps: [0, 0, 0] }]);
    const before = { frame: particles.frame(), state: state.snapshot() };

    expect(() => particles.spawn([{ release, velocityMps: [0, 0, 0] }])).toThrow("capacity");
    expect(particles.frame()).toEqual(before.frame);
    expect(state.snapshot()).toEqual(before.state);
    particles.dispose();
  });

  it("rejects an overflowing state clock before changing the particle frame", () => {
    const { state, release } = released();
    const particles = new DetachedFluidParticles(state, {
      maxParticles: 1,
      gravityMps2: [0, 0, 0],
    });
    particles.spawn([{ release, velocityMps: [1, 2, 3] }]);
    state.advanceFixedSteps(Number.MAX_SAFE_INTEGER);
    const before = { frame: particles.frame(), state: state.snapshot() };

    expect(() => particles.stepFixed(1)).toThrow("fixed step count");
    expect(particles.frame()).toEqual(before.frame);
    expect(state.snapshot()).toEqual(before.state);
    particles.dispose();
  });

  it("rejects finite inputs that would overflow motion before changing the particle frame", () => {
    const { state, release } = released();
    const particles = new DetachedFluidParticles(state, {
      maxParticles: 1,
      gravityMps2: [Number.MAX_VALUE, 0, 0],
    });
    particles.spawn([{ release, velocityMps: [Number.MAX_VALUE, 0, 0] }]);
    const before = { frame: particles.frame(), state: state.snapshot() };

    expect(() => particles.stepFixed(1)).toThrow("non-finite velocity");
    expect(particles.frame()).toEqual(before.frame);
    expect(state.snapshot()).toEqual(before.state);
    particles.dispose();
  });
});
