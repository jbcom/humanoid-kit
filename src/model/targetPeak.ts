/**
 * Places found on the base mesh from MakeHuman's own targets: the mesh has no
 * vertex groups for nipples, ears, nose, lips or navel, but each target moves
 * exactly the feature it shapes, so the vertex a feature's target moves most is
 * that feature's most prominent point (the same reading `targetMask` makes).
 * Body-art sites and the foundation's landmarks both stand on it.
 */
import { AssetFormatError, type HumanoidAssets } from "../format/assetFormat.ts";

/** Vertices within this of x = 0 are on the midline, metres (the base mesh is mirrored exactly). */
export const MIDLINE = 1e-4;

/** A target of these assets by name; one that is not loaded is an error, never a guess. */
export function namedTarget(assets: HumanoidAssets, name: string) {
  const t = assets.targets.get(name);
  if (!t) throw new AssetFormatError(`target ${name} is needed here and is not loaded`);
  return t;
}

/**
 * The base vertex `name` moves most on `side` of the body (+1 its left, -1 its
 * right, 0 the midline), of those `among` admits (a target can move geometry
 * the body does not draw, such as the inside of the mouth).
 */
export function targetPeak(
  assets: HumanoidAssets,
  name: string,
  side: 1 | -1 | 0,
  among: (vertex: number) => boolean = () => true,
): number {
  const t = namedTarget(assets, name);
  const P = assets.positions;
  let best = -1;
  let max = 0;
  for (let i = 0; i < t.indices.length; i++) {
    const v = t.indices[i] as number;
    if (!among(v)) continue;
    const x = P[v * 3] as number;
    if (side === 0 ? Math.abs(x) > MIDLINE : Math.sign(x) !== side) continue;
    const d = Math.hypot(
      t.deltas[i * 3] as number,
      t.deltas[i * 3 + 1] as number,
      t.deltas[i * 3 + 2] as number,
    );
    if (d > max) {
      max = d;
      best = v;
    }
  }
  if (best < 0) throw new AssetFormatError(`target ${name} moves nothing on side ${side}`);
  return best;
}
