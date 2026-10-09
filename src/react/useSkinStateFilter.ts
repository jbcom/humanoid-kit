/**
 * `useSkinStateFilter`: signals that rise and fall at the pace a body does
 * (src/surface/skinStateFilter.ts), for `<Humanoid signals>`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { SkinStateFilter, type StateRate } from "../surface/skinStateFilter.ts";
import { sameEntries } from "./sameEntries.ts";

export interface SkinStateFilterOptions {
  /**
   * Time constants per signal, replacing `STATE_TIME_CONSTANTS`. Pass a stable
   * object (a module constant): a new one starts the filter over.
   */
  rates?: Readonly<Record<string, StateRate>> | undefined;
  /**
   * Where it starts: at the first `target` (the default, so a figure that
   * mounts in a state is not seen easing into it), or at rest.
   */
  initial?: "target" | "rest" | undefined;
}

const NONE: Readonly<Record<string, number>> = {};

/** The longest step a frame may take: a tab left in the background does not snap to its target in one jump. */
const MAX_FRAME = 1;

/**
 * Follows `target` (signals, each 0..1: the state the application wants) at the
 * time constants of `STATE_TIME_CONSTANTS`, and returns the signals to give
 * `<Humanoid signals>`. The component re-renders each frame while a signal
 * moves, and not at all once they have settled. A new `target` object with the
 * same entries changes nothing.
 */
export function useSkinStateFilter(
  target: Readonly<Record<string, number>> | undefined,
  options: SkinStateFilterOptions = {},
): Record<string, number> {
  const goalRef = useRef(target ?? NONE);
  if (!sameEntries(goalRef.current, target ?? NONE)) goalRef.current = target ?? NONE;
  const goal = goalRef.current;
  const { rates, initial = "target" } = options;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the first target is where it starts; later ones are followed
  const filter = useMemo(
    () => new SkinStateFilter(rates, initial === "target" ? goal : {}),
    [rates, initial],
  );
  const [value, setValue] = useState(() => filter.value);

  useEffect(() => {
    if (filter.settled(goal)) {
      // Already there (or came to rest at it): publish the exact state once.
      setValue(filter.value);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(MAX_FRAME, (now - last) / 1000);
      last = now;
      setValue(filter.step(goal, dt));
      if (!filter.settled(goal)) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [filter, goal]);

  return value;
}
