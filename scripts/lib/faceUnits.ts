/**
 * Mirror-symmetric face units. MakeHuman authored its 60 face units (the BVH
 * frames in `poseunits/face-poseunits.bvh`) by hand, and a few are not the
 * mirror of their partner: `NasolabialDeepener` turns one nose-wing bone 7.8
 * degrees about an axis its other side leaves alone (the right of a figure
 * deepens its fold two to three millimetres more than the left), and a smile,
 * `MouthLeftPullUp` with `MouthRightPullUp`, carries a stray sideways turn of
 * the midline lip bone and two lip-corner bones that do not match. A face
 * that smiles unevenly reads as a smirk, so the packed units are made
 * symmetric here: each is the mean of its authored frame and the reflection of
 * its partner's, which favours neither side and leaves an already symmetric
 * unit exactly as it was.
 *
 * A unit's partner is the unit with `Left` and `Right` swapped in its name
 * (`LeftEyeturnRight` pairs with `RightEyeturnLeft`, `ChinLeft` with
 * `ChinRight`), itself when it has neither (`JawDrop`). A joint's partner has
 * its `.L` and `.R` swapped. Reflecting in the face's midplane keeps an X
 * rotation and negates a Y or Z rotation (an axial vector across a mirror) and
 * an X position, for every Euler order, since a reflection conjugates each
 * axis rotation separately.
 */

import { mirrorUnit } from "../../src/rig/faceMirror.ts";

export interface UnitJoint {
  name: string;
  channels: string[];
}

/** The partner of a joint across the face: `.L` and `.R` swapped, a central joint itself. */
export function mirrorJoint(name: string): string {
  if (name.endsWith(".L")) return `${name.slice(0, -2)}.R`;
  if (name.endsWith(".R")) return `${name.slice(0, -2)}.L`;
  return name;
}

/** Which channels change sign in the mirror. */
const flips = (channel: string): boolean =>
  channel === "Xposition" || channel === "Yrotation" || channel === "Zrotation";

/** The frame `frame` reflected in the face's midplane: each joint's values on its partner, signs fixed. */
export function mirrorFrame(joints: readonly UnitJoint[], frame: readonly number[]): number[] {
  const offsets = new Map<string, number>();
  let k = 0;
  for (const j of joints) {
    offsets.set(j.name, k);
    k += j.channels.length;
  }
  const out = new Array<number>(frame.length).fill(0);
  for (const j of joints) {
    const partner = mirrorJoint(j.name);
    const from = offsets.get(partner);
    const there = joints.find((p) => p.name === partner);
    if (from === undefined || !there)
      throw new Error(`face units: no joint ${partner} to mirror ${j.name}`);
    if (there.channels.join() !== j.channels.join())
      throw new Error(`face units: ${j.name} and ${partner} have different channels`);
    j.channels.forEach((c, i) => {
      const v = frame[from + i] as number;
      out[(offsets.get(j.name) as number) + i] = flips(c) ? 0 - v : v;
    });
  }
  return out;
}

/** `frames`, every unit made the mean of itself and the reflection of its partner. */
export function symmetrizeFaceUnits(
  names: readonly string[],
  joints: readonly UnitJoint[],
  frames: readonly (readonly number[])[],
): number[][] {
  return names.map((name, f) => {
    const partner = names.indexOf(mirrorUnit(name));
    if (partner < 0) throw new Error(`face units: no ${mirrorUnit(name)} to pair with ${name}`);
    const own = frames[f] as readonly number[];
    const mirrored = mirrorFrame(joints, frames[partner] as readonly number[]);
    return own.map((v, k) => (v + (mirrored[k] as number)) / 2);
  });
}
