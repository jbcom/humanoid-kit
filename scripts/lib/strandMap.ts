/**
 * Turns a hair atlas into a strand map: the atlas's luminance, normalised, with
 * its alpha untouched.
 *
 * The MakeHuman system hair atlases are painted in colour (brown, silver,
 * auburn, black). The recipe sets the colour from a pigment model instead
 * (`src/surface/hairTone.ts`), so what the texture must keep is only
 * strand-scale structure: which texels are brighter than their neighbours,
 * where the roots darken. Multiplying a coloured atlas by a tint cannot make
 * dark hair blond and carries the atlas's own hue into every colour, so the
 * packer replaces the colour with luminance scaled to a fixed mean
 * (`HAIR_STRAND_MEAN`), and the material multiplies by `hairTint`, the albedo
 * divided by that mean.
 *
 * The packer also measures the strands' direction and how consistent it is (a
 * structure tensor over the luminance, inside the opaque texels), which the
 * renderer uses to stretch highlights across the strands.
 */
import { HAIR_STRAND_MEAN } from "../../src/surface/hairTone.ts";

export interface StrandMap {
  /** Grey strand map with the source's alpha: RGBA, 8 bits. */
  rgba: Uint8Array;
  /** What the linear luminance was multiplied by to reach `HAIR_STRAND_MEAN`. */
  gain: number;
  /** The atlas's alpha-weighted mean linear luminance, before the gain. */
  sourceMean: number;
  /** Strand direction in texture space, radians from U toward V, in [0, π). */
  strandAngle: number;
  /** 0 = no preferred direction (fluffy, curly), 1 = parallel strands. */
  coherence: number;
}

const LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const s = i / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});

const srgb8 = (l: number) => {
  const c = Math.min(1, Math.max(0, l));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
};

export interface StrandMapOptions {
  /**
   * Divide out the atlas's coarse shading: a gaussian of this sigma (a fraction of
   * the longer edge) is blurred over the opaque texels, and every texel is divided
   * by it. The atlas's own blotches (a painted-in dark patch, a lighter cell) are
   * lighting the model bakes in, and the renderer lights the hair itself, so they
   * read as a net or as dirt; the strand-scale structure is what remains. Alpha is
   * untouched, and the blur is weighted by alpha, so clear texels (the atlas's
   * backdrop) contribute nothing and a card is flattened by its own texels; cards
   * closer together than three sigma still share some. Absent, the atlas's shading
   * is kept.
   */
  flatten?: number;
}

/** A gaussian kernel of the given sigma (in texels), normalised, radius 3 sigma. */
const gaussian = (sigma: number) => {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = w;
    total += w;
  }
  for (let i = 0; i < k.length; i++) k[i] = (k[i] as number) / total;
  return k;
};

/** A separable gaussian blur of a single-channel image; the edge repeats. */
function blur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const k = gaussian(sigma);
  const r = (k.length - 1) / 2;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++)
        s +=
          (k[i + r] as number) *
          (src[y * width + Math.min(width - 1, Math.max(0, x + i))] as number);
      tmp[y * width + x] = s;
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++)
        s +=
          (k[i + r] as number) *
          (tmp[Math.min(height - 1, Math.max(0, y + i)) * width + x] as number);
      out[y * width + x] = s;
    }
  return out;
}

/**
 * Luminance with its coarse shading divided out, rescaled to the same
 * alpha-weighted mean. Texels with no alpha are left as they were.
 */
function flattened(
  luminance: Float32Array,
  alpha: Float32Array,
  width: number,
  height: number,
  sigma: number,
  mean: number,
): Float32Array {
  const weighted = new Float32Array(luminance.length);
  for (let i = 0; i < weighted.length; i++)
    weighted[i] = (luminance[i] as number) * (alpha[i] as number);
  const num = blur(weighted, width, height, sigma);
  const den = blur(alpha, width, height, sigma);
  const out = new Float32Array(luminance.length);
  // A floor keeps a texel in a near-black patch from being amplified without limit.
  const floor = 0.05 * mean;
  for (let i = 0; i < out.length; i++) {
    const d = den[i] as number;
    const low = d > 1e-4 ? (num[i] as number) / d : mean;
    out[i] =
      (alpha[i] as number) === 0
        ? (luminance[i] as number)
        : (luminance[i] as number) * (mean / Math.max(low, floor));
  }
  return out;
}

export function strandMapFromRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: StrandMapOptions = {},
): StrandMap {
  const count = width * height;
  if (rgba.length !== count * 4)
    throw new Error(`strand map: ${rgba.length} bytes is not a ${width}x${height} RGBA image`);
  let luminance: Float32Array = new Float32Array(count);
  const alphas = new Float32Array(count);
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < count; i++) {
    const y =
      0.2126 * (LINEAR[rgba[i * 4] as number] as number) +
      0.7152 * (LINEAR[rgba[i * 4 + 1] as number] as number) +
      0.0722 * (LINEAR[rgba[i * 4 + 2] as number] as number);
    luminance[i] = y;
    const a = (rgba[i * 4 + 3] as number) / 255;
    alphas[i] = a;
    sum += y * a;
    weight += a;
  }
  if (weight === 0) throw new Error("strand map: the atlas has no opaque texel");
  if (options.flatten !== undefined)
    luminance = flattened(
      luminance,
      alphas,
      width,
      height,
      options.flatten * Math.max(width, height),
      sum / weight,
    );
  sum = 0;
  for (let i = 0; i < count; i++) sum += (luminance[i] as number) * (alphas[i] as number);
  const sourceMean = sum / weight;
  // The gain that makes the *clipped* map average HAIR_STRAND_MEAN. A dark atlas's
  // bright strands clip at white, so the plain ratio would leave the map darker than
  // the tint assumes; the clipped mean rises with the gain, so bisection finds it.
  const clippedMean = (gain: number) => {
    let s = 0;
    for (let i = 0; i < count; i++)
      s += Math.min(1, (luminance[i] as number) * gain) * ((rgba[i * 4 + 3] as number) / 255);
    return s / weight;
  };
  let lo = HAIR_STRAND_MEAN / sourceMean;
  let hi = lo;
  while (clippedMean(hi) < HAIR_STRAND_MEAN && hi < 1e6) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (clippedMean(mid) < HAIR_STRAND_MEAN) lo = mid;
    else hi = mid;
  }
  const gain = (lo + hi) / 2;

  const out = new Uint8Array(count * 4);
  const grey = new Float32Array(count);
  // Texels with no alpha carry the map's mean grey, so filtering across a
  // card's edge blends toward a neutral colour rather than the atlas's backdrop.
  const clear = srgb8(HAIR_STRAND_MEAN);
  for (let i = 0; i < count; i++) {
    const a = rgba[i * 4 + 3] as number;
    const g = a === 0 ? clear : srgb8((luminance[i] as number) * gain);
    out[i * 4] = g;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = g;
    out[i * 4 + 3] = a;
    grey[i] = g / 255;
  }

  // Structure tensor of the (perceptual) grey, over texels whose neighbours are
  // opaque too, so a card's edge does not read as a strand boundary. V points up
  // the texture, so rows are flipped.
  let jxx = 0;
  let jxy = 0;
  let jyy = 0;
  const alpha = (x: number, y: number) => (rgba[(y * width + x) * 4 + 3] as number) / 255;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const w = alpha(x, y) * alpha(x - 1, y) * alpha(x + 1, y) * alpha(x, y - 1) * alpha(x, y + 1);
      if (w === 0) continue;
      const gx = ((grey[y * width + x + 1] as number) - (grey[y * width + x - 1] as number)) / 2;
      const gy =
        ((grey[(y - 1) * width + x] as number) - (grey[(y + 1) * width + x] as number)) / 2;
      jxx += w * gx * gx;
      jxy += w * gx * gy;
      jyy += w * gy * gy;
    }
  }
  const energy = jxx + jyy;
  // The gradient points across the strands; the strands run perpendicular to it.
  const across = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
  const strandAngle = (((across + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI;
  const coherence = energy > 0 ? Math.hypot(jxx - jyy, 2 * jxy) / energy : 0;
  return { rgba: out, gain, sourceMean, strandAngle, coherence };
}
