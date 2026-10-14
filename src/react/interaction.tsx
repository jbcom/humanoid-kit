/**
 * React bindings for the framework-free interaction runtime (docs/INTERACTIONS.md).
 *
 * The application creates an InteractionRuntime for its PresenceRegistry and
 * passes that existing runtime here. This layer only registers scene objects,
 * offers and event listeners; the presence registry remains the one clock that
 * advances sessions. Continuous interaction state is read through live refs so
 * it never turns a running interaction into React renders.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from "react";
import type {
  Interaction,
  InteractionEvent,
  InteractionRuntime,
  Offer,
} from "../interaction/runtime.ts";
import type { ObjectPresence, PresenceRegistry } from "../presence/presence.ts";
import { usePresenceRegistry } from "./presence.tsx";

const InteractionsContext = createContext<InteractionRuntime | null>(null);
const EMPTY_OFFERS: readonly Offer[] = [];

interface ObjectRegistration {
  token: object;
  object: ObjectPresence;
}

/** React-owned registrations only: never overwrite an existing registry object. */
const registrations = new WeakMap<PresenceRegistry, Map<string, ObjectRegistration>>();

const registrationsFor = (registry: PresenceRegistry) => {
  let entries = registrations.get(registry);
  if (!entries) {
    entries = new Map();
    registrations.set(registry, entries);
  }
  return entries;
};

function releaseObject(
  registry: PresenceRegistry,
  id: string,
  token: object,
  object: ObjectPresence,
): void {
  const entries = registrations.get(registry);
  if (!entries) return;
  const registration = entries.get(id);
  if (registration?.token !== token || registration.object !== object) return;
  entries.delete(id);
  if (entries.size === 0) registrations.delete(registry);
  if (registry.getObject(id) === object) registry.removeObject(id);
}

/**
 * Makes an existing interaction runtime available to descendants. Create the
 * runtime from the same PresenceRegistry supplied to the nearest
 * PresenceProvider; this provider neither creates a second runtime nor ticks it.
 */
export function InteractionsProvider({
  runtime,
  children,
}: {
  runtime: InteractionRuntime;
  children: ReactNode;
}): ReactNode {
  return <InteractionsContext.Provider value={runtime}>{children}</InteractionsContext.Provider>;
}

/** The existing interaction runtime from the nearest InteractionsProvider. */
export function useInteractions(): InteractionRuntime {
  const runtime = useContext(InteractionsContext);
  if (!runtime) throw new Error("interaction hooks must be used inside <InteractionsProvider>");
  return runtime;
}

/** A running interaction read on demand, without subscribing React to its clock. */
export interface InteractionRef {
  readonly current: Interaction | undefined;
}

/**
 * A live accessor for a running interaction. Read `.current` from a frame
 * callback or event handler; registry ticks never re-render this component.
 */
export function useInteraction(id: string): InteractionRef {
  const runtime = useInteractions();
  return useMemo(
    () => ({
      get current() {
        return runtime.running().find((interaction) => interaction.id === id);
      },
    }),
    [runtime, id],
  );
}

/**
 * Subscribes a participant to discrete interaction events. A new listener is
 * used immediately without installing another runtime listener; it is removed
 * when the component unmounts or the participant/runtime changes.
 */
export function useInteractionEvents(
  participant: string,
  listener: (event: InteractionEvent) => void,
): void {
  const runtime = useInteractions();
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(
    () => runtime.on(participant, (event) => latest.current(event)),
    [runtime, participant],
  );
}

export interface InteractableProps {
  /** The object or fixture to publish into the nearest PresenceProvider's registry. */
  object: ObjectPresence;
  /** Offers made by this object. Every offerer must be this object's id. */
  offers?: readonly Offer[];
  /** Called when this component cannot register its object or offers. */
  onRegistrationError?: (error: Error) => void;
  children?: ReactNode;
}

/**
 * Publishes an object or fixture and registers the offers it makes while
 * mounted. An id is exclusively owned by one Interactable registration: an
 * existing registry object is rejected rather than replaced and reported through
 * `onRegistrationError`. Both registrations are removed on replacement and
 * unmount, only while this registration owns it.
 */
export function Interactable({
  object,
  offers = EMPTY_OFFERS,
  onRegistrationError,
  children,
}: InteractableProps): ReactNode {
  const registry = usePresenceRegistry();
  const runtime = useInteractions();
  const token = useRef<object | null>(null);
  if (token.current === null) token.current = {};
  const owner = token.current;
  useEffect(() => {
    const fail = (error: Error) => {
      if (onRegistrationError) {
        onRegistrationError(error);
        return;
      }
      throw error;
    };
    if (registry.getObject(object.id)) {
      fail(new Error(`interactable ${object.id} is already registered`));
      return;
    }
    const entry = registrationsFor(registry);
    if (entry.has(object.id)) {
      fail(new Error(`interactable ${object.id} is already registered`));
      return;
    }
    for (const offer of offers) {
      if (offer.by !== object.id) {
        fail(new Error(`offer ${offer.id} is by ${offer.by}, not interactable ${object.id}`));
        return;
      }
    }
    entry.set(object.id, { token: owner, object });
    const stops: (() => void)[] = [];
    try {
      registry.setObject(object);
      for (const offer of offers) stops.push(runtime.offer(offer));
    } catch (error) {
      for (let i = stops.length - 1; i >= 0; i--)
        try {
          stops[i]?.();
        } catch {
          // The original registration error is the useful failure to report.
        }
      releaseObject(registry, object.id, owner, object);
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    return () => {
      for (let i = stops.length - 1; i >= 0; i--) stops[i]?.();
      releaseObject(registry, object.id, owner, object);
    };
  }, [registry, runtime, object, offers, owner, onRegistrationError]);
  return <>{children}</>;
}
