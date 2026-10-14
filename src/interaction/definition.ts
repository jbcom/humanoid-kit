/**
 * Interaction definitions: plain data saying who takes part, what each needs,
 * where each stands, what each plays and when the beats fall
 * (docs/INTERACTIONS.md). This module validates definitions and decides their
 * audience; `runtime.ts` runs them.
 */
import { CORE_AFFORDANCES } from "../affordance/registry.ts";
import type { AffordanceChange } from "../affordance/state.ts";
import { type AnchorName, type FigureMeasures, MEASURE_NAMES } from "../presence/presence.ts";
import { ADULT_ONLY_SIGNALS } from "../recipe/agePolicy.ts";

/** A dotted, lower-case tag: "food.fruit.apple". */
export type Tag = string;
export type RoleName = string;

/**
 * A length in metres, or in a participant's own measurements: `{ of: "initiator",
 * measure: "reach", times: 0.7 }` is 0.7 of the initiator's reach, so one
 * definition fits a 1.5 m and a 1.9 m figure.
 */
export type Length =
  | number
  | { readonly of: RoleName; readonly measure: keyof FigureMeasures; readonly times: number };

/**
 * A length in metres, or undefined when it names a participant that has no
 * measures. `measuresOf` answers for a role (a figure role's published presence).
 */
export function resolveLength(
  length: Length,
  measuresOf: (role: RoleName) => FigureMeasures | undefined,
): number | undefined {
  if (typeof length === "number") return length;
  const m = measuresOf(length.of);
  return m ? m[length.measure] * length.times : undefined;
}
export type BodyPart =
  | "locomotion"
  | "pelvis"
  | "torso"
  | "head"
  | "gaze"
  | "mouth"
  | "arm.L"
  | "arm.R"
  | "hand.L"
  | "hand.R";
export type Phase = "approach" | "align" | "act" | "release";
export type Audience = "all" | "adult";

/** `role:name`: an affordance of a figure role, or a frame of an object role. */
export type RolePoint = `${RoleName}:${string}`;

export interface RoleSpec {
  readonly name: RoleName;
  readonly takes: "figure" | "object";
  /** Tags an object participant must carry. */
  readonly requires?: readonly Tag[];
  /** Affordance ids a figure participant must have: "mouth", "hand.R". */
  readonly affordances?: readonly string[];
  /** Body parts the role claims (figures). */
  readonly uses?: readonly BodyPart[];
  /**
   * Where this figure stands against the reference. `offset` is in the
   * reference's frame (x to its left, y up, z along its facing; the facing of a
   * fixture's frame, of an anchor's figure, or, for `between`, from each figure
   * toward the other), each part a `Length`. `yaw` (radians, positive toward
   * the left) turns the figure from that facing. `tolerance` is the ground
   * distance (metres) within which the figure counts as placed.
   */
  readonly slot?: {
    readonly offset: readonly [Length, Length, Length];
    readonly yaw: number;
    readonly tolerance: number;
  };
  /** Per phase, the clip this role plays. */
  readonly track?: Partial<
    Record<Phase, { readonly clip: string; readonly loop?: boolean; readonly rate?: number }>
  >;
}

/** Where slots are measured from. */
export type Reference =
  | { readonly frameOf: RoleName; readonly frame: string }
  | { readonly anchorOf: RoleName; readonly anchor: AnchorName }
  | { readonly between: readonly [RoleName, RoleName] };

export interface Contact {
  /** A name to ask for the contact by (`contactTarget`); otherwise its index. */
  readonly name?: string;
  readonly a: RolePoint;
  readonly b: RolePoint;
  readonly during: readonly Phase[];
}

export interface Coupling {
  readonly aperture: RolePoint;
  readonly insertable: RolePoint;
}

export type ObjectStateValue = number | string | boolean;

/** A figure's skin-state signals a beat drives, each set outright or added to: `{ blush: { add: 0.2 } }`. */
export type SignalChange = Readonly<Record<string, number | { readonly add: number }>>;

export type Effect =
  | { readonly set: RolePoint; readonly change: AffordanceChange }
  | {
      readonly object: RoleName;
      readonly state: Readonly<Record<string, ObjectStateValue | { readonly add: number }>>;
    }
  /**
   * A figure role's signals (blush, exertion; for an adult, arousal), handed to
   * the host's `applySignals`, which passes them to the figure's evaluation. One
   * that drives an adult-only signal (`ADULT_ONLY_SIGNALS`) makes the definition
   * adult (`audienceOf`).
   */
  | { readonly signal: RoleName; readonly change: SignalChange };

export interface Beat {
  readonly name: string;
  /** Seconds into one pass of the act, or a fraction of its clip. */
  readonly at: number | { readonly fraction: number };
  readonly effects?: readonly Effect[];
}

/** A numeric object state that must stay below a bound; checked before each pass of the act. */
export interface Precondition {
  readonly object: RoleName;
  readonly state: string;
  readonly below: number;
}

export interface InteractionDefinition {
  readonly id: string;
  readonly tags: readonly Tag[];
  /** Required; a missing or unknown value is treated as "adult". */
  readonly audience: Audience;
  readonly roles: readonly RoleSpec[];
  readonly reference?: Reference;
  readonly contacts?: readonly Contact[];
  readonly couplings?: readonly Coupling[];
  readonly beats?: readonly Beat[];
  /** The act repeats while this holds, and ends (released) when it stops holding. */
  readonly repeatWhile?: Precondition;
  /** Seconds the align phase blends a figure onto its slot. Default 0.3. */
  readonly alignSeconds?: number;
  /** Seconds the release phase blends out. Default 0.3. */
  readonly releaseSeconds?: number;
  readonly priority?: number;
}

/** True when `tag` is `required` or below it: "food" matches "food.fruit.apple". */
export const tagMatches = (required: Tag, tag: Tag): boolean =>
  tag === required || tag.startsWith(`${required}.`);

export class InteractionDefinitionError extends Error {
  override name = "InteractionDefinitionError";
}

/** The core's affordances, which say they are not adult; any other id may be. */
const CORE_NOT_ADULT = new Set(CORE_AFFORDANCES.filter((a) => !a.adult).map((a) => a.id));

/**
 * Whether a figure affordance id is the adult anatomy's. The core's own are not;
 * an id the core does not know is treated as adult, so a pack's affordance
 * that is not declared to the runtime fails closed.
 */
export const defaultAffordanceAdult = (id: string): boolean => !CORE_NOT_ADULT.has(id);

/**
 * A definition's audience: "adult" unless it declares "all" AND none of the
 * figure affordances its contacts, couplings, beat effects or roles name is
 * adult AND no beat drives an adult-only signal (age-policy points 1 and 2 in
 * docs/INTERACTIONS.md). The line is content, not body site: a nipple is a core
 * all-ages site (nursing, a child's own chest), arousal is not. `affordanceAdult`
 * can only add adult ids to `defaultAffordanceAdult`; it cannot clear one.
 */
export function audienceOf(
  def: InteractionDefinition,
  affordanceAdult: (id: string) => boolean = defaultAffordanceAdult,
): Audience {
  if (def.audience !== "all") return "adult";
  // The host's answer is joined with the default, never in place of it: a predicate
  // that says "not adult" for an id the core does not know cannot clear it.
  const adult = (id: string) => defaultAffordanceAdult(id) || affordanceAdult(id) === true;
  const figureRoles = new Set(def.roles.filter((r) => r.takes === "figure").map((r) => r.name));
  const roles = new Set(def.roles.map((r) => r.name));
  const points: RolePoint[] = [
    ...(def.contacts ?? []).flatMap((c) => [c.a, c.b]),
    ...(def.couplings ?? []).flatMap((c) => [c.aperture, c.insertable]),
    ...(def.beats ?? []).flatMap((b) =>
      (b.effects ?? []).flatMap((e) => ("set" in e ? [e.set] : [])),
    ),
  ];
  for (const p of points) {
    // A point that is not `role:name`, or names no role, cannot be shown not to be adult.
    if (!p.includes(":")) return "adult";
    const [role, name] = splitPoint(p);
    if (!roles.has(role)) return "adult";
    if (figureRoles.has(role) && adult(name)) return "adult";
  }
  for (const r of def.roles) for (const a of r.affordances ?? []) if (adult(a)) return "adult";
  for (const b of def.beats ?? [])
    for (const e of b.effects ?? [])
      if ("signal" in e && Object.keys(e.change).some((s) => ADULT_ONLY_SIGNALS.includes(s)))
        return "adult";
  return "all";
}

export const splitPoint = (p: RolePoint): [RoleName, string] => {
  const i = p.indexOf(":");
  return [p.slice(0, i), p.slice(i + 1)];
};

/** Every reason a definition is malformed; empty when it is valid. */
export function definitionProblems(def: InteractionDefinition): string[] {
  const out: string[] = [];
  if (!def.id) out.push("id is empty");
  if (def.roles.length === 0) out.push("no roles");
  const names = new Set<string>();
  for (const r of def.roles) {
    if (names.has(r.name)) out.push(`role ${r.name} is declared twice`);
    names.add(r.name);
    if (r.takes === "object" && (r.uses?.length || r.affordances?.length || r.slot))
      out.push(`object role ${r.name} cannot claim body parts, affordances or a slot`);
  }
  for (const r of def.roles)
    for (const l of r.slot?.offset ?? []) {
      if (typeof l === "number") {
        if (!Number.isFinite(l)) out.push(`role ${r.name} has a slot offset that is not finite`);
        continue;
      }
      const of = def.roles.find((o) => o.name === l.of);
      if (of?.takes !== "figure")
        out.push(`role ${r.name} measures ${l.of}, which is not a figure role`);
      if (!MEASURE_NAMES.includes(l.measure))
        out.push(`role ${r.name} measures ${l.measure}, which is not a measure`);
      if (!Number.isFinite(l.times)) out.push(`role ${r.name} has a measure that is not finite`);
    }
  for (const r of def.roles) {
    if (r.slot && !Number.isFinite(r.slot.yaw))
      out.push(`role ${r.name} has a slot yaw that is not finite`);
    if (r.slot && !(r.slot.tolerance >= 0 && Number.isFinite(r.slot.tolerance)))
      out.push(`role ${r.name} has a slot tolerance that is not a non-negative finite number`);
    for (const [phase, track] of Object.entries(r.track ?? {})) {
      if (!track?.clip) out.push(`role ${r.name} has a track for ${phase} with no clip`);
      if (track?.rate !== undefined && !(track.rate > 0 && Number.isFinite(track.rate)))
        out.push(
          `role ${r.name} has a track for ${phase} with a rate that is not a positive finite number`,
        );
    }
  }
  const contactNames = new Set<string>();
  for (const c of def.contacts ?? []) {
    if (c.name === undefined) continue;
    if (contactNames.has(c.name)) out.push(`contact ${c.name} is declared twice`);
    contactNames.add(c.name);
  }
  const role = (n: RoleName) => def.roles.find((r) => r.name === n);
  const point = (p: RolePoint, what: string) => {
    if (!p.includes(":")) out.push(`${what} ${p} is not role:name`);
    else if (!role(splitPoint(p)[0])) out.push(`${what} ${p} names no role`);
  };
  for (const c of def.contacts ?? []) {
    point(c.a, "contact");
    point(c.b, "contact");
  }
  for (const c of def.couplings ?? []) {
    point(c.aperture, "coupling");
    point(c.insertable, "coupling");
  }
  const ref = def.reference;
  if (ref) {
    const refRoles =
      "between" in ref ? [...ref.between] : "frameOf" in ref ? [ref.frameOf] : [ref.anchorOf];
    for (const n of refRoles) if (!role(n)) out.push(`reference names no role ${n}`);
    if ("frameOf" in ref && role(ref.frameOf)?.takes !== "object")
      out.push(`reference frameOf ${ref.frameOf} must be an object role`);
    if ("anchorOf" in ref && role(ref.anchorOf)?.takes !== "figure")
      out.push(`reference anchorOf ${ref.anchorOf} must be a figure role`);
    if ("between" in ref && ref.between.some((n) => role(n)?.takes !== "figure"))
      out.push("reference between must name two figure roles");
  }
  if (def.roles.some((r) => r.slot) && !ref)
    out.push("a role has a slot but there is no reference");
  if (!def.roles.some((r) => r.track?.act)) out.push("no role plays an act clip");
  for (const b of def.beats ?? [])
    for (const e of b.effects ?? []) {
      if ("set" in e) point(e.set, `beat ${b.name} effect`);
      else if ("signal" in e) {
        if (role(e.signal)?.takes !== "figure")
          out.push(`beat ${b.name} drives the signals of ${e.signal}, which is not a figure role`);
        for (const [s, v] of Object.entries(e.change))
          if (!Number.isFinite(typeof v === "number" ? v : v?.add))
            out.push(`beat ${b.name} drives signal ${s} by a value that is not finite`);
      } else if (role(e.object)?.takes !== "object")
        out.push(`beat ${b.name} changes ${e.object}, which is not an object role`);
    }
  if (def.repeatWhile && role(def.repeatWhile.object)?.takes !== "object")
    out.push(`repeatWhile names ${def.repeatWhile.object}, which is not an object role`);
  return out;
}
