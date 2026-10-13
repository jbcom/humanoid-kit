/**
 * What a diffuse texture's alpha asks of the material: none (opaque), holes cut
 * clean through (a fishnet, lace: alpha all but 0 or 1), or a see-through
 * cloth (tights: alpha in between over much of it). Read from the texture
 * itself, because the community's materials rarely say: a fishnet's `.mhmat`
 * names no transparency at all, and its holes are only in the alpha.
 */
import sharp from "sharp";

export type AlphaUse = "opaque" | "cutout" | "sheer";

/** Below this (of 255) a texel counts as see-through. */
const SOLID = 250;
/** At or below this a texel counts as a hole. */
const HOLE = 5;
/** The share of see-through texels whose alpha lies between hole and solid that makes a cloth sheer. */
const SHEER_SHARE = 0.3;
/** The share of the texture that must be see-through for the alpha to matter at all. */
const USED_SHARE = 0.002;

/**
 * The alpha use of texels whose alpha is every `stride`-th byte from `offset`:
 * opaque when almost none is see-through, else sheer when many see-through
 * texels are only partly so, else cutout.
 */
export function alphaUseOf(alpha: Uint8Array | Buffer, stride = 1, offset = 0): AlphaUse {
  let seeThrough = 0;
  let partial = 0;
  let n = 0;
  for (let i = offset; i < alpha.length; i += stride) {
    n++;
    const a = alpha[i] as number;
    if (a >= SOLID) continue;
    seeThrough++;
    if (a > HOLE) partial++;
  }
  if (n === 0 || seeThrough / n < USED_SHARE) return "opaque";
  return partial / seeThrough > SHEER_SHARE ? "sheer" : "cutout";
}

/** A texture file's alpha use. */
export async function textureAlphaUse(file: string): Promise<AlphaUse> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return alphaUseOf(data, info.channels, info.channels - 1);
}
