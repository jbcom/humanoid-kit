/**
 * An affordance's state (docs/ARCHITECTURE.md, "Affordances: the registry"):
 * plain values a developer sets and the kit reports, one shape per kind, and
 * checked on the way in so no body is asked for what none can do. State lives
 * with a figure (`AffordanceStates`), not in the registry, so two figures with
 * one registry have their own.
 */
import type { Affordance, AffordanceKind } from "./registry.ts";

/** What is inside an aperture: how deep it reaches and how wide it is there, metres. */
export interface Occupancy {
  depth: number;
  radius: number;
}

export type AffordanceState =
  | {
      kind: "aperture";
      /** How open the rim is, 0 (closed) to 1 (as wide as it opens). */
      opening: number;
      /** What is inside it, or null. */
      occupancy: Occupancy | null;
      /** How much of what is inside has been consumed (dissolved past the rim), 0 to 1. */
      consumed: number;
    }
  | {
      kind: "grip";
      /** How closed the grip is, 0 (open) to 1 (closed on what it holds, or a fist). */
      closure: number;
      /** What it holds (the developer's name for it), or null. */
      holding: string | null;
    }
  | {
      kind: "mount";
      /** What is attached (the developer's name for it), or null. */
      attached: string | null;
      /** The attached thing's mass, kilograms: a heavy earring pulls the lobe. */
      load: number;
    }
  | {
      kind: "contact";
      /** How hard it presses on what it rests on, newtons. */
      pressure: number;
    };

type StateOf<K extends AffordanceKind> = Extract<AffordanceState, { kind: K }>;
/** A change to an affordance's state: any of its kind's values. */
export type AffordanceChange = Partial<Omit<AffordanceState, "kind">> &
  Partial<Omit<StateOf<"aperture">, "kind">> &
  Partial<Omit<StateOf<"grip">, "kind">> &
  Partial<Omit<StateOf<"mount">, "kind">> &
  Partial<Omit<StateOf<"contact">, "kind">>;

/** An affordance of this kind at rest: closed and empty, open-handed, bare, unpressed. */
export function restState<K extends AffordanceKind>(kind: K): StateOf<K> {
  const rest: { [Kind in AffordanceKind]: StateOf<Kind> } = {
    aperture: { kind: "aperture", opening: 0, occupancy: null, consumed: 0 },
    grip: { kind: "grip", closure: 0, holding: null },
    mount: { kind: "mount", attached: null, load: 0 },
    contact: { kind: "contact", pressure: 0 },
  };
  return { ...rest[kind] } as StateOf<K>;
}

const unit = (name: string, x: number) => {
  if (!(x >= 0 && x <= 1)) throw new RangeError(`${name} must be 0 to 1, not ${x}`);
};
const nonNegative = (name: string, x: number) => {
  if (!(x >= 0 && Number.isFinite(x)))
    throw new RangeError(`${name} must be a finite number of at least 0, not ${x}`);
};

/** The values each kind takes: a change naming any other is refused. */
const FIELDS: { readonly [K in AffordanceKind]: readonly string[] } = {
  aperture: ["opening", "occupancy", "consumed"],
  grip: ["closure", "holding"],
  mount: ["attached", "load"],
  contact: ["pressure"],
};

/** `state` with `change` merged in, checked; throws `RangeError` for a value its kind cannot take. */
export function changeState(
  id: string,
  state: AffordanceState,
  change: AffordanceChange,
): AffordanceState {
  for (const key of Object.keys(change))
    if (!FIELDS[state.kind].includes(key))
      throw new RangeError(`${id} is a ${state.kind}: it has no ${key}`);
  const next = { ...state, ...change } as AffordanceState;
  switch (next.kind) {
    case "aperture":
      unit(`${id} opening`, next.opening);
      unit(`${id} consumed`, next.consumed);
      if (next.occupancy) {
        nonNegative(`${id} occupancy depth`, next.occupancy.depth);
        nonNegative(`${id} occupancy radius`, next.occupancy.radius);
      }
      break;
    case "grip":
      unit(`${id} closure`, next.closure);
      break;
    case "mount":
      nonNegative(`${id} load`, next.load);
      break;
    case "contact":
      nonNegative(`${id} pressure`, next.pressure);
      break;
  }
  return next;
}

/** One figure's affordance states, each at rest until set. */
export class AffordanceStates {
  private readonly kinds: ReadonlyMap<string, AffordanceKind>;
  private readonly states = new Map<string, AffordanceState>();

  constructor(registry: readonly Affordance[]) {
    this.kinds = new Map(registry.map((a) => [a.id, a.kind]));
  }

  /** The affordance's state; throws `RangeError` for one the figure does not have. */
  get(id: string): AffordanceState {
    const kind = this.kinds.get(id);
    if (!kind) throw new RangeError(`the figure has no affordance ${id}`);
    return this.states.get(id) ?? restState(kind);
  }

  /** Merges `change` into the affordance's state, checked (`changeState`). */
  set(id: string, change: AffordanceChange): AffordanceState {
    const next = changeState(id, this.get(id), change);
    this.states.set(id, next);
    return next;
  }
}
