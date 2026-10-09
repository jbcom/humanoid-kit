/**
 * Joint flexion as skin-state signals (docs/ARCHITECTURE.md, "Skin states"):
 * how far each hinge joint is bent in a pose, 0 straight and 1 at its
 * anatomical limit, named `flex.<joint>.<side>`. Measured from straight, not
 * from the rest pose, because skin creases follow the true joint angle and
 * pose libraries rest differently: MakeHuman's A-pose already bends each elbow
 * about 43° forward (about 0.3), which a T-pose straightens to 0. Crease
 * layers read them: the inside of the bend folds as the joint bends.
 *
 * A joint is three bones: the segment above it, the joint, and the bone that
 * starts the segment below. Its bend is the signed angle between the two
 * segments about the hinge axis, which is perpendicular to the upper segment
 * and to the way the joint flexes (at rest), and travels with the bone above
 * the joint so it stays the hinge in any pose.
 *
 * Not the MakeHuman roll planes: in the rest A-pose the arm lies in the
 * frontal plane, so the elbow's roll-plane normal points forward, and turning
 * about it swings the forearm sideways instead of flexing it (measured: a
 * 90° turn moved the wrist 1 cm forward). MakeHuman's rigging benchmark bends
 * hips, shoulders and feet but leaves knees and elbows straight, so the tests
 * flex the joints directly.
 */
import { type BoneRotations, posedBones, type RestBones, rotateByBone } from "./pose.ts";

export interface FlexionJoint {
  /** Signal name: `flex.<name>`. */
  name: string;
  /** Bones whose heads are the segment above, the joint, and the end of the segment below. */
  above: string;
  joint: string;
  below: string;
  /** Flexion range, degrees from straight (anatomical limits). */
  range: number;
  /**
   * Which way the lower segment's end moves, in the figure's frame (Y up,
   * facing +Z, its left at +X), when the joint starts to flex from rest. It
   * orients the hinge axis, so flexion reads positive whichever way the roll
   * plane's normal happens to point.
   */
  flexes: readonly [number, number, number];
}

type JointSpec = Omit<FlexionJoint, "name" | "above" | "joint" | "below" | "flexes"> & {
  name: string;
  above: string;
  joint: string;
  below: string;
  /** The flex direction on the figure's left; mirrored in X for the right. */
  flexesLeft: readonly [number, number, number];
};

const sides = ({ flexesLeft, ...j }: JointSpec): FlexionJoint[] =>
  (["L", "R"] as const).map((s) => ({
    ...j,
    name: `${j.name}.${s}`,
    above: `${j.above}.${s}`,
    joint: `${j.joint}.${s}`,
    below: `${j.below}.${s}`,
    flexes: s === "L" ? flexesLeft : [-flexesLeft[0], flexesLeft[1], flexesLeft[2]],
  }));

/**
 * Elbows (145°: the forearm comes forward), knees (140°: the shin swings
 * back) and wrists (70°: the hand turns toward the palm, which faces the thigh
 * at rest), each side.
 */
export const FLEXION_JOINTS: readonly FlexionJoint[] = [
  ...sides({
    name: "elbow",
    above: "upperarm01",
    joint: "lowerarm01",
    below: "wrist",
    range: 145,
    flexesLeft: [0, 0, 1],
  }),
  ...sides({
    name: "knee",
    above: "upperleg01",
    joint: "lowerleg01",
    below: "foot",
    range: 140,
    flexesLeft: [0, 0, -1],
  }),
  ...sides({
    name: "wrist",
    above: "lowerarm01",
    joint: "wrist",
    below: "finger3-1",
    range: 70,
    flexesLeft: [-1, 0, 0],
  }),
];

export interface FlexionRig {
  joints: readonly FlexionJoint[];
  /** Per joint: bone indices (above, joint, below) and the hinge axis at rest. */
  bones: Int16Array;
  hinges: Float32Array;
}

const sub = (h: Float32Array, a: number, b: number): [number, number, number] => [
  (h[b * 3] as number) - (h[a * 3] as number),
  (h[b * 3 + 1] as number) - (h[a * 3 + 1] as number),
  (h[b * 3 + 2] as number) - (h[a * 3 + 2] as number),
];
const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
  (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
  (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
];
const dot = (a: readonly number[], b: readonly number[]) =>
  (a[0] as number) * (b[0] as number) +
  (a[1] as number) * (b[1] as number) +
  (a[2] as number) * (b[2] as number);
const normalize = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Signed angle (radians) from `a` to `b` about `axis`. */
const bend = (a: readonly number[], b: readonly number[], axis: readonly number[]) =>
  Math.atan2(dot(cross(a, b), axis), dot(a, b));

/**
 * Prepares flexion for a figure's rest skeleton: each joint's hinge,
 * perpendicular to the upper segment and to its flex direction, so turning
 * the lower segment about it moves the end the way the joint flexes.
 */
export function flexionRig(
  rest: RestBones,
  joints: readonly FlexionJoint[] = FLEXION_JOINTS,
): FlexionRig {
  const index = (name: string) => {
    const i = rest.names.indexOf(name);
    if (i < 0) throw new Error(`flexion: no bone ${name}`);
    return i;
  };
  const bones = new Int16Array(joints.length * 3);
  const hinges = new Float32Array(joints.length * 3);
  joints.forEach((j, k) => {
    const [a, m, b] = [index(j.above), index(j.joint), index(j.below)];
    bones.set([a, m, b], k * 3);
    hinges.set(normalize(cross(sub(rest.heads, a, m), j.flexes)), k * 3);
  });
  return { joints, bones, hinges };
}

/** Each joint's flexion in the pose: 0 straight (or over-extended) to 1 at its limit. */
export function jointFlexion(
  rig: FlexionRig,
  rest: RestBones,
  rotations: BoneRotations,
): Record<string, number> {
  const { world, heads } = posedBones(rest, rotations);
  const out: Record<string, number> = {};
  rig.joints.forEach((j, k) => {
    const [a, m, b] = [
      rig.bones[k * 3] as number,
      rig.bones[k * 3 + 1] as number,
      rig.bones[k * 3 + 2] as number,
    ];
    // The hinge travels with the bone directly above the joint.
    const hinge = rotateByBone(world, rest.parents[m] as number, [
      rig.hinges[k * 3] as number,
      rig.hinges[k * 3 + 1] as number,
      rig.hinges[k * 3 + 2] as number,
    ]);
    const angle = bend(sub(heads, a, m), sub(heads, m, b), hinge);
    out[`flex.${j.name}`] = Math.min(1, Math.max(0, (angle * 180) / Math.PI / j.range));
  });
  return out;
}
