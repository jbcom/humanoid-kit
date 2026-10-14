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
import type { ObjectPresence } from "../presence/presence.ts";
import { usePresenceRegistry } from "./presence.tsx";

const InteractionsContext = createContext<InteractionRuntime | null>(null);
const EMPTY_OFFERS: readonly Offer[] = [];

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
  children?: ReactNode;
}

/**
 * Publishes an object or fixture and registers the offers it makes while
 * mounted. Its object id owns every supplied offer, which prevents a component
 * from accidentally advertising another component's object. Both registrations
 * are removed on replacement and unmount.
 */
export function Interactable({
  object,
  offers = EMPTY_OFFERS,
  children,
}: InteractableProps): ReactNode {
  const registry = usePresenceRegistry();
  const runtime = useInteractions();
  for (const offer of offers) {
    if (offer.by !== object.id)
      throw new Error(`offer ${offer.id} is by ${offer.by}, not interactable ${object.id}`);
  }
  useEffect(() => {
    registry.setObject(object);
    const stops = offers.map((offer) => runtime.offer(offer));
    return () => {
      for (const stop of stops) stop();
      registry.removeObject(object.id);
    };
  }, [registry, runtime, object, offers]);
  return <>{children}</>;
}
