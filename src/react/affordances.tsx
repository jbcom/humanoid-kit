/**
 * The affordance API in React (docs/ARCHITECTURE.md, "Affordances: the
 * registry", "The public API"): a handle a developer makes once and gives to
 * `<Humanoid affordances>`, and an anchor that places children on one of the
 * figure's affordances, frame by frame.
 */
import { createPortal, useFrame } from "@react-three/fiber";
import { type ReactNode, useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { Group } from "three";
import { HumanoidAffordances } from "../affordance/live.ts";
import type { Affordance } from "../affordance/registry.ts";
import { frameOut } from "../foundation/landmarks.ts";

export { HumanoidAffordances };

/**
 * A handle on a figure's affordances (`HumanoidAffordances`), stable for the
 * component's life: give it to `<Humanoid affordances={handle}>`, which keeps
 * it current, and read frames, channels and states from it, in a `useFrame`
 * or anywhere. `registry` is the affordances figures may have (the core's by
 * default); it is read once.
 */
export function useHumanoidAffordances(registry?: readonly Affordance[]): HumanoidAffordances {
  const [handle] = useState(() => new HumanoidAffordances(registry));
  return handle;
}

/**
 * Draws its children on one of a figure's affordances: in the group the
 * figure's meshes are lifted in (a portal), placed each frame on the
 * affordance's frame as drawn, +x along its tangent, +y along its bitangent,
 * +z out along its normal. Nothing is drawn while the figure is not, or while
 * it has no such affordance (an adult's, on a figure under 18).
 */
export function AffordanceAnchor({
  of,
  at,
  children,
}: {
  of: HumanoidAffordances;
  /** The affordance's id (`HumanoidAffordances.own`). */
  at: string;
  children?: ReactNode;
}) {
  const subscribe = useCallback((changed: () => void) => of.subscribe(changed), [of]);
  const lifted = useSyncExternalStore(
    subscribe,
    () => of.lifted,
    () => of.lifted,
  );
  const ref = useRef<Group>(null);
  const [out] = useState(frameOut);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const f = of.has(at) ? of.frame(at, "figure", out) : null;
    g.visible = f !== null;
    if (!f) return;
    const { position: p, tangent: t, bitangent: b, normal: n } = f;
    g.matrix.set(
      t[0],
      b[0],
      n[0],
      p[0],
      t[1],
      b[1],
      n[1],
      p[1],
      t[2],
      b[2],
      n[2],
      p[2],
      0,
      0,
      0,
      1,
    );
    g.matrixWorldNeedsUpdate = true;
  });
  if (!lifted) return null;
  return createPortal(
    <group ref={ref} matrixAutoUpdate={false} visible={false}>
      {children}
    </group>,
    lifted,
  );
}
