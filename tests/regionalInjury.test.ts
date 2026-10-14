import { describe, expect, it } from "vitest";
import {
  assertRegionalInjury,
  REGIONAL_INJURY_SCHEMA_VERSION,
  type RegionalInjury,
  type RegionalInjuryBody,
  RegionalInjuryState,
  routeRegionalInjuryLayers,
} from "../src/index.ts";

const body: RegionalInjuryBody = {
  topology: "hm08",
  bodySha256: "a".repeat(64),
  vertexCount: 8,
};

const marking = (): RegionalInjury => ({
  schemaVersion: REGIONAL_INJURY_SCHEMA_VERSION,
  id: "mark-1",
  class: "surface-marking",
  anchor: { topology: body.topology, bodySha256: body.bodySha256, vertex: 2 },
  persistence: "saved",
  lifecycle: "active",
  createdAt: 1,
  updatedAt: 1,
  sourceCategory: "consumer.paint",
  severityBand: "minor",
});

const transient = (): RegionalInjury => ({
  schemaVersion: REGIONAL_INJURY_SCHEMA_VERSION,
  id: "transient-1",
  class: "transient-deformation",
  anchor: { topology: body.topology, bodySha256: body.bodySha256, vertex: 3 },
  persistence: "session",
  lifecycle: "active",
  createdAt: 10,
  updatedAt: 10,
  sourceCategory: "consumer.contact",
  severityBand: "brief",
  duration: 2,
});

const persistent = (): RegionalInjury => ({
  schemaVersion: REGIONAL_INJURY_SCHEMA_VERSION,
  id: "persistent-1",
  class: "persistent-body-change",
  anchor: { topology: body.topology, bodySha256: body.bodySha256, vertex: 4 },
  persistence: "saved",
  lifecycle: "active",
  createdAt: 2,
  updatedAt: 2,
  sourceCategory: "consumer.history",
  severityBand: "lasting",
});

describe("regional injury state", () => {
  it("rejects incompatible anchors and invalid transient durations", () => {
    expect(() =>
      assertRegionalInjury(
        { ...marking(), anchor: { ...marking().anchor, topology: "other" } },
        body,
      ),
    ).toThrow("topology");
    expect(() =>
      assertRegionalInjury(
        { ...marking(), anchor: { ...marking().anchor, vertex: body.vertexCount } },
        body,
      ),
    ).toThrow("vertex");
    expect(() =>
      assertRegionalInjury(
        { ...marking(), anchor: { ...marking().anchor, bodySha256: "b".repeat(64) } },
        body,
      ),
    ).toThrow("SHA-256");
    expect(() => assertRegionalInjury({ ...marking(), schemaVersion: 2 } as unknown, body)).toThrow(
      "schemaVersion",
    );
    expect(() => assertRegionalInjury({ ...transient(), duration: 0 }, body)).toThrow("duration");
    expect(() => assertRegionalInjury({ ...marking(), duration: 2 } as unknown, body)).toThrow(
      "does not accept duration",
    );
    expect(() => assertRegionalInjury({ ...marking(), severityBand: " " }, body)).toThrow(
      "severityBand",
    );
    expect(() => assertRegionalInjury({ ...marking(), source: "legacy" } as unknown, body)).toThrow(
      "does not accept source",
    );
  });

  it("keeps classes distinct while lifecycle calls are observable and idempotent", () => {
    const state = new RegionalInjuryState(body);
    expect(state.create(marking())).toMatchObject({ type: "created", changed: true });
    expect(() => state.create(marking())).toThrow("duplicate");
    expect(() =>
      state.update({ ...marking(), class: "persistent-body-change", persistence: "saved" }),
    ).toThrow("cannot change class");

    const first = state.resolve("mark-1", 3);
    expect(first).toMatchObject({ type: "resolved", changed: true });
    expect(state.resolve("mark-1", 4)).toMatchObject({ type: "resolved", changed: false });
    expect(state.records[0]).toMatchObject({ lifecycle: "resolved" });
  });

  it("resolves a transient on its declared schedule and clears transient state alone", () => {
    const state = new RegionalInjuryState(body);
    state.create(transient());
    state.create(marking());
    state.create(persistent());

    expect(state.advance(11)).toEqual([]);
    expect(state.advance(12)).toMatchObject([{ type: "resolved", changed: true }]);
    expect(state.records.find((record) => record.id === "transient-1")).toMatchObject({
      lifecycle: "resolved",
      resolvedAt: 12,
    });

    expect(state.clearTransient()).toMatchObject({ type: "reset", ids: ["transient-1"] });
    expect(state.records.map((record) => record.id)).toEqual(["mark-1", "persistent-1"]);
    expect(state.reset(() => true)).toMatchObject({
      type: "reset",
      changed: true,
      ids: ["mark-1", "persistent-1"],
    });
    expect(state.reset(() => true)).toMatchObject({ type: "reset", changed: false, ids: [] });
    expect(state.records).toEqual([]);
  });

  it("serializes saved records only and restores their exact validated form", () => {
    const state = new RegionalInjuryState(body);
    state.create(transient());
    state.create(marking());
    state.create(persistent());

    const snapshot = state.snapshot();
    expect(snapshot.records.map((record) => record.id)).toEqual(["mark-1", "persistent-1"]);
    const serialized = JSON.stringify(snapshot);

    const restored = new RegionalInjuryState(body);
    expect(restored.restore(JSON.parse(serialized) as unknown)).toMatchObject({
      type: "restored",
      ids: ["mark-1", "persistent-1"],
    });
    expect(JSON.stringify(restored.snapshot())).toBe(serialized);
    expect(() =>
      restored.restore({
        ...snapshot,
        records: [{ ...transient(), persistence: "session" }],
      }),
    ).toThrow("saved");
  });

  it("routes active records through an explicit coverage layer without affordance effects", () => {
    const state = new RegionalInjuryState(body);
    state.create(marking());
    state.create(transient());
    state.resolve("transient-1", 12);

    const layers = routeRegionalInjuryLayers(state.records, {
      covers: (anchor) => anchor.vertex === 2,
    });
    expect(layers).toEqual([
      expect.objectContaining({
        record: expect.objectContaining({ id: "mark-1" }),
        layer: "under-cover",
      }),
    ]);
  });
});
