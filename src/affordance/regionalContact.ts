/**
 * A neutral contact sample at one registered body region. This deliberately
 * separates evidence (where, how long and how hard) from the physiology and
 * animation a consumer may choose to apply; docs/REGIONAL-CONTACTS.md.
 */
import type { Vec3 } from "../foundation/landmarks.ts";
import type { FigureAffordances } from "./registry.ts";

/** The lifecycle of one continuous contact, independent of interaction phases. */
export type RegionalContactPhase = "begin" | "sustain" | "end";

/** A contact on intact skin, or an entry through a registered aperture. */
export type RegionalContactTopology = "surface" | "aperture-entry";

/**
 * A spatial contact report. `region` is an affordance id from the figure's own
 * registry; the report carries no response or animation command.
 */
export interface RegionalContact {
  readonly region: string;
  readonly topology: RegionalContactTopology;
  /** Contact point in the caller's declared space. */
  readonly location: Vec3;
  /** Unit direction outward from the contacted figure. */
  readonly normal: Vec3;
  /** Applied force, in newtons. */
  readonly force: number;
  /** Seconds elapsed in this continuous contact. */
  readonly duration: number;
  readonly contactPhase: RegionalContactPhase;
  /** Metres from the named aperture's rim; required only for aperture entry. */
  readonly depth?: number;
}

/** A consumer-owned physiology input made from a validated regional contact. */
export interface RegionalPhysiologyInput {
  readonly kind: "regional-contact";
  readonly contact: RegionalContact;
}

/** A consumer-owned presentation request, intentionally separate from physiology. */
export interface RegionalAnimationIntent {
  readonly region: string;
  readonly intent: string;
  readonly contactPhase: RegionalContactPhase;
}

const finite = (name: string, value: number) => {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
};

function vector(name: string, value: Vec3): void {
  for (const component of value) finite(`${name} component`, component);
}

/**
 * Rejects malformed regional contact evidence and topology mismatches. This is
 * only a validator: it does not infer a response, change affordance state or
 * turn surface contact into an aperture entry.
 */
export function assertRegionalContact(
  contact: RegionalContact,
  own: FigureAffordances,
): asserts contact is RegionalContact {
  if (contact.region.trim() === "")
    throw new RangeError("regional contact region must not be empty");
  vector("regional contact location", contact.location);
  vector("regional contact normal", contact.normal);
  const normalLength = Math.hypot(...contact.normal);
  if (Math.abs(normalLength - 1) > 1e-6)
    throw new RangeError("regional contact normal must be a unit vector");
  finite("regional contact force", contact.force);
  if (contact.force < 0) throw new RangeError("regional contact force must be non-negative");
  finite("regional contact duration", contact.duration);
  if (contact.duration < 0) throw new RangeError("regional contact duration must be non-negative");
  if (!(["begin", "sustain", "end"] as const).includes(contact.contactPhase))
    throw new RangeError(`regional contact phase is invalid: ${String(contact.contactPhase)}`);
  const region = own.find((affordance) => affordance.id === contact.region);
  if (!region) throw new RangeError(`the figure has no contact region ${contact.region}`);
  if (contact.topology === "surface") {
    if (region.kind === "aperture")
      throw new RangeError(`${contact.region} is an aperture: surface contact cannot enter it`);
    if (contact.depth !== undefined)
      throw new RangeError("surface regional contact must not include aperture depth");
    return;
  }
  if (contact.topology !== "aperture-entry")
    throw new RangeError(`regional contact topology is invalid: ${String(contact.topology)}`);
  if (region.kind !== "aperture")
    throw new RangeError(`${contact.region} is not an aperture: it cannot take aperture entry`);
  if (contact.depth === undefined)
    throw new RangeError("aperture-entry regional contact requires depth");
  finite("regional contact depth", contact.depth);
  if (contact.depth < 0) throw new RangeError("regional contact depth must be non-negative");
}
