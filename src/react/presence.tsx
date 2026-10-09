/**
 * React bindings for presence (docs/PRESENCE.md): a provider that owns the
 * registry and ticks it from the render loop, and hooks to read it.
 *
 * Continuous state is pulled, not pushed: `usePresence` returns a live
 * accessor to read in a frame callback or an event handler, so a walking
 * figure never re-renders its readers. Discrete changes (proximity) are
 * events, delivered by `useProximity`.
 */
import { useFrame } from "@react-three/fiber";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { type Group, Vector3 } from "three";
import type { Evaluation } from "../model/humanoidModel.ts";
import {
  type PresenceJoints,
  placePresence,
  presenceFromEvaluation,
} from "../presence/fromEvaluation.ts";
import {
  createPresenceRegistry,
  type FigurePresence,
  type PresenceRegistry,
  type ProximityEvent,
  type PublishedPresence,
} from "../presence/presence.ts";
import type { Recipe } from "../recipe/recipe.ts";

/** Called every frame before the registry ticks; returns the figure's presence, or null while it has none. */
export type PresencePublisher = () => FigurePresence | null;

interface PresenceContextValue {
  registry: PresenceRegistry;
  /** Registers a publisher to run each frame; returns the function that stops it. */
  track(publisher: PresencePublisher): () => void;
  /**
   * Registers a consumer to run each frame right after the registry ticks, so
   * it sees every figure's placement from this very frame. Returns the function
   * that stops it.
   */
  afterTick(consumer: (registry: PresenceRegistry) => void): () => void;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

/** The nearest provider's context, or null when there is none. */
export const usePresenceContext = (): PresenceContextValue | null => useContext(PresenceContext);

/**
 * Owns the presence registry for everything below it and ticks it once per
 * frame, after every figure has published its placement. Render it inside the
 * canvas. Pass `registry` to share one with code outside React.
 */
export function PresenceProvider({
  registry,
  children,
}: {
  registry?: PresenceRegistry;
  children: ReactNode;
}) {
  const owned = useMemo(() => registry ?? createPresenceRegistry(), [registry]);
  const publishers = useRef(new Set<PresencePublisher>());
  const consumers = useRef(new Set<(registry: PresenceRegistry) => void>());
  const value = useMemo<PresenceContextValue>(
    () => ({
      registry: owned,
      track(publisher) {
        publishers.current.add(publisher);
        return () => {
          publishers.current.delete(publisher);
        };
      },
      afterTick(consumer) {
        consumers.current.add(consumer);
        return () => {
          consumers.current.delete(consumer);
        };
      },
    }),
    [owned],
  );
  useFrame((state) => {
    for (const publish of publishers.current) {
      const presence = publish();
      if (presence) owned.set(presence);
    }
    owned.tick(state.clock.elapsedTime);
    for (const consume of consumers.current) consume(owned);
  });
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

/** What a figure publishes presence from: its latest evaluation, recipe and the pack's joints. */
export interface PresenceSource {
  evaluation: Evaluation;
  recipe: Recipe;
  joints: PresenceJoints;
}

const worldPosition = new Vector3();
const worldHeading = new Vector3();

/**
 * Publishes a figure into the nearest registry every frame, for as long as it
 * is mounted (and removes it after). The ground position and heading are read
 * from the group's world transform, so a figure moved by its own `position`,
 * by a parent, or by `useFrame` is followed alike; `source` supplies the rest
 * of the presence, derived once per evaluation. The group's origin is the
 * ground under the figure (`<Humanoid>` lifts its meshes onto it). Assumes an
 * upright figure at unit scale.
 */
export function usePublishPresence(
  id: string | undefined,
  group: RefObject<Group | null>,
  source: RefObject<PresenceSource | null>,
): void {
  const ctx = useContext(PresenceContext);
  // Re-derived only when the evaluation changes, not as the figure moves.
  const rest = useRef<{ source: PresenceSource; presence: FigurePresence } | null>(null);
  useEffect(() => {
    if (!ctx || id === undefined) return;
    const publish: PresencePublisher = () => {
      const g = group.current;
      const s = source.current;
      if (!g || !s) return null;
      if (rest.current?.source !== s)
        rest.current = {
          source: s,
          presence: presenceFromEvaluation({
            evaluation: s.evaluation,
            recipe: s.recipe,
            joints: s.joints,
            placement: { id, position: [0, 0, 0], facing: [0, 0, 1] },
          }),
        };
      g.updateWorldMatrix(true, false);
      worldPosition.setFromMatrixPosition(g.matrixWorld);
      worldHeading.set(0, 0, 1).transformDirection(g.matrixWorld);
      // A figure tipped onto its back has no heading on the ground to publish.
      if (Math.hypot(worldHeading.x, worldHeading.z) < 1e-6) return null;
      return placePresence(rest.current.presence, {
        id,
        position: [worldPosition.x, worldPosition.y, worldPosition.z],
        facing: [worldHeading.x, 0, worldHeading.z],
      });
    };
    const untrack = ctx.track(publish);
    return () => {
      untrack();
      ctx.registry.remove(id);
    };
  }, [ctx, id, group, source]);
}

/** The registry of the nearest `PresenceProvider`; throws without one. */
export function usePresenceRegistry(): PresenceRegistry {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("presence hooks must be used inside <PresenceProvider>");
  return ctx.registry;
}

/** A value read on demand: `current` is looked up when read, never cached. */
export interface PresenceRef<T> {
  readonly current: T;
}

/**
 * A live accessor to one figure's presence, `undefined` while it has none.
 * Read `.current` in `useFrame` or an event handler: it does not re-render the
 * component when the figure moves.
 */
export function usePresence(id: string): PresenceRef<PublishedPresence | undefined>;
/** A live accessor to every published figure. */
export function usePresence(): PresenceRef<PublishedPresence[]>;
export function usePresence(
  id?: string,
): PresenceRef<PublishedPresence | PublishedPresence[] | undefined> {
  const registry = usePresenceRegistry();
  return useMemo(
    () => ({
      get current() {
        return id === undefined ? registry.all() : registry.get(id);
      },
    }),
    [registry, id],
  );
}

/**
 * Calls `listener` when two figures come within `radius` metres on the ground
 * and when they part (beyond 1.1 × `radius`). The listener may change every
 * render without resubscribing.
 */
export function useProximity(radius: number, listener: (event: ProximityEvent) => void): void {
  const registry = usePresenceRegistry();
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => registry.onProximity(radius, (e) => latest.current(e)), [registry, radius]);
}
