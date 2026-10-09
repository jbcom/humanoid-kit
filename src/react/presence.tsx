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
import { type Group, type Object3D, Vector3 } from "three";
import type { Evaluation } from "../model/humanoidModel.ts";
import {
  clonePresence,
  type Placement,
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

/**
 * Called every frame before the registry ticks; returns the figure's presence
 * (the same object, updated in place, from one frame to the next), or null
 * while it has none, which takes the figure out of the registry.
 */
export type PresencePublisher = () => FigurePresence | null;

interface PresenceContextValue {
  registry: PresenceRegistry;
  /** Registers figure `id`'s publisher to run each frame; returns the function that stops it. */
  track(id: string, publisher: PresencePublisher): () => void;
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
  // Plain arrays, walked by index: nothing is allocated per frame.
  const publishers = useRef<{ id: string; publish: PresencePublisher }[]>([]);
  const consumers = useRef<((registry: PresenceRegistry) => void)[]>([]);
  const value = useMemo<PresenceContextValue>(
    () => ({
      registry: owned,
      track(id, publish) {
        const entry = { id, publish };
        publishers.current = [...publishers.current, entry];
        return () => {
          publishers.current = publishers.current.filter((e) => e !== entry);
        };
      },
      afterTick(consumer) {
        consumers.current = [...consumers.current, consumer];
        return () => {
          consumers.current = consumers.current.filter((c) => c !== consumer);
        };
      },
    }),
    [owned],
  );
  useFrame((state) => {
    const mine = publishers.current;
    for (let i = 0; i < mine.length; i++) {
      const { id, publish } = mine[i] as { id: string; publish: PresencePublisher };
      const presence = publish();
      if (presence) owned.set(presence);
      // A figure with no presence to publish (hidden, tipped over, not yet
      // evaluated) is not in the registry, rather than stale in it.
      else owned.remove(id);
    }
    owned.tick(state.clock.elapsedTime);
    const after = consumers.current;
    for (let i = 0; i < after.length; i++)
      (after[i] as (registry: PresenceRegistry) => void)(owned);
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

/** Whether the object and every ancestor is visible: a hidden figure is not in the world. */
function isShown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * Publishes a figure into the nearest registry every frame, for as long as it
 * is mounted and shown (and removes it after). The ground position and heading
 * are read from the group's world transform, so a figure moved by its own
 * `position`, by a parent, or by `useFrame` is followed alike; `source`
 * supplies the rest of the presence, derived once per evaluation. The group's
 * origin is the ground under the figure (`<Humanoid>` lifts its meshes onto
 * it). Assumes an upright figure at unit scale.
 *
 * A figure leaves the registry while the group or any ancestor is not
 * `visible`, while it is tipped so far over that it has no heading on the
 * ground, and until its first evaluation arrives; it rejoins when that ends.
 * Each frame re-places one presence in place: nothing is allocated.
 */
export function usePublishPresence(
  id: string | undefined,
  group: RefObject<Group | null>,
  source: RefObject<PresenceSource | null>,
): void {
  const ctx = useContext(PresenceContext);
  // Re-derived only when the evaluation changes, not as the figure moves.
  const derived = useRef<{
    source: PresenceSource;
    rest: FigurePresence;
    placed: FigurePresence;
  } | null>(null);
  useEffect(() => {
    if (!ctx || id === undefined) return;
    const placement: Placement = { id, position: [0, 0, 0], facing: [0, 0, 1] };
    const publish: PresencePublisher = () => {
      const g = group.current;
      const s = source.current;
      if (!g || !s || !isShown(g)) return null;
      if (derived.current?.source !== s) {
        const rest = presenceFromEvaluation({
          evaluation: s.evaluation,
          recipe: s.recipe,
          joints: s.joints,
          placement: { id, position: [0, 0, 0], facing: [0, 0, 1] },
        });
        derived.current = { source: s, rest, placed: clonePresence(rest) };
      }
      g.updateWorldMatrix(true, false);
      worldPosition.setFromMatrixPosition(g.matrixWorld);
      worldHeading.set(0, 0, 1).transformDirection(g.matrixWorld);
      // A figure tipped onto its back has no heading on the ground to publish.
      if (Math.hypot(worldHeading.x, worldHeading.z) < 1e-6) return null;
      placement.position[0] = worldPosition.x;
      placement.position[1] = worldPosition.y;
      placement.position[2] = worldPosition.z;
      placement.facing[0] = worldHeading.x;
      placement.facing[2] = worldHeading.z;
      return placePresence(derived.current.rest, placement, derived.current.placed);
    };
    const untrack = ctx.track(id, publish);
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
export function usePresence(): PresenceRef<readonly PublishedPresence[]>;
export function usePresence(
  id?: string,
): PresenceRef<PublishedPresence | readonly PublishedPresence[] | undefined> {
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
