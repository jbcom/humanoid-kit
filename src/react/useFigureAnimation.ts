/**
 * Plays a clip on a `<Humanoid>` (docs/ARCHITECTURE.md, "Animation"): per frame,
 * the animator's body pose (with the face units laid over it) goes to the
 * skeleton, the attachments' occlusion keys, the skin's dual quaternions, the
 * figure's lift onto the ground, its presence, and, if the clip carries it, the
 * group along. None of it goes through React state, so a figure animates without
 * re-rendering.
 */
import { useFrame } from "@react-three/fiber";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import type { Group, Skeleton, Vector3 } from "three";
import { Animator } from "../animation/animator.ts";
import type { AnimationClip } from "../animation/clip.ts";
import type { AnimationLibrary } from "../animation/library.ts";
import { contactBones, contactPoints } from "../animation/locomotion.ts";
import type { Evaluation } from "../model/humanoidModel.ts";
import { groundOffsetOf } from "../presence/posed.ts";
import type { DualBones } from "../render/dualSkinning.ts";
import { type OcclusionKeyBasis, occlusionKeyWeights } from "../rig/occlusionKeys.ts";
import {
  type BoneRotations,
  composeRotations,
  type RestBones,
  restBonesFrom,
  skinPositions,
} from "../rig/pose.ts";
import type { ReadyInfo } from "../worker/client.ts";
import type { PresenceSource } from "./presence.tsx";

/** A clip playing on a figure. */
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
  /** The face units' pose, laid over the body's. */
  face: BoneRotations | null;
  group: RefObject<Group | null>;
  /** The group the figure's meshes are lifted in, when the figure lifts itself onto the ground. */
  lifted: RefObject<Group | null>;
  lifts: boolean;
  /** The lift of the figure in its static pose, which the group goes back to when no clip plays. */
  staticLift: number;
  presenceSource: RefObject<PresenceSource | null>;
  report: (e: Error) => void;
}

export function useFigureAnimation(args: Args): void {
  const { animation, ready, figure } = args;
  const active = animation !== undefined;
  const animator = useRef<Animator | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;
  /** What the figure's skeleton is at rest, once per evaluation, and its contact bones. */
  const rig = useRef<{ rest: RestBones; contacts: Int16Array } | null>(null);
  /** A clip that arrived before the animator did. */
  const pending = useRef<AnimationClip | null>(null);
  const lastRoot = useRef<[number, number]>([0, 0]);
  const frame = useRef(0);
  const posed = useMemo(
    () => ({ q: new Float32Array(0), mesh: new Float32Array(0), soles: new Float32Array(18) }),
    [],
  );

  const start = useCallback((a: Animator, clip: AnimationClip) => {
    const o = argsRef.current.animation;
    a.play(clip, {
      ...(o?.fade !== undefined && { fade: o.fade }),
      ...(o?.speed !== undefined && { speed: o.speed }),
      time: o?.time ?? 0,
    });
    lastRoot.current = [a.root[0], a.root[1]];
    o?.onStart?.(clip.id);
  }, []);

  // The animator follows the figure's own skeleton and ground, which the evaluation sets.
  useEffect(() => {
    if (!active || !ready || !figure) {
      animator.current = null;
      rig.current = null;
      return;
    }
    const rest = restBonesFrom(ready.rig.bones, ready.rig.parents, figure.boneHeads);
    const ground = -figure.groundOffset;
    rig.current = { rest, contacts: contactBones(rest) };
    posed.q = new Float32Array(ready.rig.bones.length * 4);
    if (animator.current) animator.current.setRest(rest, ground);
    else animator.current = new Animator(ready.rig.bones.length, rest, ground);
    if (pending.current && !animator.current.playing) start(animator.current, pending.current);
    pending.current = null;
    const playing = animator.current.playing;
    if (playing) argsRef.current.animation?.onStart?.(playing.clip.id);
  }, [active, ready, figure, posed, start]);

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
    if (!cur.animation.paused) a.update(Math.min(delta, 0.1));
    const { ready: info, figure: ev, skeleton: sk } = cur;
    const fit = rig.current;
    if (!fit) return;
    const rest = fit.rest;
    const body = a.rotations;
    const q = cur.face ? composeRotations(body, cur.face, posed.q) : body;
    // The skeleton, the occlusion keys and the skin's dual quaternions.
    sk.bones.forEach((bone, i) => {
      bone.quaternion.fromArray(q, i * 4);
    });
    if (cur.keyBasis) cur.occlusionKeys.fromArray(occlusionKeyWeights(cur.keyBasis, q));
    cur.dual?.update(rest, q);
    // The figure's lift onto the ground. A figure on its feet stands on its soles, which
    // follow the pose without skinning the body; one that is not (a swim) is grounded
    // by its lowest vertex.
    let offset: number;
    if (a.playing.clip.grounded) {
      contactPoints(rest, q, -ev.groundOffset, posed.soles, 0, fit.contacts);
      let low = Number.POSITIVE_INFINITY;
      for (let k = 0; k < 6; k++) low = Math.min(low, posed.soles[k * 3 + 1] as number);
      offset = ev.groundOffset - low;
    } else {
      if (posed.mesh.length !== ev.control.length) posed.mesh = new Float32Array(ev.control.length);
      skinPositions(
        rest,
        q,
        ev.control,
        info.rig.skin.skinIndex,
        info.rig.skin.skinWeight,
        posed.mesh,
      );
      offset = groundOffsetOf(posed.mesh, info.rig.skin.bodyVertices);
    }
    if (cur.group.current) cur.group.current.userData.groundOffset = offset;
    if (cur.lifts && cur.lifted.current) cur.lifted.current.position.y = offset;
    // Root motion: the group is carried forward in its own frame by what the clips did this frame.
    const g = cur.group.current;
    if (g && cur.animation.rootMotion !== false) {
      const dx = a.root[0] - lastRoot.current[0];
      const dz = a.root[1] - lastRoot.current[1];
      if (dx !== 0 || dz !== 0) {
        const s = Math.sin(g.rotation.y);
        const c = Math.cos(g.rotation.y);
        g.position.x += dx * c + dz * s;
        g.position.z += -dx * s + dz * c;
      }
    }
    lastRoot.current[0] = a.root[0];
    lastRoot.current[1] = a.root[1];
    // The presence follows the pose from the posed skeleton, derived anew every few frames.
    const source = cur.presenceSource.current;
    if (source && frame.current++ % PRESENCE_EVERY === 0)
      cur.presenceSource.current = {
        ...source,
        pose: { rig: info.rig, rotations: Float32Array.from(q) },
      };
  });
}
