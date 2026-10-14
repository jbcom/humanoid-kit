/**
 * Assembles a figure's animation frame from its `Animator`, outside any renderer
 * (docs/INTERACTION-SESSION.md, "Animation frames"). `<Humanoid>` writes its frames
 * with it, and so can a headless producer in a worker, on a server or in a test,
 * so both publish the same lift, carry and contacts for the same pose.
 */
import { groundOffsetOf } from "../presence/posed.ts";
import type { BoneRotations, RestBones } from "../rig/bones.ts";
import { skinPositions } from "../rig/pose.ts";
import type { Animator } from "./animator.ts";
import {
  ANIMATION_CONTACTS,
  createAnimationFrame,
  type HumanoidAnimationContact,
  type HumanoidAnimationFrame,
} from "./frames.ts";
import { contactPoints } from "./locomotion.ts";

/** What a frame is measured on: one evaluated figure's skeleton and ground. */
export interface FrameFigure {
  /** The figure's rest skeleton. */
  rest: RestBones;
  /** How far the figure at rest is lifted to stand on the ground (`Evaluation.groundOffset`). */
  groundOffset: number;
  /** The contact bones of `rest` (`contactBones`). */
  contacts: Int16Array;
  /**
   * The figure's skin, which grounds a clip that does not stand on its feet (a
   * swim) by its lowest body vertex. Without it such a clip is lifted as at rest.
   */
  skin?: {
    control: Float32Array;
    skinIndex: Uint8Array | Uint16Array;
    skinWeight: Float32Array;
    bodyVertices: Uint32Array;
  };
}

export class AnimationFrameWriter {
  /** The one frame this writer fills; publish it, never keep it. */
  readonly frame: HumanoidAnimationFrame;
  /** The six sole points of the last pose, figure-local before the lift (x, y, z each). */
  readonly soles = new Float32Array(18);
  private mesh = new Float32Array(0);
  private readonly last: [number, number] = [0, 0];

  constructor(figure = "") {
    this.frame = createAnimationFrame(figure);
  }

  /** Starts measuring carry from the animator's root as it is now: after a play, or a new animator. */
  resetCarry(animator: Animator): void {
    this.last[0] = animator.root[0];
    this.last[1] = animator.root[1];
  }

  /**
   * Fills `frame` from the animator's playing clip and `rotations` (its pose, with
   * any face units laid over): the lift onto the ground, the carry since the last
   * write, and the six sole contacts with FootLock's ownership. Returns the frame,
   * or null when no clip plays. `toWorld` is the caller's (`setFramePlacement`, or
   * a renderer's group matrix).
   */
  write(
    figure: FrameFigure,
    animator: Animator,
    rotations: BoneRotations,
  ): HumanoidAnimationFrame | null {
    const playing = animator.playing;
    if (!playing) return null;
    const f = this.frame;
    const soles = this.soles;
    contactPoints(figure.rest, rotations, -figure.groundOffset, soles, 0, figure.contacts);
    let lift = figure.groundOffset;
    if (playing.clip.grounded) {
      // A figure on its feet stands on its soles, which follow the pose without skinning.
      let low = Number.POSITIVE_INFINITY;
      for (let k = 0; k < 6; k++) low = Math.min(low, soles[k * 3 + 1] as number);
      lift = figure.groundOffset - low;
    } else if (figure.skin) {
      // One that is not (a swim) is grounded by its lowest body vertex.
      const { control, skinIndex, skinWeight, bodyVertices } = figure.skin;
      if (this.mesh.length !== control.length) this.mesh = new Float32Array(control.length);
      skinPositions(figure.rest, rotations, control, skinIndex, skinWeight, this.mesh);
      lift = groundOffsetOf(this.mesh, bodyVertices);
    }
    f.clip = playing.clip.id;
    f.time = playing.time;
    f.lift = lift;
    f.root[0] = animator.root[0];
    f.root[1] = animator.root[1];
    f.delta[0] = animator.root[0] - this.last[0];
    f.delta[1] = animator.root[1] - this.last[1];
    this.last[0] = animator.root[0];
    this.last[1] = animator.root[1];
    const ownership = animator.contactOwnership;
    for (let c = 0; c < ANIMATION_CONTACTS.length; c++) {
      const { side, point } = ANIMATION_CONTACTS[c] as (typeof ANIMATION_CONTACTS)[number];
      const sideIndex = side === "left" ? 0 : 1;
      const pointIndex = point === "heel" ? 0 : point === "ballInner" ? 1 : 2;
      // The soles are side-major (FootLock's index), the frame point-major.
      const k = sideIndex * 3 + pointIndex;
      const owner = ownership[sideIndex];
      const out = f.contacts[c] as HumanoidAnimationContact;
      out.position[0] = soles[k * 3] as number;
      // `contactPoints` measures from the rest ground plane, while a frame is
      // measured in the mesh's local coordinates after this pose's lift. Put
      // the point back in mesh space before applying that lift; otherwise the
      // rest ground offset is counted twice.
      out.position[1] = (soles[k * 3 + 1] as number) - figure.groundOffset + lift;
      out.position[2] = soles[k * 3 + 2] as number;
      out.owned = owner.index === k;
      out.hold = out.owned ? owner.hold : 0;
    }
    return f;
  }
}
