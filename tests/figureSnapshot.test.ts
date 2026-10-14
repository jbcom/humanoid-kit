import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import type { FigurePartRest, FigureRest, PosedFigure } from "../src/bake/figure.ts";
import {
  advanceFigureSnapshotCounters,
  createFigureSnapshotProducer,
  type FigureSnapshot,
  FigureSnapshotError,
} from "../src/bake/figureSnapshot.ts";
import type { HumanoidModel } from "../src/model/humanoidModel.ts";

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const options = { figureId: "figure", coordinateFrameId: "room" };
const first = (s: FigureSnapshot) => {
  const p = s.parts[0];
  assert.ok(p);
  return p;
};

/** Analytic split-UV render vertices; the second full triangle is hidden by an outfit mask. */
function fixture() {
  const p: FigurePartRest = {
    id: "body",
    kind: "body",
    role: "body",
    rest: new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0, 100, 100, 0]),
    restNormals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    index: new Uint32Array([0, 1, 2]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    skinIndex: new Uint16Array(32),
    skinWeight: new Float32Array(32),
    bodyRegion: new Uint8Array(4),
    material: null,
    textureUrl: null,
  };
  for (let v = 0; v < 4; v++) p.skinWeight[v * 8] = 1;
  const fullIndex = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const sourceTopology = { index: fullIndex, uvs: p.uvs, vertexCount: 4 };
  const model = {
    assets: {
      manifest: { unit: "metre", topology: "makehuman-hm08", body: { sha256: "fixture-body" } },
    },
    topology: () => ({ body: sourceTopology, attachments: [] }),
    garmentTopology: () => sourceTopology,
    evaluate: () => {
      throw new Error("snapshot bridge must not evaluate");
    },
  } as unknown as HumanoidModel;
  const rest: FigureRest = {
    parts: [p],
    body: "base",
    bones: {
      names: ["root"],
      parents: new Int16Array([-1]),
      heads: new Float32Array(3),
      order: new Int16Array([0]),
    },
    control: p.rest.slice(),
    folds: [],
    model,
  };
  return { rest, p, fullIndex, sourceTopology };
}

function posed(rest: FigureRest, lift = 2): PosedFigure {
  return {
    body: rest.body,
    bones: rest.bones,
    rotations: new Float32Array([0, 0, 0, 1]),
    groundOffset: lift,
    parts: rest.parts.map((p) => ({
      ...p,
      positions: p.rest.map((n, k) => n + (k % 3 === 1 ? lift : 0)),
      normals: p.restNormals.slice(),
    })),
  };
}

describe("checked snapshot counters", () => {
  it.each(["topology", "geometry", "pose", "transform", "completedFrameId"] as const)(
    "rejects %s overflow without mutating any counter in an otherwise valid multi-counter transition",
    (key) => {
      const before = { topology: 1, geometry: 1, pose: 1, transform: 1, completedFrameId: 1 };
      before[key] = Number.MAX_SAFE_INTEGER;
      const original = { ...before };
      expect(() =>
        advanceFigureSnapshotCounters(before, {
          topology: true,
          geometry: true,
          pose: true,
          transform: true,
          completedFrameId: true,
        }),
      ).toThrow(/overflow/);
      expect(before).toEqual(original);
      expect(advanceFigureSnapshotCounters(before, {})).toEqual(original);
    },
  );
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid counter %s",
    (pose) => {
      expect(() =>
        advanceFigureSnapshotCounters(
          { topology: 1, geometry: 1, pose, transform: 1, completedFrameId: 1 },
          { pose: true },
        ),
      ).toThrow(/safe integers/);
    },
  );
  it("accepts the last safe transition and never shares the prior tuple", () => {
    const before = {
      topology: 1,
      geometry: 1,
      pose: Number.MAX_SAFE_INTEGER - 1,
      transform: 1,
      completedFrameId: Number.MAX_SAFE_INTEGER - 1,
    };
    const next = advanceFigureSnapshotCounters(before, { pose: true, completedFrameId: true });
    expect(next.pose).toBe(Number.MAX_SAFE_INTEGER);
    expect(next.completedFrameId).toBe(Number.MAX_SAFE_INTEGER);
    expect(next).not.toBe(before);
    expect(before.pose).toBe(Number.MAX_SAFE_INTEGER - 1);
  });
});

describe("retained completed CPU figure snapshots", () => {
  it("copies the exact completed arrays and grounds only once, with bounds from selected triangle vertices", () => {
    const { rest, p } = fixture(),
      pose = posed(rest),
      toWorld = identity();
    const producer = createFigureSnapshotProducer(rest, options);
    const snapshot = producer.complete(pose, toWorld),
      part = first(snapshot),
      input = pose.parts[0];
    assert.ok(input);
    expect(snapshot.epochs).toEqual({ topology: 1, geometry: 1, pose: 1, transform: 1 });
    expect(snapshot.completedFrameId).toBe(1);
    expect(snapshot).toMatchObject({
      unit: "metre",
      metric: "euclidean",
      matrixLayout: "column-major",
      coordinateFrameId: "room",
    });
    expect(part.positions).toEqual(input.positions);
    expect(part.positions.buffer).not.toBe(input.positions.buffer);
    expect(part.rest.buffer).not.toBe(p.rest.buffer);
    expect(part.index.buffer).not.toBe(p.index.buffer);
    expect(part.uvs?.buffer).not.toBe(p.uvs?.buffer);
    expect(snapshot.localBounds).toEqual({ min: [0, 2, 0], max: [2, 3, 0] });
    expect(snapshot.worldBounds).toEqual(snapshot.localBounds);
    input.positions.fill(999);
    toWorld[12] = 999;
    expect(part.positions[0]).toBe(0);
    expect(snapshot.toWorld[12]).toBe(0);
    expect(producer.current(snapshot)).toBe(true);
  });

  it("retains hidden full topology without claiming volume, thickness, watertightness or GPU parity", () => {
    const { rest, fullIndex } = fixture();
    const producer = createFigureSnapshotProducer(rest, {
      ...options,
      indexSelection: "full-topology",
    });
    const snapshot = producer.complete(posed(rest), identity());
    expect(first(snapshot).index).toEqual(fullIndex);
    expect(first(snapshot).index.buffer).not.toBe(fullIndex.buffer);
    expect(snapshot.localBounds).toEqual({ min: [0, 2, 0], max: [100, 102, 0] });
    expect(snapshot.capabilities).toEqual({
      bounds: "selected-indexed-triangles",
      surfaceTriangles: "completed-cpu",
      volume: "unavailable",
      thickness: "unavailable",
      watertightness: "unverified",
      gpuParity: "unverified",
    });
  });

  it("computes world bounds from the actual selected vertices under column-major rotation and translation", () => {
    const { rest } = fixture();
    const producer = createFigureSnapshotProducer(rest, options);
    const m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
    const snapshot = producer.complete(posed(rest), m);
    expect(snapshot.worldBounds).toEqual({ min: [7, 20, 30], max: [8, 22, 30] });
    expect(first(snapshot).worldBounds).toEqual(snapshot.worldBounds);
  });

  it("advances pose on every accepted completion including same object and mutated reused arrays", () => {
    const { rest } = fixture(),
      pose = posed(rest);
    const producer = createFigureSnapshotProducer(rest, options);
    const a = producer.complete(pose, identity()),
      p = pose.parts[0];
    assert.ok(p);
    p.positions[0] = 0.5;
    const b = producer.complete(pose, identity());
    expect(b.epochs).toEqual({ topology: 1, geometry: 1, pose: 2, transform: 1 });
    expect(b.completedFrameId).toBe(2);
    expect(first(a).positions[0]).toBe(0);
    expect(producer.current(a)).toBe(false);
    expect(producer.current(b)).toBe(true);
    const c = producer.complete(pose, identity());
    expect(c.epochs.pose).toBe(3);
    const moved = identity();
    moved[12] = 4;
    const d = producer.complete(pose, moved);
    expect(d.epochs.transform).toBe(2);
  });

  it("separates geometry replacement from topology changes and invalidates authority before next pose", () => {
    const a = fixture(),
      producer = createFigureSnapshotProducer(a.rest, {
        ...options,
        indexSelection: "full-topology",
      });
    const before = producer.complete(posed(a.rest), identity());
    const b = fixture();
    b.p.rest[0] = 0.5;
    producer.replaceRest(b.rest);
    expect(producer.current(before)).toBe(false);
    const geometry = producer.complete(posed(b.rest), identity());
    expect(geometry.epochs).toEqual({ topology: 1, geometry: 2, pose: 2, transform: 1 });
    const c = fixture();
    c.fullIndex.set([0, 1, 2, 1, 2, 3]);
    producer.replaceRest(c.rest);
    const topology = producer.complete(posed(c.rest), identity());
    expect(topology.epochs).toEqual({ topology: 2, geometry: 3, pose: 3, transform: 1 });
    expect(topology.completedFrameId).toBe(3);
  });

  it("rejects source units other than metres rather than relabeling coordinates", () => {
    const a = fixture();
    Object.assign(a.rest.model.assets.manifest, { unit: "centimetre" });
    expect(() => createFigureSnapshotProducer(a.rest, options)).toThrow(/units/);
    const b = fixture(),
      producer = createFigureSnapshotProducer(b.rest, options),
      snapshot = producer.complete(posed(b.rest), identity());
    Object.assign(b.rest.model.assets.manifest, { unit: "centimetre" });
    expect(() => producer.complete(posed(b.rest), identity())).toThrow(/bind/);
    expect(producer.current(snapshot)).toBe(true);
  });

  it("captures provenance privately and advances topology on a completed replacement source", () => {
    const a = fixture(),
      producer = createFigureSnapshotProducer(a.rest, options);
    const initial = producer.complete(posed(a.rest), identity());
    const manifest = a.rest.model.assets.manifest;
    manifest.body.sha256 = "mutated-source";
    expect(() => producer.complete(posed(a.rest), identity())).toThrow(/bind/);
    expect(producer.current(initial)).toBe(true);
    const next = fixture();
    next.rest.model.assets.manifest.body.sha256 = "next-body";
    producer.replaceRest(next.rest);
    const changed = producer.complete(posed(next.rest), identity());
    expect(changed.bodySha256).toBe("next-body");
    expect(changed.epochs.topology).toBe(2);
    expect(initial.bodySha256).toBe("fixture-body");
  });

  it("cannot counterfeit authority by copying or editing public epochs, payload or coordinate frame", () => {
    const { rest } = fixture(),
      producer = createFigureSnapshotProducer(rest, options);
    const a = producer.complete(posed(rest), identity()),
      b = producer.complete(posed(rest), identity());
    Object.assign(a.epochs, b.epochs);
    Object.assign(a, { completedFrameId: b.completedFrameId });
    expect(producer.current(a)).toBe(false);
    expect(producer.current({ ...b })).toBe(false);
    Object.assign(b, { coordinateFrameId: "another-room" });
    expect(producer.current(b)).toBe(false);
    const c = producer.complete(posed(rest), identity());
    first(c).positions[0] = 9;
    expect(producer.current(c)).toBe(false);
    const d = producer.complete(posed(rest), identity());
    expect(first(d).positions[0]).toBe(0);
    expect(producer.current(d)).toBe(true);
    d.toWorld[12] = 9;
    expect(producer.current(d)).toBe(false);
    expect(createFigureSnapshotProducer(rest, options).current(d)).toBe(false);
  });

  it("rejects a changed completion during public payload inspection", () => {
    const { rest } = fixture(),
      producer = createFigureSnapshotProducer(rest, options);
    const snapshot = producer.complete(posed(rest), identity());
    Object.defineProperty(snapshot, "figureId", {
      get() {
        producer.complete(posed(rest), identity());
        return options.figureId;
      },
    });
    expect(producer.current(snapshot)).toBe(false);
  });

  it("rejects array substitutes and non-typed posed coordinates", () => {
    const { rest } = fixture(),
      producer = createFigureSnapshotProducer(rest, options);
    const snapshot = producer.complete(posed(rest), identity());
    const substituted = Array.from(first(snapshot).positions);
    Object.assign(substituted, { constructor: Float32Array });
    Object.assign(first(snapshot), { positions: substituted });
    expect(producer.current(snapshot)).toBe(false);
    const bad = posed(rest),
      p = bad.parts[0];
    assert.ok(p);
    Object.assign(p, { positions: Array.from(p.positions) });
    expect(() => producer.complete(bad, identity())).toThrow(/correspondence/);
  });

  it("rejects detached buffers and malformed public payloads without damaging producer state", () => {
    const { rest } = fixture(),
      producer = createFigureSnapshotProducer(rest, options);
    const a = producer.complete(posed(rest), identity());
    structuredClone(first(a).index, { transfer: [first(a).index.buffer as ArrayBuffer] });
    expect(producer.current(a)).toBe(false);
    const b = producer.complete(posed(rest), identity());
    Object.assign(b, { epochs: null });
    expect(producer.current(b)).toBe(false);
    const c = producer.complete(posed(rest), identity());
    expect(producer.current(c)).toBe(true);
  });

  it("fails atomically on invalid completion or rest replacement", () => {
    const { rest } = fixture(),
      producer = createFigureSnapshotProducer(rest, options),
      pose = posed(rest);
    const a = producer.complete(pose, identity()),
      bad = posed(rest),
      p = bad.parts[0];
    assert.ok(p);
    p.positions[0] = NaN;
    expect(() => producer.complete(bad, identity())).toThrow(FigureSnapshotError);
    const invalid = fixture();
    invalid.p.uvs = new Float32Array(2);
    expect(() => producer.replaceRest(invalid.rest)).toThrow(/correspondence/);
    expect(producer.current(a)).toBe(true);
    const b = producer.complete(pose, identity());
    expect(b.completedFrameId).toBe(2);
    expect(b.epochs.geometry).toBe(1);
  });

  it.each(["scale", "shear", "projective", "reflection", "nonfinite", "short"])(
    "rejects unsupported %s placement",
    (kind) => {
      const { rest } = fixture(),
        producer = createFigureSnapshotProducer(rest, options),
        m = identity();
      if (kind === "scale") m[0] = 2;
      if (kind === "shear") m[4] = 0.25;
      if (kind === "projective") m[3] = 0.1;
      if (kind === "reflection") m[0] = -1;
      if (kind === "nonfinite") m[12] = Infinity;
      if (kind === "short") m.pop();
      expect(() => producer.complete(posed(rest), m)).toThrow(FigureSnapshotError);
      expect(producer.complete(posed(rest), identity()).completedFrameId).toBe(1);
    },
  );

  it("rejects canonical changes and foreign pose identities instead of guessing a new evaluation", () => {
    const { rest, p } = fixture(),
      producer = createFigureSnapshotProducer(rest, options);
    const pose = posed(rest),
      original = p.rest[0];
    p.rest[0] = 9;
    expect(() => producer.complete(pose, identity())).toThrow(/rest replacement/);
    p.rest[0] = original as number;
    const foreign = posed(fixture().rest);
    expect(() => producer.complete(foreign, identity())).toThrow(/bind/);
    p.id = "changed";
    expect(() => producer.complete(pose, identity())).toThrow(/rest replacement/);
  });

  it("rejects full index mutation, bad correspondence and missing visible triangles", () => {
    const a = fixture(),
      producer = createFigureSnapshotProducer(a.rest, {
        ...options,
        indexSelection: "full-topology",
      });
    a.fullIndex[0] = 1;
    expect(() => producer.complete(posed(a.rest), identity())).toThrow(/rest replacement/);
    const b = fixture();
    b.fullIndex[5] = 99;
    expect(() =>
      createFigureSnapshotProducer(b.rest, { ...options, indexSelection: "full-topology" }),
    ).toThrow(/outside/);
    const c = fixture();
    c.fullIndex.set([0, 2, 3, 0, 2, 3]);
    expect(() =>
      createFigureSnapshotProducer(c.rest, { ...options, indexSelection: "full-topology" }),
    ).toThrow(/absent/);
    const d = fixture();
    d.sourceTopology.uvs = new Float32Array(8);
    expect(() =>
      createFigureSnapshotProducer(d.rest, { ...options, indexSelection: "full-topology" }),
    ).toThrow(/vertex\/UV/);
  });

  it("does not advertise bounds for empty selected geometry; a later valid replacement can complete", () => {
    const { rest, p } = fixture();
    p.index = new Uint32Array();
    const producer = createFigureSnapshotProducer(rest, options);
    expect(() => producer.complete(posed(rest), identity())).toThrow(/empty/);
    const next = fixture();
    producer.replaceRest(next.rest);
    expect(producer.complete(posed(next.rest), identity()).completedFrameId).toBe(1);
  });

  it("allows a render-only part without a UV chart and excludes its zero-triangle bounds", () => {
    const { rest, p } = fixture();
    p.uvs = null;
    const empty = { ...p, id: "empty", role: "garment" as const, index: new Uint32Array() };
    rest.parts.push(empty);
    const snapshot = createFigureSnapshotProducer(rest, options).complete(posed(rest), identity());
    expect(first(snapshot).uvs).toBeNull();
    expect(snapshot.parts[1]?.localBounds).toBeNull();
    expect(snapshot.localBounds).toEqual({ min: [0, 2, 0], max: [2, 3, 0] });
  });

  it("releases idempotently, retaining historical copies but ending current authority", () => {
    const { rest } = fixture(),
      producer = createFigureSnapshotProducer(rest, options),
      snapshot = producer.complete(posed(rest), identity());
    const retained = first(snapshot).positions.slice();
    producer.release();
    producer.release();
    expect(producer.current(snapshot)).toBe(false);
    expect(first(snapshot).positions).toEqual(retained);
    expect(() => producer.complete(posed(rest), identity())).toThrow(/released/);
    expect(() => producer.replaceRest(rest)).toThrow(/released/);
  });
});
