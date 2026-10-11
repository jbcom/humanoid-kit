/**
 * The interaction runtime: a channel of the presence registry that runs
 * interaction definitions (docs/INTERACTIONS.md). It binds participants to
 * roles, asks for consent, claims body parts all-or-nothing, and advances each
 * interaction through approach, align, act and release on the presence clock,
 * firing beats and applying their effects. Nothing reads the wall clock, so
 * the same seed and ticks give the same frames. The age policy is checked
 * before anyone is asked, and again on every tick.
 */
import type { AffordanceChange } from "../affordance/state.ts";
import type { ObjectPresence, PresenceRegistry, Vec3 } from "../presence/presence.ts";
import { AgePolicyError } from "../recipe/agePolicy.ts";
import {
  type Audience,
  audienceOf,
  type Beat,
  type BodyPart,
  defaultAffordanceAdult,
  definitionProblems,
  type InteractionDefinition,
  InteractionDefinitionError,
  type Phase,
  type RoleName,
  splitPoint,
  type Tag,
  tagMatches,
} from "./definition.ts";

export type CancelReason =
  | "declined"
  | "cancelled"
  | "left"
  | "preempted"
  | "precondition"
  | "age-policy";

export type InteractionPhase = "proposed" | Phase | "ended";

export interface Interaction {
  readonly id: string;
  readonly definition: InteractionDefinition;
  readonly audience: Audience;
  /** Role → participant id. */
  readonly roles: Readonly<Record<RoleName, string>>;
  readonly phase: InteractionPhase;
  /** Seconds into the current phase, on the presence clock. */
  readonly time: number;
  /** Passes of the act completed. */
  readonly passes: number;
  readonly seed: number;
  cancel(reason?: CancelReason): void;
}

export interface InteractionEvent {
  type: "accepted" | "declined" | "phase" | "beat" | "ended" | "cancelled";
  interaction: Interaction;
  /** The participant receiving the event, and its role. */
  participant: string;
  role: RoleName;
  phase?: Phase;
  beat?: string;
  reason?: CancelReason;
}

export interface Offer {
  id: string;
  /** The participant offering. */
  by: string;
  definition: string;
  /** The role the offerer takes. */
  role: RoleName;
  tags: readonly Tag[];
  /** Free slots (a sofa offers three seats). */
  slots: number;
  /** An appeal the application may weigh. */
  score?: number;
}

export type AcceptPolicy = (i: Interaction) => boolean | Promise<boolean>;

export interface InteractionOptions {
  /** Mixed into every interaction's seed. */
  seed: number;
  /** Seconds a clip lasts at rate 1: the animation library's answer. */
  clipLength: (clip: string) => number;
  /** Whether a figure affordance id is the adult anatomy's; unknown ids should answer true. */
  affordanceAdult?: (id: string) => boolean;
  /** Applies a beat's affordance change to a participant (its `AffordanceStates`). */
  applyChange?: (participant: string, affordance: string, change: AffordanceChange) => void;
}

export interface InteractionRuntime {
  define(definitions: readonly InteractionDefinition[]): void;
  offer(offer: Offer): () => void;
  /** Offers a participant could take, filtered by tags and by the age policy. */
  offersFor(participant: string, tags?: readonly Tag[]): readonly Offer[];
  /** Binds roles and returns the proposed interaction; throws on a policy or binding failure. */
  propose(definition: string, roles: Record<RoleName, string>): Interaction;
  /** Sets a participant's consent policy. Without one, `all` is accepted and `adult` declined. */
  policy(participant: string, accept: AcceptPolicy): () => void;
  on(participant: string, listener: (e: InteractionEvent) => void): () => void;
  /** Interactions not yet ended. */
  running(): readonly Interaction[];
  detach(): void;
}

/** 32-bit FNV-1a, mixed with the runtime seed: a stable per-interaction seed. */
function seedOf(seed: number, parts: readonly (string | number)[]): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (const p of parts)
    for (const ch of `${p}|`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  return h;
}

const DEFAULT_BLEND = 0.3;
const groundDistance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

interface Running extends Interaction {
  phase: InteractionPhase;
  time: number;
  passes: number;
  /** Beats already fired in this pass. */
  fired: number;
  /** Consent answers still awaited, and those given. */
  pending: number;
  refused: boolean;
  claims: { participant: string; part: BodyPart }[];
}

export function createInteractions(
  presence: PresenceRegistry,
  options: InteractionOptions,
): InteractionRuntime {
  const affordanceAdult = options.affordanceAdult ?? defaultAffordanceAdult;
  const definitions = new Map<string, { def: InteractionDefinition; audience: Audience }>();
  const offers: Offer[] = [];
  const policies = new Map<string, AcceptPolicy>();
  const listeners = new Map<string, Set<(e: InteractionEvent) => void>>();
  const live: Running[] = [];
  /** participant → body part → interaction holding it. */
  const claimed = new Map<string, Map<BodyPart, Running>>();
  let started = 0;
  let clock = 0;

  const isFigure = (id: string) => presence.get(id) !== undefined;
  const object = (id: string): ObjectPresence | undefined => presence.getObject(id);
  const exists = (id: string) => isFigure(id) || object(id) !== undefined;

  const emit = (i: Running, e: Omit<InteractionEvent, "interaction" | "participant" | "role">) => {
    for (const [role, participant] of Object.entries(i.roles))
      for (const l of listeners.get(participant) ?? [])
        l({ ...e, interaction: i, participant, role });
  };

  /** An adult interaction with any figure participant who is not an adult (points 4 and 5). */
  const ageRefusal = (
    def: InteractionDefinition,
    audience: Audience,
    roles: Record<string, string>,
  ) => {
    if (audience !== "adult") return null;
    for (const r of def.roles) {
      if (r.takes !== "figure") continue;
      const id = roles[r.name] as string;
      if (presence.get(id)?.adult !== true)
        return `${def.id} is adult-only and ${id} (role ${r.name}) is not an adult`;
    }
    return null;
  };

  const release = (i: Running) => {
    for (const { participant, part } of i.claims) claimed.get(participant)?.delete(part);
    i.claims.length = 0;
  };

  const end = (i: Running, reason?: CancelReason) => {
    if (i.phase === "ended") return;
    release(i);
    i.phase = "ended";
    i.time = 0;
    emit(
      i,
      reason
        ? { type: reason === "declined" ? "declined" : "cancelled", reason }
        : { type: "ended" },
    );
  };

  const enter = (i: Running, phase: Phase) => {
    i.phase = phase;
    i.time = 0;
    i.fired = 0;
    emit(i, { type: "phase", phase });
  };

  const actLength = (def: InteractionDefinition) =>
    Math.max(
      ...def.roles.map((r) => {
        const t = r.track?.act;
        return t ? options.clipLength(t.clip) / (t.rate ?? 1) : 0;
      }),
    );

  const beatTime = (b: Beat, length: number) =>
    typeof b.at === "number" ? b.at : b.at.fraction * length;

  const applyBeat = (i: Running, b: Beat) => {
    emit(i, { type: "beat", beat: b.name });
    for (const e of b.effects ?? []) {
      if ("set" in e) {
        const [role, affordance] = splitPoint(e.set);
        options.applyChange?.(i.roles[role] as string, affordance, e.change);
      } else {
        const o = object(i.roles[e.object] as string);
        if (!o) continue;
        for (const [k, val] of Object.entries(e.state)) {
          const cur = o.state[k];
          o.state[k] =
            typeof val === "object" ? (typeof cur === "number" ? cur : 0) + val.add : val;
        }
      }
    }
  };

  /** True while the definition's repeat condition holds (or it has none: one pass). */
  const repeats = (i: Running) => {
    const p = i.definition.repeatWhile;
    if (!p) return false;
    const v = object(i.roles[p.object] as string)?.state[p.state];
    return typeof v === "number" && v < p.below;
  };

  /** Slotted figures are placed: within tolerance of their slot around the reference. */
  const placed = (i: Running) => {
    const ref = i.definition.reference;
    if (!ref) return true;
    let origin: Vec3 | undefined;
    if ("frameOf" in ref)
      origin = object(i.roles[ref.frameOf] as string)?.frames[ref.frame]?.position;
    else if ("anchorOf" in ref)
      origin = presence.get(i.roles[ref.anchorOf] as string)?.anchors[ref.anchor];
    else {
      const a = presence.get(i.roles[ref.between[0]] as string)?.position;
      const b = presence.get(i.roles[ref.between[1]] as string)?.position;
      if (a && b) origin = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    }
    if (!origin) return false;
    for (const r of i.definition.roles) {
      if (!r.slot) continue;
      const at = presence.get(i.roles[r.name] as string)?.position;
      if (!at) return false;
      const target: Vec3 = [
        origin[0] + r.slot.offset[0],
        origin[1] + r.slot.offset[1],
        origin[2] + r.slot.offset[2],
      ];
      if (groundDistance(at, target) > r.slot.tolerance) return false;
    }
    return true;
  };

  /** Claims every role's body parts, all or none. */
  const claim = (i: Running): boolean => {
    const wanted: { participant: string; part: BodyPart }[] = [];
    for (const r of i.definition.roles)
      for (const part of r.uses ?? [])
        wanted.push({ participant: i.roles[r.name] as string, part });
    if (wanted.some(({ participant, part }) => claimed.get(participant)?.has(part))) return false;
    for (const w of wanted) {
      let parts = claimed.get(w.participant);
      if (!parts) {
        parts = new Map();
        claimed.set(w.participant, parts);
      }
      parts.set(w.part, i);
    }
    i.claims.push(...wanted);
    return true;
  };

  const step = (i: Running, dt: number) => {
    if (i.phase === "ended") return;
    for (const id of Object.values(i.roles)) if (!exists(id)) return end(i, "left");
    const refusal = ageRefusal(i.definition, i.audience, i.roles as Record<string, string>);
    if (refusal) return end(i, "age-policy");
    if (i.phase === "proposed") {
      if (i.pending > 0) return;
      if (i.refused) return end(i, "declined");
      if (!claim(i)) return end(i, "preempted");
      emit(i, { type: "accepted" });
      const slotted = i.definition.roles.some((r) => r.slot);
      enter(i, slotted ? "approach" : "act");
      return;
    }
    i.time += dt;
    switch (i.phase) {
      case "approach":
        if (placed(i)) enter(i, "align");
        return;
      case "align":
        if (i.time >= (i.definition.alignSeconds ?? DEFAULT_BLEND)) enter(i, "act");
        return;
      case "act": {
        const length = actLength(i.definition);
        const beats = i.definition.beats ?? [];
        while (i.fired < beats.length && beatTime(beats[i.fired] as Beat, length) <= i.time) {
          applyBeat(i, beats[i.fired] as Beat);
          i.fired++;
        }
        if (i.time >= length) {
          i.passes++;
          if (repeats(i)) {
            i.time -= length;
            i.fired = 0;
          } else enter(i, "release");
        }
        return;
      }
      case "release":
        if (i.time >= (i.definition.releaseSeconds ?? DEFAULT_BLEND)) end(i);
        return;
    }
  };

  const channel = {
    tick(seconds: number) {
      const dt = Math.max(0, seconds - clock);
      clock = seconds;
      // A fixed order (priority, then id) so simultaneous claims resolve the same way every run.
      const order = [...live].sort(
        (a, b) =>
          (b.definition.priority ?? 0) - (a.definition.priority ?? 0) || (a.id < b.id ? -1 : 1),
      );
      for (const i of order) step(i, dt);
      for (let k = live.length - 1; k >= 0; k--) if (live[k]?.phase === "ended") live.splice(k, 1);
    },
  };
  const detach = presence.attach(channel);

  return {
    define(defs) {
      for (const def of defs) {
        const problems = definitionProblems(def);
        if (problems.length)
          throw new InteractionDefinitionError(`${def.id}: ${problems.join("; ")}`);
        definitions.set(def.id, { def, audience: audienceOf(def, affordanceAdult) });
      }
    },
    offer(o) {
      offers.push(o);
      return () => {
        const k = offers.indexOf(o);
        if (k >= 0) offers.splice(k, 1);
      };
    },
    offersFor(participant, tags) {
      const adult = presence.get(participant)?.adult === true;
      return offers.filter((o) => {
        const d = definitions.get(o.definition);
        if (!d || (d.audience === "adult" && !adult)) return false;
        return !tags || tags.some((t) => o.tags.some((ot) => tagMatches(t, ot)));
      });
    },
    propose(definition, roles) {
      const d = definitions.get(definition);
      if (!d) throw new InteractionDefinitionError(`no definition ${definition}`);
      const { def, audience } = d;
      for (const r of def.roles) {
        const id = roles[r.name];
        if (!id) throw new InteractionDefinitionError(`${def.id}: role ${r.name} is unbound`);
        if (r.takes === "figure" && !isFigure(id))
          throw new InteractionDefinitionError(
            `${def.id}: role ${r.name} takes a figure; ${id} is not one`,
          );
        if (r.takes === "object") {
          const o = object(id);
          if (!o)
            throw new InteractionDefinitionError(
              `${def.id}: role ${r.name} takes an object; ${id} is not one`,
            );
          for (const t of r.requires ?? [])
            if (!o.tags.some((ot) => tagMatches(t, ot)))
              throw new InteractionDefinitionError(
                `${def.id}: ${id} lacks tag ${t} for role ${r.name}`,
              );
        }
      }
      const refusal = ageRefusal(def, audience, roles);
      if (refusal) throw new AgePolicyError(refusal);
      const id = `${def.id}#${started++}`;
      const i: Running = {
        id,
        definition: def,
        audience,
        roles: { ...roles },
        phase: "proposed",
        time: 0,
        passes: 0,
        seed: seedOf(options.seed, [def.id, ...Object.values(roles).sort(), clock]),
        fired: 0,
        pending: 0,
        refused: false,
        claims: [],
        cancel: (reason = "cancelled") => end(i, reason),
      };
      live.push(i);
      for (const r of def.roles) {
        if (r.takes !== "figure") continue;
        const participant = roles[r.name] as string;
        const accept = policies.get(participant);
        if (!accept) {
          // Consent is explicit for adult interactions; never assumed.
          if (audience === "adult") i.refused = true;
          continue;
        }
        const answer = accept(i);
        if (typeof answer === "boolean") {
          if (!answer) i.refused = true;
        } else {
          i.pending++;
          answer.then(
            (yes) => {
              i.pending--;
              if (!yes) i.refused = true;
            },
            () => {
              i.pending--;
              i.refused = true;
            },
          );
        }
      }
      return i;
    },
    policy(participant, accept) {
      policies.set(participant, accept);
      return () => {
        if (policies.get(participant) === accept) policies.delete(participant);
      };
    },
    on(participant, listener) {
      let set = listeners.get(participant);
      if (!set) {
        set = new Set();
        listeners.set(participant, set);
      }
      set.add(listener);
      return () => set.delete(listener);
    },
    running: () => live,
    detach,
  };
}
