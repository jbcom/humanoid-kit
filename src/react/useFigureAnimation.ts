/** Animation frame integration for React Three Fiber figures. */
import { useFrame } from "@react-three/fiber";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import type { Group, Skeleton, Vector3 } from "three";
import { Animator } from "../animation/animator.ts";
import type { AnimationClip } from "../animation/clip.ts";
import {
  type AnimationFrames,
  createAnimationFrames,
  type FrameBinding,
  type FrameObserver,
} from "../animation/frames.ts";
import { AnimationFrameWriter, type FrameFigure } from "../animation/frameWriter.ts";
import type { AnimationLibrary } from "../animation/library.ts";
import { contactBones } from "../animation/locomotion.ts";
import type { Evaluation } from "../model/humanoidModel.ts";
import type { DualBones } from "../render/dualSkinning.ts";
import { type OcclusionKeyBasis, occlusionKeyWeights } from "../rig/occlusionKeys.ts";
import { type BoneRotations, composeRotations, restBonesFrom } from "../rig/pose.ts";
import type { ReadyInfo } from "../worker/client.ts";
import { FIGURE_FRAME_PRIORITY } from "./framePriority.ts";
import type { PresenceSource } from "./presence.tsx";

/** A clip playing on a `<Humanoid>` (docs/ARCHITECTURE.md, "Animation"): per frame,
 * the animator's body pose (with the face units laid over it) goes to the
 * skeleton, the attachments' occlusion keys, the skin's dual quaternions, the
 * figure's lift onto the ground, its presence, and, if the clip carries it, the
 * group along. None of it goes through React state, so a figure animates without
 * re-rendering.
 */
export interface HumanoidAnimation {
  /** The animation pack's library (`loadAnimationLibrary`). */
  library: AnimationLibrary;
  /** The clip's id (`walk_normal`, `idle1`, `swimcrawlstroke`); a new id fades from the one playing. */
  clip: string;
  /** Playback speed, 1 being as authored; default 1. */
  speed?: number;
  /** Seconds a new clip takes to replace the old one; default 0.25. */
  fade?: number;
  /** Holds the figure where it is. */
  paused?: boolean;
  /**
   * Seconds into the clip: each new value moves the figure there (the clip then
   * plays on from it unless `paused`). A sheet or a test sets it to see a figure at
   * a time.
   */
  time?: number;
  /**
   * Whether the clip carries the figure along (a walk moves the group, forward in
   * its own frame): default true. Without it a walk is on the spot.
   */
  rootMotion?: boolean;
  /**
   * Called with the clip's id once it is loaded and the figure is following it, and
   * again whenever a new figure, or a new `time`, has been put to it.
   */
  onStart?: (clip: string) => void;
  /**
   * Receives each completed animation frame without a React render: the same frame
   * the figure publishes into its presence registry's `frames` (docs/INTERACTION-SESSION.md,
   * "Animation frames"). The object is reused; copy what you keep. `contacts` are
   * figure-local after the ground lift and `toWorld` places them in the world.
   * `generation` rises after each new client or evaluation.
   */
  onFrame?: FrameObserver;
}

/** How often (in frames) the figure's presence is derived again from its pose: it skins the body once. */
const PRESENCE_EVERY = 3;

interface Args {
  animation: HumanoidAnimation | undefined;
  ready: ReadyInfo | null;
  figure: Evaluation | null;
  skeleton: Skeleton | null;
  dual: DualBones | null;
  keyBasis: OcclusionKeyBasis | null;
  occlusionKeys: Vector3;
  /** The face units' pose, laid over the body's: read each frame, so it changes without a render. */
  face: RefObject<BoneRotations | null>;
  group: RefObject<Group | null>;
  /** The group the figure's meshes are lifted in, when the figure lifts itself onto the ground. */
  lifted: RefObject<Group | null>;
  lifts: boolean;
  /** The lift of the figure in its static pose, which the group goes back to when no clip plays. */
  staticLift: number;
  presenceSource: RefObject<PresenceSource | null>;
  /** The presence registry's frame channel the figure publishes into, when it has a presence. */
  frames: AnimationFrames | null;
  /** The figure's presence id. */
  figureId: string | undefined;
  report: (e: Error) => void;
}

export function useFigureAnimation(args: Args): void {
  const { animation, ready, figure } = args;
  const active = animation !== undefined;
  const animator = useRef<Animator | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;
  /** What the figure's frames are measured on, once per evaluation. */
  const rig = useRef<FrameFigure | null>(null);
  /** A clip that arrived before the animator did. */
  const pending = useRef<AnimationClip | null>(null);
  /** Counts frames, to derive the presence every `PRESENCE_EVERY`. */
  const frameCount = useRef(0);
  const posed = useMemo(() => ({ q: new Float32Array(0) }), []);
  const writer = useMemo(() => new AnimationFrameWriter(), []);
  // A figure with no presence still binds a channel of its own, so `onFrame`'s
  // generation follows the same lifecycle as a registry's.
  const own = useMemo(() => createAnimationFrames(), []);
  const channel = args.frames ?? own;
  const figureId = args.figureId ?? "";
  const binding = useRef<FrameBinding | null>(null);

  const start = useCallback(
    (a: Animator, clip: AnimationClip) => {
      const o = argsRef.current.animation;
      // A paused figure's time does not run, so a fade would never end: the new clip replaces the old at once.
      a.play(clip, {
        ...(o?.paused ? { fade: 0 } : o?.fade !== undefined && { fade: o.fade }),
        ...(o?.speed !== undefined && { speed: o.speed }),
        time: o?.time ?? 0,
      });
      writer.resetCarry(a);
      o?.onStart?.(clip.id);
    },
    [writer],
  );

  // The figure publishes while it plays a clip on a ready client: a new client, a new
  // id or a stopped clip releases this binding, and the next one supersedes it.
  useEffect(() => {
    if (!active || !ready) return;
    const b = channel.bind(figureId);
    binding.current = b;
    return () => {
      if (binding.current === b) binding.current = null;
      b.release();
    };
  }, [active, ready, channel, figureId]);

  // The animator follows the figure's own skeleton and ground, which the evaluation sets.
  useEffect(() => {
    if (!active || !ready || !figure) {
      animator.current = null;
      rig.current = null;
      return;
    }
    const rest = restBonesFrom(ready.rig.bones, ready.rig.parents, figure.boneHeads);
    const ground = -figure.groundOffset;
    rig.current = {
      rest,
      groundOffset: figure.groundOffset,
      contacts: contactBones(rest),
      skin: {
        control: figure.control,
        skinIndex: ready.rig.skin.skinIndex,
        skinWeight: ready.rig.skin.skinWeight,
        bodyVertices: ready.rig.skin.bodyVertices,
      },
    };
    // Frames from here on are measured on this evaluation.
    binding.current?.rebind();
    posed.q = new Float32Array(ready.rig.bones.length * 4);
    if (animator.current) animator.current.setRest(rest, ground);
    else {
      animator.current = new Animator(ready.rig.bones.length, rest, ground);
      writer.resetCarry(animator.current);
    }
    if (pending.current && !animator.current.playing) start(animator.current, pending.current);
    pending.current = null;
    const playing = animator.current.playing;
    if (playing) argsRef.current.animation?.onStart?.(playing.clip.id);
  }, [active, ready, figure, posed, start, writer]);

  // The clip: loaded when first asked for, played when it arrives.
  const clipId = animation?.clip;
  const library = animation?.library;
  useEffect(() => {
    if (!clipId || !library || !ready) return;
    let live = true;
    library.load(clipId, ready.rig.bones).then(
      (clip) => {
        if (!live) return;
        const a = animator.current;
        if (!a) pending.current = clip;
        else if (a.playing?.clip !== clip) start(a, clip);
      },
      (e: Error) => live && argsRef.current.report(e),
    );
    return () => {
      live = false;
    };
  }, [clipId, library, ready, start]);
  // When the clip ends, the figure goes back to the lift of its static pose.
  const { staticLift, lifted, lifts } = args;
  useEffect(() => {
    if (!active && lifted.current) lifted.current.position.y = lifts ? staticLift : 0;
  }, [active, staticLift, lifted, lifts]);
  const speed = animation?.speed;
  useEffect(() => {
    if (speed !== undefined) animator.current?.setSpeed(speed);
  }, [speed]);
  const time = animation?.time;
  useEffect(() => {
    const a = animator.current;
    if (time === undefined || !a) return;
    a.seek(time);
    if (a.playing) argsRef.current.animation?.onStart?.(a.playing.clip.id);
  }, [time]);

  useFrame((_, delta) => {
    const a = animator.current;
    const cur = argsRef.current;
    if (!a?.playing || !cur.animation || !cur.ready || !cur.skeleton || !cur.figure) return;
    // Root motion is measured against R3F's render clock. Capping this step makes
    // a slow frame visibly shorten a walk, so the animator receives that clock's
    // full elapsed step.
    if (!cur.animation.paused) a.update(delta);
    const { ready: info, skeleton: sk } = cur;
    const fit = rig.current;
    if (!fit) return;
    const body = a.rotations;
    const face = cur.face.current;
    const q = face ? composeRotations(body, face, posed.q) : body;
    // The skeleton, the occlusion keys and the skin's dual quaternions.
    sk.bones.forEach((bone, i) => {
      bone.quaternion.fromArray(q, i * 4);
    });
    if (cur.keyBasis) cur.occlusionKeys.fromArray(occlusionKeyWeights(cur.keyBasis, q));
    cur.dual?.update(fit.rest, q);
    // The lift onto the ground (from the soles for a figure on its feet, from the lowest
    // vertex for one that is not), the carry and the sole contacts (`AnimationFrameWriter`).
    const out = writer.write(fit, a, q);
    if (!out) return;
    const offset = out.lift;
    if (cur.group.current) cur.group.current.userData.groundOffset = offset;
    if (cur.lifts && cur.lifted.current) cur.lifted.current.position.y = offset;
    // Root motion: the group is carried forward in its own frame by what the clips did this frame.
    const g = cur.group.current;
    const [dx, dz] = out.delta;
    if (g && cur.animation.rootMotion !== false) {
      if (dx !== 0 || dz !== 0) {
        const s = Math.sin(g.rotation.y);
        const c = Math.cos(g.rotation.y);
        g.position.x += dx * c + dz * s;
        g.position.z += -dx * s + dz * c;
      }
    }
    // The presence follows the pose from the posed skeleton, derived anew every few frames.
    const source = cur.presenceSource.current;
    if (source && frameCount.current++ % PRESENCE_EVERY === 0)
      cur.presenceSource.current = {
        ...source,
        pose: { rig: info.rig, rotations: Float32Array.from(q) },
      };
    // Where the figure-local frame is in the world after this frame's carry.
    if (g) {
      g.updateWorldMatrix(true, false);
      const m = g.matrixWorld.elements;
      for (let k = 0; k < 16; k++) out.toWorld[k] = m[k] as number;
    }
    // Internal root and presence state is complete before a consumer can observe or throw.
    // Both the channel's observers and `onFrame` receive the frame; the first throw is rethrown.
    let failed = false;
    let error: unknown;
    try {
      binding.current?.publish(out);
    } catch (e) {
      failed = true;
      error = e;
    }
    try {
      cur.animation.onFrame?.(out);
    } catch (e) {
      if (!failed) {
        failed = true;
        error = e;
      }
    }
    if (failed) throw error;
  }, FIGURE_FRAME_PRIORITY);
}
