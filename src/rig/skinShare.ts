import type { BoneRotations, RestBones } from "./bones.ts";

/**
 * Which skinning scheme each bone asks for (docs/ARCHITECTURE.md, "Skinning
 * artefacts"). Linear blending (0) pinches a twisted limb and dual quaternion
 * blending (1) bulges a bent joint, so each bone takes the scheme its joint
 * needs, and a vertex takes the mean of its bones' shares by weight.
 */

/**
 * Share of dual quaternion skinning by bone, left and right alike (names
 * without `.L` / `.R`); a bone not named here (spine, neck, head, face, hands'
 * fingers, toes) skins linearly. Found by `scripts/research/tune-skin-share.ts`,
 * which searches each limb's bones for the lowest cost over the joint cases of
 * `scripts/lib/skinBench.ts`; re-run it after changing the body pack's skin
 * weights or the bench.
 *
 * The arm is dual quaternion nearly throughout, since that is what removes the
 * forearm's and upper arm's candy wrapper and the shoulder's lost volume. The
 * elbow's two bones are halfway, and the shin's stay linear, because there a
 * bend's bulge outweighs what dual quaternions save. So does the thigh's lower
 * half (`upperleg02`, the skin just above the knee): at 1 the bent knee's sides
 * bulge past linear skinning's (girth 95th percentile 1.32 against 1.23 at 90°),
 * where at 0 they do not; it costs the thigh's twist some of its volume (girth
 * 5th percentile 0.83 against 0.97, linear 0.72), a motion made far less often.
 */
export const SKIN_DUAL_SHARE: Readonly<Record<string, number>> = {
  clavicle: 1,
  shoulder01: 1,
  upperarm01: 1,
  upperarm02: 1,
  lowerarm01: 0.5,
  lowerarm02: 0.5,
  wrist: 1,
  pelvis: 1,
  upperleg01: 1,
  upperleg02: 0,
  lowerleg01: 0,
  lowerleg02: 0,
  foot: 1,
};

/** One share per bone, in the rig's order (0 for a bone the table does not name). */
export function skinDualShare(
  bones: readonly string[],
  table: Readonly<Record<string, number>> = SKIN_DUAL_SHARE,
): Float32Array {
  return Float32Array.from(bones, (name) => table[name.replace(/\.[LR]$/, "")] ?? 0);
}

/** A bone whose share changes as it swings: where it ends, how far it swings to get there, and its axis. */
export interface SwingShare {
  /** The share at `degrees` of swing and beyond. */
  share: number;
  /** The swing, in degrees, at which the share has fallen (or risen) all the way. */
  degrees: number;
  /** The bone that carries on from this one (left and right alike): its head is along this bone's own axis. */
  along: string;
}

/**
 * Bones whose share depends on how far they swing, left and right alike. The
 * thigh: dual quaternion skinning bulges a flexed hip's front (girth 95th
 * percentile 1.35 at 120°, against linear skinning's 1.05), and linear blending
 * loses the hip's volume (-35‰, against -20‰); falling to a quarter by 120° of
 * swing brings the bulge to 1.12 for 4‰ of volume (-24‰). It must be the swing
 * alone: a twisted thigh, which dual quaternions keep from collapsing, does not
 * swing, so its share stays at the table's 1.
 */
export const SKIN_SWING_SHARE: Readonly<Record<string, SwingShare>> = {
  upperleg01: { share: 0.25, degrees: 120, along: "lowerleg01" },
};

/**
 * The shares of this pose: the table's (`base`, one per bone), and for each
 * bone of `SKIN_SWING_SHARE` its share moved from the table's toward the swung
 * share in proportion to its swing, which is what is left of its rotation once
 * its twist about its own axis (towards its `along` bone) is taken out. A new
 * array; `base` is not changed.
 */
export function poseShare(
  rest: RestBones,
  rotations: BoneRotations,
  base: Float32Array,
  table: Readonly<Record<string, SwingShare>> = SKIN_SWING_SHARE,
): Float32Array {
  const out = Float32Array.from(base);
  rest.names.forEach((name, b) => {
    const suffix = name.match(/\.[LR]$/)?.[0] ?? "";
    const swing = table[name.replace(/\.[LR]$/, "")];
    if (!swing) return;
    const next = rest.names.indexOf(swing.along + suffix);
    if (next < 0) return;
    const ax = (rest.heads[next * 3] as number) - (rest.heads[b * 3] as number);
    const ay = (rest.heads[next * 3 + 1] as number) - (rest.heads[b * 3 + 1] as number);
    const az = (rest.heads[next * 3 + 2] as number) - (rest.heads[b * 3 + 2] as number);
    const len = Math.hypot(ax, ay, az) || 1;
    const x = rotations[b * 4] as number;
    const y = rotations[b * 4 + 1] as number;
    const z = rotations[b * 4 + 2] as number;
    const w = rotations[b * 4 + 3] as number;
    // The twist about the axis keeps the vector part along it: (a·v) a, with w. The swing is the
    // rest, q · twist*, and its w is the product of the two parts' lengths' cosine: w·tw + (v·t).
    const along = (x * ax + y * ay + z * az) / len;
    const tn = Math.hypot(w, along) || 1;
    const tw = w / tn;
    const tv = along / tn;
    // swing = q · twist⁻¹, whose scalar part is w·tw + v·(tv a) = w·tw + along·tv.
    const swingW = Math.min(1, Math.abs(w * tw + along * tv));
    const angle = (2 * Math.acos(swingW) * 180) / Math.PI;
    const t = Math.min(1, angle / swing.degrees);
    const from = base[b] as number;
    out[b] = from + (swing.share - from) * t;
  });
  return out;
}
