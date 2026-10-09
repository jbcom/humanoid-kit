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
 * bend's bulge outweighs what dual quaternions save.
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
  upperleg02: 1,
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
