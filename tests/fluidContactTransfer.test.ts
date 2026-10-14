import { describe, expect, it } from "vitest";
import { AttachedFluidField, type PosedSurfaceFrame } from "../src/fluid/attachedField.ts";
import { fluidAnchorPoint } from "../src/fluid/posedSurfaceFrame.ts";
import { FluidState, type FluidSurfaceAnchor } from "../src/fluid/state.ts";
import { resolveFluidSurfaceContact } from "../src/fluid/surfaceContact.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const topology = {
  topology: bodyManifest.topology,
  bodySha256: bodyManifest.body.sha256,
  triangleCount: 2,
};
const placement = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const frame = (): PosedSurfaceFrame => ({
  ...topology,
  surface: "base",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  index: new Uint32Array([0, 1, 2, 1, 3, 2]),
});
const anchor: FluidSurfaceAnchor = {
  kind: "surface",
  topology: topology.topology,
  bodySha256: topology.bodySha256,
  triangle: 0,
  barycentric: [1 / 3, 1 / 3, 1 / 3],
};

function fixture(maxDeposits = 2) {
  const state = (figureId: string) =>
    new FluidState({
      figureId,
      seed: 1,
      fixedStepSeconds: 1 / 60,
      topology,
      recipe: createRecipe({ macros: { age: 17 } }),
      assets: loadFixtureAssets(),
    });
  const source = state("source");
  const receiver = state("receiver");
  const third = state("third");
  const sourceFrame = frame();
  const receiverFrame = frame();
  const sourceGeneration = {};
  const receiverGeneration = {};
  const donor = new AttachedFluidField(source, sourceFrame, {
    maxCells: 2,
    mobilityPerSecond: 0,
    gravity: [0, -1, 0],
  });
  const target = new AttachedFluidField(receiver, receiverFrame, {
    maxCells: 2,
    mobilityPerSecond: 1,
    gravity: [0, -1, 0],
    maxDeposits,
    acceptedDepositMaterials: ["water"],
  });
  source.registerSource({ id: "skin", materialId: "water", anchor, rateKgPerSecond: 0 });
  donor.inject("skin", anchor, "water", 0.0005);
  const contact = resolveFluidSurfaceContact({
    id: "selected-contact",
    maxGapM: 0,
    source: {
      state: source,
      frame: sourceFrame,
      generation: sourceGeneration,
      poseId: "completed-source",
      figureToWorld: placement,
      anchor,
    },
    receiver: {
      state: receiver,
      frame: receiverFrame,
      generation: receiverGeneration,
      poseId: "completed-receiver",
      figureToWorld: placement,
      anchor,
    },
  });
  const request = { id: "retained-1", contact, materialId: "water", massKg: 0.0005 };
  const snapshot = () => ({
    source: source.snapshot(),
    receiver: receiver.snapshot(),
    third: third.snapshot(),
    cells: donor.frame(),
    deposits: target.depositedFrame(),
  });
  return {
    source,
    receiver,
    third,
    sourceFrame,
    receiverFrame,
    sourceGeneration,
    receiverGeneration,
    donor,
    target,
    contact,
    request,
    snapshot,
  };
}

describe("bounded paired fluid contact deposition", () => {
  it("debits one donor cell and retains exact terminal receiver mass without new emission or clock steps", () => {
    const f = fixture();
    const before = f.snapshot();
    const receipts = f.donor.depositOn(f.target, [f.request]);
    expect(f.donor.frame()).toEqual([]);
    expect(f.source.snapshot().ledger).toMatchObject({
      attachedKg: 0,
      injectedTotalKg: 0.0005,
      transferredTotalKg: 0.0005,
      receivedTotalKg: 0,
    });
    expect(f.receiver.snapshot().ledger).toMatchObject({
      attachedKg: 0,
      depositedKg: 0.0005,
      injectedTotalKg: 0,
      receivedTotalKg: 0.0005,
      transferredTotalKg: 0,
    });
    expect(f.source.snapshot().sourceInjectedKg).toEqual(before.source.sourceInjectedKg);
    expect(f.source.snapshot().fixedSteps).toBe(before.source.fixedSteps);
    expect(f.receiver.snapshot().fixedSteps).toBe(before.receiver.fixedSteps);
    expect(f.third.snapshot()).toEqual(before.third);
    expect(receipts[0]).toMatchObject({
      sourceFigureId: "source",
      receiverFigureId: "receiver",
      sourcePoseId: "completed-source",
      receiverPoseId: "completed-receiver",
      sourceGeneration: f.sourceGeneration,
      receiverGeneration: f.receiverGeneration,
      sourceAnchor: anchor,
      anchor,
      massKg: 0.0005,
      materialId: "water",
    });
    expect(Object.isFrozen(receipts)).toBe(true);
    expect(Object.isFrozen(receipts[0])).toBe(true);
    expect(f.target.coverageSnapshot(f.receiverFrame).attachedKg).toBe(0);
    expect(f.target.depositedCoverageSnapshot(f.receiverFrame).depositedKg).toBe(0.0005);
    const moved = {
      ...f.receiverFrame,
      positions: Float32Array.from(
        f.receiverFrame.positions,
        (value, index) => value + (index % 3 === 1 ? 2 : 0),
      ),
    };
    const anchored = f.target.depositedFrame()[0];
    if (!anchored) throw new Error("deposit must remain retained");
    expect(f.target.depositedCoverageSnapshot(moved).cells[0]?.positionM).toEqual(
      fluidAnchorPoint(moved, anchored.anchor),
    );
    f.target.step(moved, 10);
    expect(f.target.depositedFrame()).toEqual(receipts);
  });

  it("leaves both ledgers and stores exact when a later batch item is invalid", () => {
    const f = fixture();
    const before = f.snapshot();
    expect(() =>
      f.donor.depositOn(f.target, [
        { ...f.request, massKg: 0.00025 },
        { ...f.request, id: "later", materialId: "oil", massKg: 0.00025 },
      ]),
    ).toThrow("not eligible");
    expect(f.snapshot()).toEqual(before);
    expect(() =>
      f.donor.depositOn(f.target, [
        { ...f.request, massKg: 0.00025 },
        { ...f.request, id: "later", massKg: 0.0002500001 },
      ]),
    ).toThrow("more fluid");
    expect(f.snapshot()).toEqual(before);
  });

  it("rejects capacity and duplicate identities deterministically before any debit", () => {
    const f = fixture(1);
    const before = f.snapshot();
    expect(() =>
      f.donor.depositOn(f.target, [
        { ...f.request, massKg: 0.00025 },
        { ...f.request, id: "second", massKg: 0.00025 },
      ]),
    ).toThrow("capacity");
    expect(f.snapshot()).toEqual(before);
    const g = fixture();
    const beforeDuplicate = g.snapshot();
    expect(() =>
      g.donor.depositOn(g.target, [
        { ...g.request, massKg: 0.00025 },
        { ...g.request, massKg: 0.00025 },
      ]),
    ).toThrow("already retained");
    expect(g.snapshot()).toEqual(beforeDuplicate);
    g.donor.depositOn(g.target, [{ ...g.request, massKg: 0.00025 }]);
    const retained = g.snapshot();
    expect(() => g.donor.depositOn(g.target, [{ ...g.request, massKg: 0.00025 }])).toThrow(
      "already retained",
    );
    expect(g.snapshot()).toEqual(retained);
  });

  it("rejects forged, wrong-pair and stale completed-pose evidence without mutation", () => {
    const f = fixture();
    const before = f.snapshot();
    expect(() =>
      f.donor.depositOn(f.target, [{ ...f.request, contact: { ...f.contact } }]),
    ).toThrow("source/receiver pair");
    expect(f.snapshot()).toEqual(before);
    const thirdField = new AttachedFluidField(f.third, frame(), {
      maxCells: 1,
      mobilityPerSecond: 0,
      gravity: [0, -1, 0],
      maxDeposits: 1,
      acceptedDepositMaterials: ["water"],
    });
    expect(() => f.donor.depositOn(thirdField, [f.request])).toThrow("source/receiver pair");
    expect(f.snapshot()).toEqual(before);
    f.receiverFrame.positions[0] = 1;
    expect(() => f.donor.depositOn(f.target, [f.request])).toThrow("changed after pose completion");
    expect(f.snapshot()).toEqual(before);
  });

  it("requires explicit source-pair anchors, tolerance, topology and receiver eligibility", () => {
    const f = fixture();
    const input = {
      id: "explicit",
      source: f.contact.source,
      receiver: f.contact.receiver,
      maxGapM: 0,
    };
    expect(() => resolveFluidSurfaceContact({ ...input, maxGapM: undefined as never })).toThrow(
      "explicit",
    );
    expect(() =>
      resolveFluidSurfaceContact({
        ...input,
        source: { ...input.source, anchor: { ...anchor, kind: "adult-aperture" } as never },
      }),
    ).toThrow("explicit surface anchors");
    expect(() =>
      resolveFluidSurfaceContact({
        ...input,
        receiver: {
          ...input.receiver,
          figureToWorld: placement.map((value, index) => (index === 12 ? 0.1 : value)),
        },
      }),
    ).toThrow("outside caller contact tolerance");
    expect(() =>
      resolveFluidSurfaceContact({
        ...input,
        receiver: { ...input.receiver, anchor: { ...anchor, bodySha256: "wrong" } },
      }),
    ).toThrow("topology");
    expect(
      () =>
        new AttachedFluidField(f.third, frame(), {
          maxCells: 1,
          mobilityPerSecond: 0,
          gravity: [0, -1, 0],
          maxDeposits: 1,
        }),
    ).toThrow("eligibility");
    expect(
      () =>
        new AttachedFluidField(f.third, frame(), {
          maxCells: 1,
          mobilityPerSecond: 0,
          gravity: [0, -1, 0],
          maxDeposits: 1,
          acceptedDepositMaterials: ["water", "water"],
        }),
    ).toThrow("eligibility");
  });

  it("coalesces support coverage without changing individually retained anchors or double-counting area", () => {
    const f = fixture();
    f.donor.depositOn(f.target, [
      { ...f.request, massKg: 0.00025 },
      { ...f.request, id: "second", massKg: 0.00025 },
    ]);
    expect(f.target.depositedFrame()).toHaveLength(2);
    const coverage = f.target.depositedCoverageSnapshot(f.receiverFrame);
    expect(coverage.cells).toHaveLength(1);
    expect(coverage.cells[0]?.massKg).toBe(0.0005);
    expect(coverage.materials[0]?.coveredAreaM2).toBe(0.5);
    expect(coverage.materials[0]?.depositedKg).toBe(0.0005);
    expect(fixture().donor.frame()).toHaveLength(1);
  });

  it("returns deterministic receipt data for identical source-pair inputs", () => {
    const a = fixture();
    const b = fixture();
    expect(a.donor.depositOn(a.target, [a.request])).toEqual(
      b.donor.depositOn(b.target, [b.request]),
    );
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
