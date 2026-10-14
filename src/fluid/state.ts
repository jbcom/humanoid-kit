/**
 * Phase-one fluid state contract. It records validated sources and conserved
 * mass only; it deliberately contains no flow, collision, pose, or rendering.
 */
import type { HumanoidAssets } from "../format/assetFormat.ts";
import { AgePolicyError, assertAgePolicy, isAdult } from "../recipe/agePolicy.ts";
import type { Recipe } from "../recipe/recipe.ts";

const SNAPSHOT_VERSION = 2 as const;
/** Maximum ledger drift, in kilograms, accepted from floating-point addition. */
export const FLUID_MASS_EPSILON_KG = 1e-12;

export class FluidStateError extends Error {
  override name = "FluidStateError";
}

export interface FluidTopologyBinding {
  topology: string;
  bodySha256: string;
  /** Number of triangles in the evaluated surface topology. */
  triangleCount: number;
}

/** A stable rest-space anchor; it is distinct from the injury vertex anchor. */
export interface FluidSurfaceAnchor {
  kind: "surface";
  topology: string;
  bodySha256: string;
  triangle: number;
  barycentric: readonly [number, number, number];
}

/** An actual, canal-bearing reservoir declared by the loaded adult pack. */
export interface FluidAdultApertureAnchor {
  kind: "adult-aperture";
  topology: string;
  bodySha256: string;
  reservoir: string;
}

export type FluidAnchor = FluidSurfaceAnchor | FluidAdultApertureAnchor;

export interface FluidSourceRegistration {
  id: string;
  materialId: string;
  anchor: FluidAnchor;
  /** Registered rate in kilograms per second; phase one does not simulate it. */
  rateKgPerSecond: number;
}

export interface FluidMassLedger {
  /** Cumulative mass explicitly injected into this figure, in kilograms. */
  injectedTotalKg: number;
  /** Cumulative mass received from another figure, never counted as new emission. */
  receivedTotalKg: number;
  /** Cumulative mass transferred to another figure, no longer owned here. */
  transferredTotalKg: number;
  /** Mass currently attached to the figure, in kilograms. */
  attachedKg: number;
  /** Detached but still tracked mass, in kilograms. It is not escaped mass. */
  detachedKg: number;
  /** Terminal deposited mass, in kilograms. */
  depositedKg: number;
  /** Terminal evaporated mass, in kilograms. */
  evaporatedKg: number;
  /** Terminal absorbed mass, in kilograms. */
  absorbedKg: number;
  /** Terminal unrepresented mass, in kilograms. */
  escapedKg: number;
}

export type FluidTerminalDestination = "deposited" | "evaporated" | "absorbed" | "escaped";

export interface FluidStateOptions {
  figureId: string;
  seed: number;
  fixedStepSeconds: number;
  topology: FluidTopologyBinding;
  recipe: Recipe;
  assets: Pick<HumanoidAssets, "manifest" | "adultAnatomyLoaded" | "adultAnatomyManifest">;
}

export interface FluidStateSnapshot {
  version: typeof SNAPSHOT_VERSION;
  figureId: string;
  seed: number;
  fixedStepSeconds: number;
  topology: FluidTopologyBinding;
  fixedSteps: number;
  sources: FluidSourceRegistration[];
  sourceInjectedKg: Record<string, number>;
  ledger: FluidMassLedger;
}

/** Exact phase-one checkpoint schema; restore explicitly migrates these counters to zero. */
export type FluidLegacyStateSnapshot = Omit<FluidStateSnapshot, "version" | "ledger"> & {
  version: 1;
  ledger: Omit<FluidMassLedger, "receivedTotalKg" | "transferredTotalKg">;
};

const LEDGER_KEYS = [
  "injectedTotalKg",
  "receivedTotalKg",
  "transferredTotalKg",
  "attachedKg",
  "detachedKg",
  "depositedKg",
  "evaporatedKg",
  "absorbedKg",
  "escapedKg",
] as const;
const TERMINAL_DESTINATIONS = new Set<FluidTerminalDestination>([
  "deposited",
  "evaporated",
  "absorbed",
  "escaped",
]);

const emptyLedger = (): FluidMassLedger => ({
  injectedTotalKg: 0,
  receivedTotalKg: 0,
  transferredTotalKg: 0,
  attachedKg: 0,
  detachedKg: 0,
  depositedKg: 0,
  evaporatedKg: 0,
  absorbedKg: 0,
  escapedKg: 0,
});

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new FluidStateError(`${label} must be an object`);
}
const assertExactKeys = (value: unknown, keys: readonly string[], label: string): void => {
  assertRecord(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new FluidStateError(`${label} has an invalid schema`);
};
const assertNonEmpty = (value: string, label: string): void => {
  if (typeof value !== "string" || !value.trim())
    throw new FluidStateError(`${label} must not be empty`);
};
const assertFiniteNonNegative = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0)
    throw new FluidStateError(`${label} must be finite and >= 0`);
};
const assertPositive = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0)
    throw new FluidStateError(`${label} must be finite and > 0`);
};
const assertSafeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new FluidStateError(`${label} must be a non-negative safe integer`);
};
const cloneSource = (source: FluidSourceRegistration): FluidSourceRegistration =>
  structuredClone(source);

export function assertFluidLedger(ledger: FluidMassLedger): void {
  assertExactKeys(ledger, LEDGER_KEYS, "ledger");
  for (const key of LEDGER_KEYS) assertFiniteNonNegative(ledger[key], `ledger.${key}`);
  const represented =
    ledger.attachedKg +
    ledger.detachedKg +
    ledger.depositedKg +
    ledger.evaporatedKg +
    ledger.absorbedKg +
    ledger.escapedKg +
    ledger.transferredTotalKg;
  const available = ledger.injectedTotalKg + ledger.receivedTotalKg;
  if (
    !Number.isFinite(represented) ||
    !Number.isFinite(available) ||
    Math.abs(available - represented) > FLUID_MASS_EPSILON_KG
  )
    throw new FluidStateError("fluid mass is not conserved");
}

function assertSnapshotSchema(snapshot: FluidStateSnapshot): void {
  assertExactKeys(
    snapshot,
    [
      "version",
      "figureId",
      "seed",
      "fixedStepSeconds",
      "topology",
      "fixedSteps",
      "sources",
      "sourceInjectedKg",
      "ledger",
    ],
    "snapshot",
  );
  assertNonEmpty(snapshot.figureId, "snapshot.figureId");
  assertSafeInteger(snapshot.seed, "snapshot.seed");
  if (snapshot.seed > 0xffffffff) throw new FluidStateError("snapshot.seed must fit uint32");
  assertPositive(snapshot.fixedStepSeconds, "snapshot.fixedStepSeconds");
  assertExactKeys(
    snapshot.topology,
    ["topology", "bodySha256", "triangleCount"],
    "snapshot.topology",
  );
  assertNonEmpty(snapshot.topology.topology, "snapshot.topology.topology");
  assertNonEmpty(snapshot.topology.bodySha256, "snapshot.topology.bodySha256");
  assertSafeInteger(snapshot.topology.triangleCount, "snapshot.topology.triangleCount");
  if (snapshot.topology.triangleCount === 0)
    throw new FluidStateError("snapshot.topology.triangleCount must be > 0");
  if (!Array.isArray(snapshot.sources))
    throw new FluidStateError("snapshot.sources must be an array");
  assertRecord(snapshot.sourceInjectedKg, "snapshot.sourceInjectedKg");
  assertFluidLedger(snapshot.ledger);
}

export class FluidState {
  readonly figureId: string;
  readonly seed: number;
  readonly fixedStepSeconds: number;
  readonly topology: FluidTopologyBinding;
  private readonly recipe: Recipe;
  private readonly assets: FluidStateOptions["assets"];
  private readonly sources = new Map<string, FluidSourceRegistration>();
  private readonly sourceInjectedKg = new Map<string, number>();
  private ledger: FluidMassLedger = emptyLedger();
  private fixedSteps = 0;

  constructor(options: FluidStateOptions) {
    assertNonEmpty(options.figureId, "figureId");
    assertSafeInteger(options.seed, "seed");
    if (options.seed > 0xffffffff) throw new FluidStateError("seed must fit uint32");
    assertPositive(options.fixedStepSeconds, "fixedStepSeconds");
    assertAgePolicy(options.recipe);
    this.assertTopology(options.topology, options.assets);
    this.figureId = options.figureId;
    this.seed = options.seed;
    this.fixedStepSeconds = options.fixedStepSeconds;
    this.topology = structuredClone(options.topology);
    this.recipe = structuredClone(options.recipe);
    this.assets = options.assets;
  }

  registerSource(source: FluidSourceRegistration): void {
    this.assertSource(source);
    if (this.sources.has(source.id))
      throw new FluidStateError(`fluid source ${source.id} is already registered`);
    this.sources.set(source.id, cloneSource(source));
    this.sourceInjectedKg.set(source.id, 0);
  }

  injectKg(sourceId: string, kilograms: number): void {
    assertPositive(kilograms, "kilograms");
    if (!this.sources.has(sourceId)) throw new FluidStateError(`unknown fluid source ${sourceId}`);
    const nextLedger = structuredClone(this.ledger);
    nextLedger.injectedTotalKg += kilograms;
    nextLedger.attachedKg += kilograms;
    const injected = (this.sourceInjectedKg.get(sourceId) ?? 0) + kilograms;
    assertFiniteNonNegative(injected, `source ${sourceId} injected mass`);
    assertFluidLedger(nextLedger);
    this.ledger = nextLedger;
    this.sourceInjectedKg.set(sourceId, injected);
  }

  detachKg(kilograms: number): void {
    this.transfer("attachedKg", "detachedKg", kilograms);
  }

  settleAttachedKg(destination: FluidTerminalDestination, kilograms: number): void {
    this.transfer("attachedKg", this.destinationKey(destination), kilograms);
  }

  settleDetachedKg(destination: FluidTerminalDestination, kilograms: number): void {
    this.transfer("detachedKg", this.destinationKey(destination), kilograms);
  }

  /** Stages both ledgers before a synchronous, callback-free paired commit. */
  transferAttachedToDepositedKg(receiver: FluidState, kilograms: number): void {
    if (receiver === this || receiver.figureId === this.figureId)
      throw new FluidStateError("fluid transfer requires two distinct figure states");
    assertPositive(kilograms, "kilograms");
    assertFluidLedger(this.ledger);
    assertFluidLedger(receiver.ledger);
    if (kilograms > this.ledger.attachedKg)
      throw new FluidStateError("cannot transfer more mass than attachedKg contains");
    const donorLedger = structuredClone(this.ledger);
    const receiverLedger = structuredClone(receiver.ledger);
    donorLedger.attachedKg -= kilograms;
    donorLedger.transferredTotalKg += kilograms;
    receiverLedger.receivedTotalKg += kilograms;
    receiverLedger.depositedKg += kilograms;
    assertFluidLedger(donorLedger);
    assertFluidLedger(receiverLedger);
    this.ledger = donorLedger;
    receiver.ledger = receiverLedger;
  }

  advanceFixedSteps(steps: number): void {
    assertSafeInteger(steps, "steps");
    if (this.fixedSteps + steps > Number.MAX_SAFE_INTEGER)
      throw new FluidStateError("fixed step count exceeds safe integer range");
    this.fixedSteps += steps;
  }

  snapshot(): FluidStateSnapshot {
    assertFluidLedger(this.ledger);
    return {
      version: SNAPSHOT_VERSION,
      figureId: this.figureId,
      seed: this.seed,
      fixedStepSeconds: this.fixedStepSeconds,
      topology: structuredClone(this.topology),
      fixedSteps: this.fixedSteps,
      sources: [...this.sources.values()].map(cloneSource),
      sourceInjectedKg: Object.fromEntries(this.sourceInjectedKg),
      ledger: structuredClone(this.ledger),
    };
  }

  static restore(
    options: FluidStateOptions,
    input: FluidStateSnapshot | FluidLegacyStateSnapshot,
  ): FluidState {
    let snapshot: FluidStateSnapshot;
    if (input.version === 1) {
      assertExactKeys(
        input.ledger,
        LEDGER_KEYS.filter((key) => key !== "receivedTotalKg" && key !== "transferredTotalKg"),
        "legacy ledger",
      );
      snapshot = {
        ...structuredClone(input),
        version: SNAPSHOT_VERSION,
        ledger: { ...structuredClone(input.ledger), receivedTotalKg: 0, transferredTotalKg: 0 },
      };
    } else {
      snapshot = input;
    }
    assertSnapshotSchema(snapshot);
    if (snapshot.version !== SNAPSHOT_VERSION)
      throw new FluidStateError("unsupported fluid snapshot version");
    const state = new FluidState(options);
    if (
      snapshot.figureId !== state.figureId ||
      snapshot.seed !== state.seed ||
      snapshot.fixedStepSeconds !== state.fixedStepSeconds ||
      snapshot.topology.topology !== state.topology.topology ||
      snapshot.topology.bodySha256 !== state.topology.bodySha256 ||
      snapshot.topology.triangleCount !== state.topology.triangleCount
    )
      throw new FluidStateError("fluid snapshot does not match this figure contract");
    assertSafeInteger(snapshot.fixedSteps, "snapshot.fixedSteps");
    for (const source of snapshot.sources) state.registerSource(source);
    const sourceIds = new Set(state.sources.keys());
    for (const id of Object.keys(snapshot.sourceInjectedKg))
      if (!sourceIds.has(id)) throw new FluidStateError(`snapshot names unregistered source ${id}`);
    let injected = 0;
    for (const id of sourceIds) {
      const mass = snapshot.sourceInjectedKg[id];
      if (mass === undefined) throw new FluidStateError(`snapshot omits source ${id}`);
      assertFiniteNonNegative(mass, `snapshot.sourceInjectedKg.${id}`);
      state.sourceInjectedKg.set(id, mass);
      injected += mass;
    }
    if (Math.abs(injected - snapshot.ledger.injectedTotalKg) > FLUID_MASS_EPSILON_KG)
      throw new FluidStateError("source injection total does not match ledger");
    assertFluidLedger(snapshot.ledger);
    state.ledger = structuredClone(snapshot.ledger);
    state.fixedSteps = snapshot.fixedSteps;
    return state;
  }

  private transfer(
    from: "attachedKg" | "detachedKg",
    to: "depositedKg" | "evaporatedKg" | "absorbedKg" | "escapedKg" | "detachedKg",
    kilograms: number,
  ): void {
    assertPositive(kilograms, "kilograms");
    if (kilograms > this.ledger[from])
      throw new FluidStateError(`cannot transfer more mass than ${from} contains`);
    const nextLedger = structuredClone(this.ledger);
    nextLedger[from] -= kilograms;
    nextLedger[to] += kilograms;
    assertFluidLedger(nextLedger);
    this.ledger = nextLedger;
  }

  private destinationKey(
    destination: FluidTerminalDestination,
  ): "depositedKg" | "evaporatedKg" | "absorbedKg" | "escapedKg" {
    if (!TERMINAL_DESTINATIONS.has(destination))
      throw new FluidStateError(`unknown terminal destination ${String(destination)}`);
    return `${destination}Kg` as "depositedKg" | "evaporatedKg" | "absorbedKg" | "escapedKg";
  }

  private assertTopology(
    topology: FluidTopologyBinding,
    assets: FluidStateOptions["assets"],
  ): void {
    assertExactKeys(topology, ["topology", "bodySha256", "triangleCount"], "topology");
    assertNonEmpty(topology.topology, "topology.topology");
    assertNonEmpty(topology.bodySha256, "topology.bodySha256");
    assertSafeInteger(topology.triangleCount, "topology.triangleCount");
    if (topology.triangleCount === 0)
      throw new FluidStateError("topology.triangleCount must be > 0");
    if (
      topology.topology !== assets.manifest.topology ||
      topology.bodySha256 !== assets.manifest.body.sha256
    )
      throw new FluidStateError("fluid topology binding does not match loaded body assets");
  }

  private assertSource(source: FluidSourceRegistration): void {
    assertExactKeys(source, ["id", "materialId", "anchor", "rateKgPerSecond"], "source");
    assertRecord(source.anchor, "source.anchor");
    assertNonEmpty(source.id, "source.id");
    assertNonEmpty(source.materialId, "source.materialId");
    assertFiniteNonNegative(source.rateKgPerSecond, "source.rateKgPerSecond");
    const anchor = source.anchor as FluidAnchor & Record<string, unknown>;
    const anchorKind: unknown = anchor.kind;
    if (anchorKind === "surface") {
      const surfaceAnchor = anchor as FluidSurfaceAnchor;
      assertExactKeys(
        surfaceAnchor,
        ["kind", "topology", "bodySha256", "triangle", "barycentric"],
        "source.anchor",
      );
      if (
        surfaceAnchor.topology !== this.topology.topology ||
        surfaceAnchor.bodySha256 !== this.topology.bodySha256
      )
        throw new FluidStateError("fluid source anchor does not match this figure topology");
      assertSafeInteger(surfaceAnchor.triangle, "source.anchor.triangle");
      if (surfaceAnchor.triangle >= this.topology.triangleCount)
        throw new FluidStateError("source.anchor.triangle is outside this topology");
      const barycentric = surfaceAnchor.barycentric;
      if (
        !Array.isArray(barycentric) ||
        barycentric.length !== 3 ||
        barycentric.some((weight) => !Number.isFinite(weight) || weight < 0)
      )
        throw new FluidStateError(
          "source anchor barycentric weights must be three finite non-negative values",
        );
      if (Math.abs(barycentric[0] + barycentric[1] + barycentric[2] - 1) > 1e-9)
        throw new FluidStateError("source anchor barycentric weights must sum to 1");
      return;
    }
    if (anchorKind !== "adult-aperture")
      throw new FluidStateError(`unknown fluid anchor kind ${String(anchorKind)}`);
    assertExactKeys(anchor, ["kind", "topology", "bodySha256", "reservoir"], "source.anchor");
    if (
      anchor.topology !== this.topology.topology ||
      anchor.bodySha256 !== this.topology.bodySha256
    )
      throw new FluidStateError("fluid source anchor does not match this figure topology");
    this.assertAdultAperture(anchor as FluidAdultApertureAnchor);
  }

  private assertAdultAperture(anchor: FluidAdultApertureAnchor): void {
    assertNonEmpty(anchor.reservoir, "source.anchor.reservoir");
    if (!isAdult(this.recipe))
      throw new AgePolicyError("adult aperture fluid sources require a recipe aged 18 or over");
    const adult = this.assets.adultAnatomyLoaded ? this.assets.adultAnatomyManifest : null;
    if (!adult)
      throw new FluidStateError("adult aperture source requires the loaded adult anatomy pack");
    if (adult.topology !== this.topology.topology || adult.bodySha256 !== this.topology.bodySha256)
      throw new FluidStateError("loaded adult anatomy pack does not bind to this fluid topology");
    const reservoir = adult.anatomy?.reservoirs?.find((entry) => entry.id === anchor.reservoir);
    if (!reservoir?.canal)
      throw new FluidStateError(
        `adult reservoir ${anchor.reservoir} is not an available canal source`,
      );
  }
}
