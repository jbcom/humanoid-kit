/**
 * Neutral, framework-free regional injury records. They describe state and a
 * topology-compatible body-space anchor; they do not infer an injury from
 * contact or alter collision or affordances.
 */
import type { HumanoidAssets } from "../format/assetFormat.ts";

export const REGIONAL_INJURY_SCHEMA_VERSION = 1;

export interface RegionalInjuryBody {
  topology: string;
  bodySha256: string;
  vertexCount: number;
}

export interface RegionalInjuryAnchor {
  topology: string;
  bodySha256: string;
  vertex: number;
}

export type RegionalInjuryClass =
  | "surface-marking"
  | "transient-deformation"
  | "persistent-body-change";
export type RegionalInjuryPersistence = "session" | "saved";
export type RegionalInjuryLifecycle = "active" | "resolved";

interface RegionalInjuryBase {
  schemaVersion: typeof REGIONAL_INJURY_SCHEMA_VERSION;
  id: string;
  class: RegionalInjuryClass;
  anchor: RegionalInjuryAnchor;
  persistence: RegionalInjuryPersistence;
  lifecycle: RegionalInjuryLifecycle;
  /** Consumer-authored start and latest-update times in the consumer's own clock. */
  createdAt: number;
  updatedAt: number;
  /** Present exactly when the consumer has resolved this record. */
  resolvedAt?: number;
  /**
   * Consumer-owned category label. It classifies local source semantics only;
   * it is not anatomy, severity, a kit event type or a gameplay outcome.
   */
  sourceCategory: string;
  /** Consumer-owned non-empty label with no kit-defined thresholds or ordering. */
  severityBand: string;
}

/** An anchored visible mark on intact skin. */
export interface SurfaceMarkingInjury extends RegionalInjuryBase {
  class: "surface-marking";
}

/**
 * An anchored displacement with an explicit consumer-owned lifetime. The
 * lifetime selects resolution timing only; it does not prescribe a response
 * curve or tissue law.
 */
export interface TransientDeformationInjury extends RegionalInjuryBase {
  class: "transient-deformation";
  persistence: "session";
  duration: number;
}

/** A versioned body-space record that a consumer may elect to save. */
export interface PersistentBodyChangeInjury extends RegionalInjuryBase {
  class: "persistent-body-change";
}

export type RegionalInjury =
  | SurfaceMarkingInjury
  | TransientDeformationInjury
  | PersistentBodyChangeInjury;

export interface RegionalInjurySnapshot {
  schemaVersion: typeof REGIONAL_INJURY_SCHEMA_VERSION;
  /** Saved records only, in deterministic creation order. */
  records: readonly RegionalInjury[];
}

export type RegionalInjuryEvent =
  | { type: "created"; changed: true; record: RegionalInjury }
  | { type: "updated"; changed: true; record: RegionalInjury }
  | { type: "resolved"; changed: boolean; record: RegionalInjury }
  | { type: "restored"; changed: boolean; ids: readonly string[] }
  | { type: "reset"; changed: boolean; ids: readonly string[] };

export type RegionalInjuryLayer = "body" | "under-cover";

export interface RegionalInjuryCoverage {
  /** The caller owns coverage computation from its bound garment or wrapping. */
  covers(anchor: RegionalInjuryAnchor): boolean;
}

export interface RegionalInjuryLayerRoute {
  record: RegionalInjury;
  /**
   * Under-cover records stay in the output for a covering renderer to
   * composite; coverage never silently discards persistent state.
   */
  layer: RegionalInjuryLayer;
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RangeError(`${label} must be an object`);
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], label: string) => {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new RangeError(`${label} does not accept ${key}`);
};

const nonEmptyString = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.length === 0)
    throw new RangeError(`${label} must be a non-empty string`);
};

const finite = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new RangeError(`${label} must be a finite number`);
};

const integer = (value: unknown, label: string) => {
  if (!Number.isInteger(value)) throw new RangeError(`${label} must be an integer`);
};

const sha256 = (value: unknown, label: string) => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/iu.test(value))
    throw new RangeError(`${label} must be a SHA-256 hex digest`);
};

function cloneAnchor(anchor: RegionalInjuryAnchor): RegionalInjuryAnchor {
  return { ...anchor };
}

function cloneRecord(record: RegionalInjury): RegionalInjury {
  return { ...record, anchor: cloneAnchor(record.anchor) } as RegionalInjury;
}

/** Validates a body compatibility context supplied by the loaded body pack. */
export function assertRegionalInjuryBody(body: RegionalInjuryBody): void {
  nonEmptyString(body.topology, "body topology");
  sha256(body.bodySha256, "body SHA-256");
  integer(body.vertexCount, "body vertexCount");
  if (body.vertexCount < 1) throw new RangeError("body vertexCount must be positive");
}

/** The compatibility context of loaded assets. */
export function regionalInjuryBody(assets: Pick<HumanoidAssets, "manifest">): RegionalInjuryBody {
  const body = {
    topology: assets.manifest.topology,
    bodySha256: assets.manifest.body.sha256,
    vertexCount: assets.manifest.vertexCount,
  };
  assertRegionalInjuryBody(body);
  return body;
}

/**
 * Validates an anchor and returns its base-mesh vertex. It never retargets a
 * record to a similar topology or a world-space position.
 */
export function resolveRegionalInjuryAnchor(
  body: RegionalInjuryBody,
  anchor: RegionalInjuryAnchor,
): number {
  assertRegionalInjuryBody(body);
  const value = object(anchor, "injury anchor");
  exactKeys(value, ["topology", "bodySha256", "vertex"], "injury anchor");
  nonEmptyString(value.topology, "injury anchor topology");
  sha256(value.bodySha256, "injury anchor SHA-256");
  integer(value.vertex, "injury anchor vertex");
  if (value.topology !== body.topology)
    throw new RangeError("injury anchor topology is incompatible");
  if (value.bodySha256 !== body.bodySha256)
    throw new RangeError("injury anchor body SHA-256 is incompatible");
  if ((value.vertex as number) < 0 || (value.vertex as number) >= body.vertexCount)
    throw new RangeError("injury anchor vertex is not on the compatible base mesh");
  return value.vertex as number;
}

const COMMON_KEYS = [
  "schemaVersion",
  "id",
  "class",
  "anchor",
  "persistence",
  "lifecycle",
  "createdAt",
  "updatedAt",
  "resolvedAt",
  "sourceCategory",
  "severityBand",
] as const;

/** Validates a neutral regional record against one loaded body compatibility context. */
export function assertRegionalInjury(
  injury: unknown,
  body: RegionalInjuryBody,
): asserts injury is RegionalInjury {
  assertRegionalInjuryBody(body);
  const value = object(injury, "regional injury");
  const kind = value.class;
  if (
    kind !== "surface-marking" &&
    kind !== "transient-deformation" &&
    kind !== "persistent-body-change"
  )
    throw new RangeError("regional injury class is unsupported");
  exactKeys(
    value,
    kind === "transient-deformation" ? [...COMMON_KEYS, "createdAt", "duration"] : COMMON_KEYS,
    `regional injury ${kind}`,
  );
  if (value.schemaVersion !== REGIONAL_INJURY_SCHEMA_VERSION)
    throw new RangeError("regional injury schemaVersion is unsupported");
  nonEmptyString(value.id, "regional injury id");
  finite(value.createdAt, "regional injury createdAt");
  finite(value.updatedAt, "regional injury updatedAt");
  if (value.lifecycle === "resolved") finite(value.resolvedAt, "regional injury resolvedAt");
  if (value.lifecycle === "active" && value.resolvedAt !== undefined)
    throw new RangeError("active regional injury does not accept resolvedAt");
  nonEmptyString(value.sourceCategory, "regional injury sourceCategory");
  nonEmptyString(value.severityBand, "regional injury severityBand");
  if (!(value.severityBand as string).trim())
    throw new RangeError("regional injury severityBand must not be blank");
  if (value.persistence !== "session" && value.persistence !== "saved")
    throw new RangeError("regional injury persistence must be session or saved");
  if (value.lifecycle !== "active" && value.lifecycle !== "resolved")
    throw new RangeError("regional injury lifecycle must be active or resolved");
  resolveRegionalInjuryAnchor(body, value.anchor as RegionalInjuryAnchor);
  if (kind === "transient-deformation") {
    if (value.persistence !== "session")
      throw new RangeError("transient deformation persistence must be session");
    finite(value.duration, "transient deformation duration");
    if ((value.duration as number) <= 0)
      throw new RangeError("transient deformation duration must be positive");
  }
}

/** Validates a persistence payload; session records are intentionally rejected. */
export function assertRegionalInjurySnapshot(
  snapshot: unknown,
  body: RegionalInjuryBody,
): asserts snapshot is RegionalInjurySnapshot {
  const value = object(snapshot, "regional injury snapshot");
  exactKeys(value, ["schemaVersion", "records"], "regional injury snapshot");
  if (value.schemaVersion !== REGIONAL_INJURY_SCHEMA_VERSION)
    throw new RangeError("regional injury snapshot schemaVersion is unsupported");
  if (!Array.isArray(value.records))
    throw new RangeError("regional injury snapshot records must be an array");
  const ids = new Set<string>();
  for (const record of value.records) {
    assertRegionalInjury(record, body);
    if (record.persistence !== "saved")
      throw new RangeError("regional injury snapshot contains a record that is not saved");
    if (ids.has(record.id))
      throw new RangeError(`regional injury snapshot has duplicate id ${record.id}`);
    ids.add(record.id);
  }
}

/**
 * One figure's injury records. Calls return events so creation, update,
 * resolution, restore and reset are observable without a framework callback.
 */
export class RegionalInjuryState {
  private readonly body: RegionalInjuryBody;
  private readonly values = new Map<string, RegionalInjury>();

  constructor(body: RegionalInjuryBody) {
    assertRegionalInjuryBody(body);
    this.body = { ...body };
  }

  /** A detached copy in deterministic creation order. */
  get records(): readonly RegionalInjury[] {
    return [...this.values.values()].map(cloneRecord);
  }

  create(injury: RegionalInjury): RegionalInjuryEvent {
    assertRegionalInjury(injury, this.body);
    if (injury.lifecycle !== "active")
      throw new RangeError("created regional injury must be active");
    if (this.values.has(injury.id))
      throw new RangeError(`regional injury has duplicate id ${injury.id}`);
    const record = cloneRecord(injury);
    this.values.set(record.id, record);
    return { type: "created", changed: true, record: cloneRecord(record) };
  }

  /**
   * Replaces presentation data for an existing record. Its class and current
   * lifecycle remain fixed; resolving is the explicit lifecycle operation.
   */
  update(injury: RegionalInjury): RegionalInjuryEvent {
    assertRegionalInjury(injury, this.body);
    const prior = this.values.get(injury.id);
    if (!prior) throw new RangeError(`regional injury ${injury.id} does not exist`);
    if (prior.class !== injury.class)
      throw new RangeError(`regional injury ${injury.id} cannot change class`);
    if (prior.lifecycle !== injury.lifecycle)
      throw new RangeError(`regional injury ${injury.id} must resolve through resolve()`);
    const record = cloneRecord(injury);
    this.values.set(record.id, record);
    return { type: "updated", changed: true, record: cloneRecord(record) };
  }

  /**
   * Resolves a record once at a consumer-authored time. Repetition observes the
   * same result without another transition or clock interpretation.
   */
  resolve(id: string, resolvedAt: number): RegionalInjuryEvent {
    finite(resolvedAt, "regional injury resolvedAt");
    const prior = this.values.get(id);
    if (!prior) throw new RangeError(`regional injury ${id} does not exist`);
    if (prior.lifecycle === "resolved")
      return { type: "resolved", changed: false, record: cloneRecord(prior) };
    const record = {
      ...prior,
      lifecycle: "resolved",
      updatedAt: resolvedAt,
      resolvedAt,
    } as RegionalInjury;
    this.values.set(id, record);
    return { type: "resolved", changed: true, record: cloneRecord(record) };
  }

  /** Resolves active transient records whose declared lifetime has elapsed. */
  advance(now: number): readonly RegionalInjuryEvent[] {
    finite(now, "regional injury time");
    const events: RegionalInjuryEvent[] = [];
    for (const record of this.values.values()) {
      if (
        record.class === "transient-deformation" &&
        record.lifecycle === "active" &&
        now >= record.createdAt + record.duration
      )
        events.push(this.resolve(record.id, now));
    }
    return events;
  }

  /**
   * Removes transient deformation records and leaves surface markings and
   * persistent body-space records untouched.
   */
  clearTransient(): RegionalInjuryEvent {
    return this.reset((record) => record.class === "transient-deformation");
  }

  /** Removes exactly the records an explicit consumer reset policy selects. */
  reset(select: (record: Readonly<RegionalInjury>) => boolean): RegionalInjuryEvent {
    const ids: string[] = [];
    for (const record of this.values.values()) if (select(cloneRecord(record))) ids.push(record.id);
    for (const id of ids) this.values.delete(id);
    return { type: "reset", changed: ids.length > 0, ids };
  }

  /** Serializes only records whose consumer explicitly marked them saved. */
  snapshot(): RegionalInjurySnapshot {
    return {
      schemaVersion: REGIONAL_INJURY_SCHEMA_VERSION,
      records: this.records.filter((record) => record.persistence === "saved"),
    };
  }

  /**
   * Replaces state with validated saved records. Session records never enter a
   * snapshot and therefore do not survive restoration. Every restore reports a
   * successful replacement even when its records match.
   */
  restore(snapshot: unknown): RegionalInjuryEvent {
    assertRegionalInjurySnapshot(snapshot, this.body);
    this.values.clear();
    for (const record of snapshot.records) this.values.set(record.id, cloneRecord(record));
    return {
      type: "restored",
      changed: true,
      ids: snapshot.records.map((record) => record.id),
    };
  }
}

/**
 * Routes active records to a body or explicit under-cover layer. This is data
 * only: callers render, mask and bind their own garments.
 */
export function routeRegionalInjuryLayers(
  records: readonly RegionalInjury[],
  coverage: RegionalInjuryCoverage,
): readonly RegionalInjuryLayerRoute[] {
  return records
    .filter((record) => record.lifecycle === "active")
    .map((record) => {
      const covered = coverage.covers(cloneAnchor(record.anchor));
      if (typeof covered !== "boolean")
        throw new RangeError("injury coverage must return a boolean");
      return { record: cloneRecord(record), layer: covered ? "under-cover" : "body" };
    });
}
