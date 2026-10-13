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
import type {
  FigureMeasures,
  FigurePresence,
  ObjectPresence,
  PresenceRegistry,
  Vec3,
} from "../presence/presence.ts";
import { AgePolicyError } from "../recipe/agePolicy.ts";
import { gripMeeting } from "./contacts.ts";
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
  type RoleSpec,
  resolveLength,
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

/** Where a figure should stand and which way to face, in world space. */
export interface SlotPlacement {
  /** The slot's point in world space: the reference's, moved by the offset. */
  position: Vec3;
  /** Unit vector on the ground. */
  facing: Vec3;
}

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
  /**
   * Where `role`'s figure should stand and face: its slot against the
   * reference, in world space, written into `out` (pass one to allocate
   * nothing). Moving the figure there is the application's; the approach phase
   * ends when it is within the slot's tolerance. A `between` reference is
   * pinned when approach begins (the midpoint and line of the two figures then),
   * so the targets hold still while they walk; before that it follows them.
   * Null for a role with no slot, or while the reference cannot be found.
   */
  slot(role: RoleName, out?: SlotPlacement): SlotPlacement | null;
  /**
   * Where `role`'s side of a contact must be, in world space, written into `out`
   * (pass one to allocate nothing): the contact by its `name` or its index in the
   * definition. The two roles of a hand-to-hand contact get the one point where
   * their grips meet (`gripMeeting`), refitted each call to the figures' current
   * positions and measures. Null outside the contact's `during` phases, for a
   * role that is not one of its two, for a contact that is not hand to hand
   * (the other pairings arrive with their slices) and for a figure that has left.
   */
  contactTarget(contact: string | number, role: RoleName, out?: Vec3): Vec3 | null;
  /**
   * Seconds into `role`'s clip for the current phase, on the interaction's one
   * clock: `time` scaled by the track's rate, wrapped at the clip's length when
   * it loops and held at its end when it does not. Roles on one clip and rate
   * agree exactly. Null when the role plays nothing in this phase.
   */
  trackTime(role: RoleName): number | null;
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

/** What a beat's affordance change is applied to: a figure's `HumanoidAffordances`. */
export interface AffordanceTarget {
  set(id: string, change: AffordanceChange): unknown;
}

/**
 * An `applyChange` that sets the change on each participant's live affordances
 * (`HumanoidAffordances`), so a bite fills the mouth and opens the drawn jaw.
 * A participant with no entry is skipped.
 */
export const applyToAffordances =
  (figures: ReadonlyMap<string, AffordanceTarget>) =>
  (participant: string, affordance: string, change: AffordanceChange): void => {
    figures.get(participant)?.set(affordance, change);
  };

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

/** The midpoint of two figures and the unit line from the first toward the second, on the ground. */
interface Pin {
  x: number;
  y: number;
  z: number;
  ux: number;
  uz: number;
}

/** A contact's two roles, split once at proposal so asking for its target splits nothing. */
interface ContactInfo {
  name: string | undefined;
  a: RoleName;
  b: RoleName;
  during: readonly Phase[];
  /** Both ends are figure hands: the one pairing slice 2 solves. */
  handToHand: boolean;
}

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
  /** The `between` reference as it was when approach began. */
  pin: Pin | null;
  contactInfo: readonly ContactInfo[];
  /** The exact published figures and objects bound when the session was proposed. */
  participants: Readonly<Record<RoleName, FigurePresence | ObjectPresence>>;
  /** A role's measures, for resolving the definition's lengths; made once per interaction. */
  measuresOf: (role: RoleName) => FigureMeasures | undefined;
}

/**
 * The reference frame a slot is measured in, held between calls so resolving a
 * slot allocates nothing: an origin, and the unit heading on the ground (x to
 * the frame's left is `(fz, -fx)`).
 */
const refFrame = { x: 0, y: 0, z: 0, fx: 0, fz: 1 };
const livePin: Pin = { x: 0, y: 0, z: 0, ux: 0, uz: 1 };
const slotScratch: SlotPlacement = { position: [0, 0, 0], facing: [0, 0, 1] };

function setFrame(x: number, y: number, z: number, fx: number, fz: number) {
  const len = Math.hypot(fx, fz);
  refFrame.x = x;
  refFrame.y = y;
  refFrame.z = z;
  // A heading with no ground component (a frame lying flat) falls back to +z.
  refFrame.fx = len > 1e-9 ? fx / len : 0;
  refFrame.fz = len > 1e-9 ? fz / len : 1;
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

  const object = (id: string): ObjectPresence | undefined => presence.getObject(id);

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

  const remove = (i: Running) => {
    const index = live.indexOf(i);
    if (index >= 0) live.splice(index, 1);
  };

  const end = (i: Running, reason?: CancelReason) => {
    if (i.phase === "ended") return;
    release(i);
    i.phase = "ended";
    i.time = 0;
    remove(i);
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

  /**
   * The midpoint of a `between` reference's two figures and the line from the
   * first toward the second, into `out`; false when either has left. Two
   * figures on one spot have no line, so the first one's heading stands in.
   */
  const betweenInto = (i: Running, out: Pin): boolean => {
    const ref = i.definition.reference;
    if (!ref || !("between" in ref)) return false;
    const a = presence.get(i.roles[ref.between[0]] as string);
    const b = presence.get(i.roles[ref.between[1]] as string);
    if (!a || !b) return false;
    out.x = (a.position[0] + b.position[0]) / 2;
    out.y = (a.position[1] + b.position[1]) / 2;
    out.z = (a.position[2] + b.position[2]) / 2;
    const dx = b.position[0] - a.position[0];
    const dz = b.position[2] - a.position[2];
    const len = Math.hypot(dx, dz);
    out.ux = len > 1e-9 ? dx / len : a.facing[0];
    out.uz = len > 1e-9 ? dz / len : a.facing[2];
    return true;
  };

  /** Fills `refFrame` with the frame `role`'s slot is measured in; false when it cannot be found. */
  const frameFor = (i: Running, role: RoleName): boolean => {
    const ref = i.definition.reference;
    if (!ref) return false;
    if ("frameOf" in ref) {
      const f = object(i.roles[ref.frameOf] as string)?.frames[ref.frame];
      if (!f) return false;
      // The frame's own +z, turned by its quaternion, on the ground.
      const [qx, qy, qz, qw] = f.rotation;
      setFrame(
        f.position[0],
        f.position[1],
        f.position[2],
        2 * (qx * qz + qw * qy),
        1 - 2 * (qx * qx + qy * qy),
      );
      return true;
    }
    if ("anchorOf" in ref) {
      const p = presence.get(i.roles[ref.anchorOf] as string);
      if (!p) return false;
      const a = p.anchors[ref.anchor];
      setFrame(a[0], a[1], a[2], p.facing[0], p.facing[2]);
      return true;
    }
    const pin = i.pin ?? (betweenInto(i, livePin) ? livePin : null);
    if (!pin) return false;
    // Each figure faces the other: the second looks back along the line.
    const sign = role === ref.between[1] ? -1 : 1;
    setFrame(pin.x, pin.y, pin.z, pin.ux * sign, pin.uz * sign);
    return true;
  };

  /** `role`'s slot in world space into `out`, or null (no slot, or the reference is missing). */
  const slotInto = (i: Running, r: RoleSpec, out: SlotPlacement): SlotPlacement | null => {
    const s = r.slot;
    if (!s || !frameFor(i, r.name)) return null;
    const x = resolveLength(s.offset[0], i.measuresOf);
    const y = resolveLength(s.offset[1], i.measuresOf);
    const z = resolveLength(s.offset[2], i.measuresOf);
    if (x === undefined || y === undefined || z === undefined) return null;
    const { fx, fz } = refFrame;
    // The frame's left is (fz, -fx): x to the left, z along the heading.
    out.position[0] = refFrame.x + fz * x + fx * z;
    out.position[1] = refFrame.y + y;
    out.position[2] = refFrame.z - fx * x + fz * z;
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    out.facing[0] = fx * cos + fz * sin;
    out.facing[1] = 0;
    out.facing[2] = fz * cos - fx * sin;
    return out;
  };

  /** Slotted figures are placed: within tolerance of their slot around the reference. */
  const placed = (i: Running) => {
    if (!i.definition.reference) return true;
    for (const r of i.definition.roles) {
      if (!r.slot) continue;
      const at = presence.get(i.roles[r.name] as string)?.position;
      const target = at && slotInto(i, r, slotScratch);
      if (!at || !target || groundDistance(at, target.position) > r.slot.tolerance) return false;
    }
    return true;
  };

  const roleSpec = (i: Running, role: RoleName) => i.definition.roles.find((r) => r.name === role);

  const sameParticipants = (i: Running) =>
    i.definition.roles.every((r) => {
      const id = i.roles[r.name] as string;
      return r.takes === "figure"
        ? presence.get(id) === i.participants[r.name]
        : object(id) === i.participants[r.name];
    });

  const contactTarget = (i: Running, contact: string | number, role: RoleName, out: Vec3) => {
    let c: ContactInfo | undefined;
    if (typeof contact === "number") c = i.contactInfo[contact];
    else for (const k of i.contactInfo) if (k.name === contact) c = k;
    if (!c?.handToHand || (role !== c.a && role !== c.b)) return null;
    if (!c.during.includes(i.phase as Phase)) return null;
    const a = presence.get(i.roles[c.a] as string);
    const b = presence.get(i.roles[c.b] as string);
    return a && b ? gripMeeting(a, b, out) : null;
  };

  const trackTime = (i: Running, role: RoleName): number | null => {
    if (i.phase === "proposed" || i.phase === "ended") return null;
    const track = roleSpec(i, role)?.track?.[i.phase];
    if (!track) return null;
    const seconds = i.time * (track.rate ?? 1);
    const length = options.clipLength(track.clip);
    if (!(length > 0)) return seconds;
    return track.loop ? seconds % length : Math.min(seconds, length);
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
    if (!sameParticipants(i)) return end(i, "left");
    const refusal = ageRefusal(i.definition, i.audience, i.roles as Record<string, string>);
    if (refusal) return end(i, "age-policy");
    if (i.phase === "proposed") {
      if (i.pending > 0) return;
      if (i.refused) return end(i, "declined");
      if (!claim(i)) return end(i, "preempted");
      emit(i, { type: "accepted" });
      const slotted = i.definition.roles.some((r) => r.slot);
      if (slotted && betweenInto(i, livePin)) i.pin = { ...livePin };
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
  const detachChannel = presence.attach(channel);
  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    for (const i of [...live]) end(i, "cancelled");
    detachChannel();
    listeners.clear();
    policies.clear();
    offers.length = 0;
  };

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
      if (detached) throw new InteractionDefinitionError("interaction runtime is detached");
      const d = definitions.get(definition);
      if (!d) throw new InteractionDefinitionError(`no definition ${definition}`);
      const { def, audience } = d;
      const participants: Record<RoleName, FigurePresence | ObjectPresence> = {};
      for (const r of def.roles) {
        const id = roles[r.name];
        if (!id) throw new InteractionDefinitionError(`${def.id}: role ${r.name} is unbound`);
        if (r.takes === "figure") {
          const figure = presence.get(id);
          if (!figure)
            throw new InteractionDefinitionError(
              `${def.id}: role ${r.name} takes a figure; ${id} is not one`,
            );
          participants[r.name] = figure;
        }
        if (r.takes === "object") {
          const o = object(id);
          if (!o)
            throw new InteractionDefinitionError(
              `${def.id}: role ${r.name} takes an object; ${id} is not one`,
            );
          participants[r.name] = o;
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
        pin: null,
        contactInfo: (def.contacts ?? []).map((c) => {
          const [a, an] = splitPoint(c.a);
          const [b, bn] = splitPoint(c.b);
          const isHand = (role: RoleName, name: string) =>
            def.roles.find((r) => r.name === role)?.takes === "figure" &&
            (name === "hand.L" || name === "hand.R");
          return {
            name: c.name,
            a,
            b,
            during: c.during,
            handToHand: a !== b && isHand(a, an) && isHand(b, bn),
          };
        }),
        participants,
        measuresOf: (role) => presence.get(i.roles[role] as string)?.measures,
        slot: (role, out = { position: [0, 0, 0], facing: [0, 0, 1] }) => {
          const r = roleSpec(i, role);
          return r ? slotInto(i, r, out) : null;
        },
        contactTarget: (contact, role, out = [0, 0, 0]) => contactTarget(i, contact, role, out),
        trackTime: (role) => trackTime(i, role),
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
