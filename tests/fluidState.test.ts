import { describe, expect, it } from "vitest";
import {
  assertFluidLedger,
  type FluidSourceRegistration,
  FluidState,
  FluidStateError,
} from "../src/fluid/state.ts";
import { AgePolicyError } from "../src/recipe/agePolicy.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { bodyManifest, loadFixtureAssets } from "./fixtures.ts";

const assets = loadFixtureAssets();
const topology = {
  topology: bodyManifest.topology,
  bodySha256: bodyManifest.body.sha256,
  triangleCount: bodyManifest.faceCount * 2,
};
const options = (figureId = "figure-a", adult = false) => ({
  figureId,
  seed: 42,
  fixedStepSeconds: 1 / 60,
  topology,
  recipe: createRecipe({ macros: { age: adult ? 25 : 17 } }),
  assets: adult ? loadFixtureAssets(true) : assets,
});
const surface = (id = "skin") =>
  ({
    id,
    materialId: "water",
    rateKgPerSecond: 0.001,
    anchor: {
      kind: "surface",
      topology: topology.topology,
      bodySha256: topology.bodySha256,
      triangle: 0,
      barycentric: [1, 0, 0],
    },
  }) satisfies FluidSourceRegistration;

function populatedState(): FluidState {
  const state = new FluidState(options("figure-a"));
  state.registerSource(surface());
  state.injectKg("skin", 1);
  state.detachKg(0.4);
  state.settleAttachedKg("evaporated", 0.2);
  state.settleDetachedKg("deposited", 0.1);
  state.advanceFixedSteps(120);
  return state;
}

describe("FluidState", () => {
  it("conserves mass without treating detached mass as escaped", () => {
    const state = populatedState();
    const ledger = state.snapshot().ledger;
    expect(ledger.injectedTotalKg).toBeCloseTo(1);
    expect(ledger.attachedKg).toBeCloseTo(0.4);
    expect(ledger.detachedKg).toBeCloseTo(0.3);
    expect(ledger.depositedKg).toBeCloseTo(0.1);
    expect(ledger.evaporatedKg).toBeCloseTo(0.2);
    expect(ledger.escapedKg).toBe(0);
  });

  it("round-trips a deterministic fixed-step checkpoint", () => {
    const before = populatedState().snapshot();
    const restored = FluidState.restore(options("figure-a"), structuredClone(before));
    expect(restored.snapshot()).toEqual(before);
    expect(populatedState().snapshot()).toEqual(before);
  });

  it("keeps figures independent even when they use the same source id", () => {
    const a = new FluidState(options("figure-a"));
    const b = new FluidState(options("figure-b"));
    a.registerSource(surface());
    b.registerSource(surface());
    a.injectKg("skin", 0.25);
    expect(a.snapshot().ledger.attachedKg).toBe(0.25);
    expect(b.snapshot().ledger).toEqual({
      injectedTotalKg: 0,
      attachedKg: 0,
      detachedKg: 0,
      depositedKg: 0,
      evaporatedKg: 0,
      absorbedKg: 0,
      escapedKg: 0,
    });
  });

  it("rejects an invalid topology binding, surface anchor, and invalid physical values", () => {
    expect(
      () => new FluidState({ ...options(), topology: { ...topology, bodySha256: "wrong" } }),
    ).toThrow(FluidStateError);
    const state = new FluidState(options());
    expect(() => state.registerSource({ ...surface(), rateKgPerSecond: Number.NaN })).toThrow(
      FluidStateError,
    );
    expect(() =>
      state.registerSource({
        ...surface(),
        anchor: { ...surface().anchor, barycentric: [0.4, 0.4, 0.4] },
      }),
    ).toThrow("sum to 1");
    expect(() =>
      state.registerSource({
        ...surface(),
        anchor: { ...surface().anchor, triangle: topology.triangleCount },
      }),
    ).toThrow("outside this topology");
  });

  it("requires the real loaded adult pack, an adult recipe, and an actual canal reservoir", () => {
    const vaginal = {
      id: "vaginal-source",
      materialId: "water",
      rateKgPerSecond: 0,
      anchor: {
        kind: "adult-aperture",
        topology: topology.topology,
        bodySha256: topology.bodySha256,
        reservoir: "vaginal",
      },
    } satisfies FluidSourceRegistration;
    expect(() => new FluidState(options()).registerSource(vaginal)).toThrow(AgePolicyError);
    const adultWithoutPack = new FluidState({ ...options("adult-missing", true), assets });
    expect(() => adultWithoutPack.registerSource(vaginal)).toThrow(
      "requires the loaded adult anatomy pack",
    );
    const adult = new FluidState(options("adult", true));
    adult.registerSource(vaginal);
    expect(() =>
      adult.registerSource({
        ...vaginal,
        id: "not-a-canal",
        anchor: { ...vaginal.anchor, reservoir: "phallic" },
      }),
    ).toThrow("not an available canal source");
    const loadedAdult = loadFixtureAssets(true);
    if (!loadedAdult.adultAnatomyManifest) throw new Error("fixture must load adult anatomy");
    const wrongAdultBinding = new FluidState({
      ...options("adult-mismatch", true),
      assets: {
        ...loadedAdult,
        adultAnatomyManifest: { ...loadedAdult.adultAnatomyManifest, bodySha256: "wrong" },
      },
    });
    expect(() => wrongAdultBinding.registerSource(vaginal)).toThrow(
      "does not bind to this fluid topology",
    );
  });

  it("rejects malformed checkpoint schemas instead of accepting missing mass", () => {
    const snapshot = populatedState().snapshot();
    const omittedLedger = structuredClone(snapshot) as unknown as {
      ledger: Record<string, unknown>;
    };
    delete omittedLedger.ledger.attachedKg;
    expect(() => FluidState.restore(options("figure-a"), omittedLedger as never)).toThrow(
      "ledger has an invalid schema",
    );
    const extraLedger = structuredClone(snapshot) as unknown as {
      ledger: Record<string, unknown>;
    };
    extraLedger.ledger.untrackedKg = 0;
    expect(() => FluidState.restore(options("figure-a"), extraLedger as never)).toThrow(
      "ledger has an invalid schema",
    );
    expect(() => assertFluidLedger({ ...snapshot.ledger, attachedKg: Number.NaN })).toThrow(
      "finite",
    );
    const extraSource = structuredClone(snapshot) as unknown as {
      sources: Record<string, unknown>[];
    };
    const firstSource = extraSource.sources[0];
    if (!firstSource) throw new Error("checkpoint fixture must include a source");
    firstSource.extra = true;
    expect(() => FluidState.restore(options("figure-a"), extraSource as never)).toThrow(
      "source has an invalid schema",
    );
  });

  it("rejects unknown source and terminal kinds without changing state", () => {
    const state = new FluidState(options());
    state.registerSource(surface());
    state.injectKg("skin", 1);
    const before = state.snapshot();
    const invalidAnchor = {
      ...surface("unknown-anchor"),
      anchor: { ...surface().anchor, kind: "unknown" },
    } as unknown as FluidSourceRegistration;
    expect(() => state.registerSource(invalidAnchor)).toThrow("unknown fluid anchor kind unknown");
    expect(() =>
      (state.settleAttachedKg as (destination: string, kilograms: number) => void)("lost", 0.1),
    ).toThrow("unknown terminal destination lost");
    expect(state.snapshot()).toEqual(before);
  });

  it("does not mutate state after overflow or even sub-epsilon overdraw rejection", () => {
    const state = new FluidState(options());
    state.registerSource(surface());
    state.injectKg("skin", 1);
    const before = state.snapshot();
    expect(() => state.detachKg(1 + 1e-13)).toThrow("cannot transfer more mass");
    expect(state.snapshot()).toEqual(before);
    const overflowing = new FluidState(options("overflow"));
    overflowing.registerSource(surface());
    overflowing.injectKg("skin", Number.MAX_VALUE);
    const beforeOverflow = overflowing.snapshot();
    expect(() => overflowing.injectKg("skin", Number.MAX_VALUE)).toThrow("finite");
    expect(overflowing.snapshot()).toEqual(beforeOverflow);
  });

  it("rejects a checkpoint whose source total or mass ledger leaks", () => {
    const snapshot = populatedState().snapshot();
    expect(() =>
      FluidState.restore(options("figure-a"), { ...snapshot, sourceInjectedKg: { skin: 0.5 } }),
    ).toThrow("source injection total");
    expect(() => assertFluidLedger({ ...snapshot.ledger, escapedKg: 0.1 })).toThrow(
      "not conserved",
    );
  });
});
