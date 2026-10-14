/**
 * Runtime skin-weight quality policy. Source assets always remain eight-wide;
 * lower qualities project each row into the same eight-wide representation so
 * every CPU and GPU consumer still reads the identical layout.
 */
import { SKIN_INFLUENCES } from "../format/assetFormat.ts";

/** Number of source skin influences retained for each runtime vertex. */
export type SkinInfluences = 4 | 5 | 6 | 7 | 8;

export interface SkinWeights<T extends Uint8Array | Uint16Array = Uint8Array | Uint16Array> {
  skinIndex: T;
  skinWeight: Float32Array;
}

/** Full MakeHuman fidelity is the default; quality is always chosen explicitly for a model. */
export const DEFAULT_SKIN_INFLUENCES: SkinInfluences = SKIN_INFLUENCES;

function assertSkinInfluences(value: number): asserts value is SkinInfluences {
  if (!Number.isInteger(value) || value < 4 || value > SKIN_INFLUENCES)
    throw new RangeError(
      `skinInfluences must be an integer from 4 to ${SKIN_INFLUENCES}; got ${value}`,
    );
}

/**
 * Retains a vertex's heaviest source influences and renormalises them. The
 * returned arrays remain eight-wide, with dropped places zeroed, so callers do
 * not silently disagree about a vertex's pose. At quality 8 the raw pack views
 * are returned unchanged.
 */
export function projectSkinInfluences<T extends Uint8Array | Uint16Array>(
  skin: SkinWeights<T>,
  skinInfluences: SkinInfluences = DEFAULT_SKIN_INFLUENCES,
): SkinWeights<T> {
  assertSkinInfluences(skinInfluences);
  if (skin.skinIndex.length !== skin.skinWeight.length)
    throw new RangeError("skin index and weight lengths must match");
  if (skin.skinWeight.length % SKIN_INFLUENCES !== 0)
    throw new RangeError(`skin weights must be ${SKIN_INFLUENCES}-wide per vertex`);
  if (skinInfluences === SKIN_INFLUENCES) return skin;

  const skinIndex =
    skin.skinIndex instanceof Uint8Array
      ? new Uint8Array(skin.skinIndex.length)
      : new Uint16Array(skin.skinIndex.length);
  const skinWeight = new Float32Array(skin.skinWeight.length);
  for (let vertex = 0; vertex < skinWeight.length / SKIN_INFLUENCES; vertex++) {
    const start = vertex * SKIN_INFLUENCES;
    const retained = Array.from({ length: SKIN_INFLUENCES }, (_, place) => place)
      .filter((place) => (skin.skinWeight[start + place] as number) > 0)
      .sort(
        (a, b) => (skin.skinWeight[start + b] as number) - (skin.skinWeight[start + a] as number),
      )
      .slice(0, skinInfluences);
    let total = 0;
    for (const place of retained) total += skin.skinWeight[start + place] as number;
    for (const [out, place] of retained.entries()) {
      skinIndex[start + out] = skin.skinIndex[start + place] as number;
      skinWeight[start + out] = total ? (skin.skinWeight[start + place] as number) / total : 0;
    }
  }
  return { skinIndex: skinIndex as T, skinWeight };
}
