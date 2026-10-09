/**
 * Retargeting a skeletal animation onto MakeHuman's default skeleton through a
 * T-pose on both rigs.
 *
 * The two rigs' bones have axes of their own, so a rotation cannot be copied
 * from one to the other. What is shared is a pose both can be put in: the
 * T-pose, in which a limb's direction is the same on both. A source bone's pose
 * at a frame is, in the world, a turn away from its T-pose (`Δ = W · Wt⁻¹`, the
 * world rotation now against its world rotation in the T-pose); the target bone
 * is turned the same way from its own T-pose world rotation (`Δ · Wt'`), and its
 * local rotation is what that is under its parent's turned world rotation.
 * Taking the turn in world space makes the limb's direction follow whatever the
 * bones' own axes are.
 *
 * Bones without a counterpart keep their T-pose rotation and so follow their
 * parent (a twist bone, a helper). The source's three spine bones and neck do not
 * match MakeHuman's five and three: each target bone along the spine takes the turn
 * a source bone would have at its height up the body, the two nearest source bones'
 * turns blended by how near. The source pelvis turns the pelvis bones of both legs
 * and the lowest spine bone.
 */
import { conjugate, mul, type Quat } from "../../src/rig/quat.ts";
import type { GlbAnimation, GlbRig } from "./gltf.ts";

/** What the retarget needs of the target rig. */
export interface RetargetTarget {
  bones: readonly string[];
  /** Parent index per bone, -1 for the root. */
  parents: Int16Array;
  /** Each bone's head at rest (`bones * 3`), for heights along the spine. */
  heads: Float32Array;
  /** Each bone's local rotation in the T-pose (`bones * 4`; no rotation where the T-pose leaves it at rest). */
  tpose: Float32Array;
}

/** Target bone to source joint, for bones that take a source bone's turn directly. */
export function directMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of ["L", "R"] as const) {
    const l = s.toLowerCase();
    m.set(`pelvis.${s}`, "pelvis");
    m.set(`clavicle.${s}`, `clavicle_${l}`);
    m.set(`upperarm01.${s}`, `upperarm_${l}`);
    m.set(`lowerarm01.${s}`, `lowerarm_${l}`);
    m.set(`wrist.${s}`, `hand_${l}`);
    m.set(`upperleg01.${s}`, `thigh_${l}`);
    m.set(`lowerleg01.${s}`, `calf_${l}`);
    m.set(`foot.${s}`, `foot_${l}`);
    for (let t = 1; t <= 5; t++) m.set(`toe${t}-1.${s}`, `ball_${l}`);
    // MakeHuman's finger1 is the thumb, 2 to 5 the fingers from the index to the little one.
    const fingers = ["thumb", "index", "middle", "ring", "pinky"];
    fingers.forEach((name, f) => {
      for (let k = 1; k <= 3; k++) m.set(`finger${f + 1}-${k}.${s}`, `${name}_0${k}_${l}`);
    });
  }
  return m;
}

/** The source bones up the body, and the target bones that take their turn by height. */
export const AXIAL_SOURCE = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head"];
export const AXIAL_TARGET = [
  "spine05",
  "spine04",
  "spine03",
  "spine02",
  "spine01",
  "neck01",
  "neck02",
  "neck03",
  "head",
];

function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let [bx, by, bz, bw] = b;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka = 1 - t;
  let kb = t;
  if (dot < 0.9995) {
    const angle = Math.acos(dot);
    const s = Math.sin(angle);
    ka = Math.sin((1 - t) * angle) / s;
    kb = Math.sin(t * angle) / s;
  }
  const x = ka * a[0] + kb * bx;
  const y = ka * a[1] + kb * by;
  const z = ka * a[2] + kb * bz;
  const w = ka * a[3] + kb * bw;
  const n = Math.hypot(x, y, z, w);
  return [x / n, y / n, z / n, w / n];
}

/** The source's local rotation of each joint at time `t` of `anim`: its track's, or its rest rotation. */
function sampleLocals(rig: GlbRig, anim: GlbAnimation | null, t: number): Quat[] {
  const out: Quat[] = rig.joints.map((j) => [...j.rotation] as Quat);
  if (!anim) return out;
  for (const track of anim.tracks) {
    const times = track.times;
    const last = times.length - 1;
    const at = (i: number): Quat => [
      track.rotations[i * 4] as number,
      track.rotations[i * 4 + 1] as number,
      track.rotations[i * 4 + 2] as number,
      track.rotations[i * 4 + 3] as number,
    ];
    if (t <= (times[0] as number)) out[track.joint] = at(0);
    else if (t >= (times[last] as number)) out[track.joint] = at(last);
    else {
      let i = 0;
      while ((times[i + 1] as number) < t) i++;
      const f = (t - (times[i] as number)) / ((times[i + 1] as number) - (times[i] as number));
      out[track.joint] = slerp(at(i), at(i + 1), f);
    }
  }
  return out;
}

/** The world rotations of a rig's joints for local rotations `locals` (parents before children in `order`). */
function worldRotations(parents: ArrayLike<number>, order: number[], locals: Quat[]): Quat[] {
  const world: Quat[] = [];
  for (const j of order) {
    const p = parents[j] as number;
    world[j] = p < 0 ? (locals[j] as Quat) : mul(world[p] as Quat, locals[j] as Quat);
  }
  return world;
}

function parentFirst(parents: ArrayLike<number>): number[] {
  const order: number[] = [];
  const done = new Set<number>();
  const add = (j: number) => {
    if (done.has(j)) return;
    const p = parents[j] as number;
    if (p >= 0) add(p);
    done.add(j);
    order.push(j);
  };
  for (let j = 0; j < parents.length; j++) add(j);
  return order;
}

export interface Retargeted {
  fps: number;
  frames: number;
  /** `frames × bones × 4` local rotations (x, y, z, w), over every bone of the target. */
  rotations: Float32Array;
}

/**
 * `anim` of `source` on `target`: the source's rest (its T-pose, `tposeAnim` held
 * at its first frame if given) against the target's own, one frame every `1/fps`
 * seconds from 0 to the animation's duration.
 */
export function retarget(
  source: GlbRig,
  anim: GlbAnimation,
  tposeAnim: GlbAnimation | null,
  target: RetargetTarget,
  fps: number,
): Retargeted {
  const sIndex = new Map(source.joints.map((j, i) => [j.name, i]));
  const sOrder = parentFirst(source.joints.map((j) => j.parent));
  const sParents = source.joints.map((j) => j.parent);
  const tIndex = new Map(target.bones.map((b, i) => [b, i]));
  const tOrder = parentFirst(target.parents);
  const bones = target.bones.length;
  const quatAt = (a: ArrayLike<number>, i: number): Quat => [
    a[i * 4] as number,
    a[i * 4 + 1] as number,
    a[i * 4 + 2] as number,
    a[i * 4 + 3] as number,
  ];

  // The T-pose, both sides: world rotations, and heads along the body.
  const sT = worldRotations(sParents, sOrder, sampleLocals(source, tposeAnim, 0));
  const tLocalT = Array.from({ length: bones }, (_, b) => quatAt(target.tpose, b));
  const tT = worldRotations(target.parents, tOrder, tLocalT);

  // The source's heads in its T-pose, for heights.
  const sHeadY = new Array<number>(source.joints.length).fill(0);
  {
    const world = sT;
    const pos: [number, number, number][] = [];
    for (const j of sOrder) {
      const p = source.joints[j]?.parent ?? -1;
      const joint = source.joints[j];
      if (!joint) continue;
      const t = joint.translation;
      if (p < 0) pos[j] = [t[0], t[1], t[2]];
      else {
        // The parent's world rotation turns the joint's local offset.
        const q = world[p] as Quat;
        const [x, y, z] = t;
        const tx = 2 * (q[1] * z - q[2] * y);
        const ty = 2 * (q[2] * x - q[0] * z);
        const tz = 2 * (q[0] * y - q[1] * x);
        const d: [number, number, number] = [
          x + q[3] * tx + (q[1] * tz - q[2] * ty),
          y + q[3] * ty + (q[2] * tx - q[0] * tz),
          z + q[3] * tz + (q[0] * ty - q[1] * tx),
        ];
        const pp = pos[p] as [number, number, number];
        pos[j] = [pp[0] + d[0], pp[1] + d[1], pp[2] + d[2]];
      }
      sHeadY[j] = (pos[j] as [number, number, number])[1];
    }
  }
  const axialSource = AXIAL_SOURCE.map((n) => {
    const j = sIndex.get(n);
    if (j === undefined) throw new Error(`the source has no joint ${n}`);
    return j;
  });
  const lowY = sHeadY[axialSource[0] as number] as number;
  const highY = sHeadY[axialSource[axialSource.length - 1] as number] as number;
  const sHeight = axialSource.map((j) => ((sHeadY[j] as number) - lowY) / (highY - lowY));
  const axialTarget = AXIAL_TARGET.map((n) => {
    const b = tIndex.get(n);
    if (b === undefined) throw new Error(`the target has no bone ${n}`);
    return b;
  });
  const tLow = target.heads[(axialTarget[0] as number) * 3 + 1] as number;
  const tHigh = target.heads[(axialTarget[axialTarget.length - 1] as number) * 3 + 1] as number;
  const tHeight = new Map(
    axialTarget.map((b) => [b, ((target.heads[b * 3 + 1] as number) - tLow) / (tHigh - tLow)]),
  );

  // Which source joint each target bone's turn comes from.
  const direct = new Map<number, number>();
  for (const [bone, joint] of directMap()) {
    const b = tIndex.get(bone);
    const j = sIndex.get(joint);
    if (b !== undefined && j !== undefined) direct.set(b, j);
  }

  const frames = Math.round(anim.duration * fps) + 1;
  const rotations = new Float32Array(frames * bones * 4);
  for (let f = 0; f < frames; f++) {
    const sW = worldRotations(sParents, sOrder, sampleLocals(source, anim, f / fps));
    const turn = (j: number): Quat => mul(sW[j] as Quat, conjugate(sT[j] as Quat));
    const world: Quat[] = [];
    for (const b of tOrder) {
      const p = target.parents[b] as number;
      let w: Quat;
      let d: Quat | null = null;
      const j = direct.get(b);
      if (j !== undefined) d = turn(j);
      else if (tHeight.has(b)) {
        // Along the spine: the two source bones around this height, by how near.
        const h = tHeight.get(b) as number;
        let i = 0;
        while (i < sHeight.length - 2 && (sHeight[i + 1] as number) < h) i++;
        const span = (sHeight[i + 1] as number) - (sHeight[i] as number);
        const t = span > 1e-9 ? Math.min(1, Math.max(0, (h - (sHeight[i] as number)) / span)) : 0;
        d = slerp(turn(axialSource[i] as number), turn(axialSource[i + 1] as number), t);
      }
      if (d) w = mul(d, tT[b] as Quat);
      else w = p < 0 ? (tLocalT[b] as Quat) : mul(world[p] as Quat, tLocalT[b] as Quat);
      world[b] = w;
      const local = p < 0 ? w : mul(conjugate(world[p] as Quat), w);
      rotations.set(local, (f * bones + b) * 4);
    }
  }
  return { fps, frames, rotations };
}
