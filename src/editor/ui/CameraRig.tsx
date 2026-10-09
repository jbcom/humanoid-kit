/**
 * Orbit controls that glide to a framing request: when the focus changes (the
 * user picks a slider), the camera eases to fit that body part from the
 * slider's camera hint. Grabbing the view cancels the glide.
 */
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useMemo, useRef } from "react";
import { type PerspectiveCamera, Vector3 } from "three";
import type { ReadyInfo } from "../../worker/protocol.ts";
import { type FrameRequest, frameCamera, partBounds, vertexFrameParts } from "../framing.ts";

export interface CameraRigProps {
  ready: ReadyInfo;
  /** Render-vertex positions of the latest evaluation, in the figure's space. */
  positions: Float32Array | null;
  /** The figure's offset in the scene (its ground lift). */
  offsetY: number;
  focus: FrameRequest;
  /** Bumped to frame `focus` again although it has not changed (a repeated tap after orbiting away). */
  refocus?: number;
}

export function CameraRig({ ready, positions, offsetY, focus, refocus = 0 }: CameraRigProps) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const parts = useMemo(
    () =>
      vertexFrameParts(ready.topology.body.skinIndex, ready.topology.body.skinWeight, ready.bones),
    [ready],
  );
  const goal = useRef<{ position: Vector3; target: Vector3 } | null>(null);
  const framed = useRef(false);

  // Re-frame only when the focus changes (or the figure first appears), not on
  // every evaluation, so dragging a slider never fights the user's view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: positions and offset are read, not watched
  useEffect(() => {
    if (!positions) return;
    const b = partBounds(positions, parts, focus.part);
    if (!b) return;
    b.min[1] += offsetY;
    b.max[1] += offsetY;
    const f = frameCamera(b, focus.direction, camera.fov, size.width / Math.max(1, size.height));
    goal.current = { position: new Vector3(...f.position), target: new Vector3(...f.target) };
  }, [
    focus.part,
    focus.direction,
    refocus,
    parts,
    camera,
    size.width,
    size.height,
    positions !== null,
  ]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const cancel = () => {
      goal.current = null;
    };
    c.addEventListener("start", cancel);
    return () => c.removeEventListener("start", cancel);
  }, []);

  useFrame((_, dt) => {
    const g = goal.current;
    const c = controls.current;
    if (!g || !c) return;
    // The first framing is instant; later ones glide.
    const k = framed.current ? 1 - Math.exp(-dt * 7) : 1;
    framed.current = true;
    camera.position.lerp(g.position, k);
    c.target.lerp(g.target, k);
    c.update();
    if (
      camera.position.distanceToSquared(g.position) < 1e-6 &&
      c.target.distanceToSquared(g.target) < 1e-6
    )
      goal.current = null;
  });

  return (
    <OrbitControls ref={controls} makeDefault minDistance={0.25} maxDistance={8} enableDamping />
  );
}
