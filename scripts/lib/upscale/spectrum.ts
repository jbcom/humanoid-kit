/**
 * How much of an image's energy lies at spatial frequencies its source could
 * not hold: the "no new features" gate's measure (docs/evidence/upscale.md).
 *
 * The image is Hann-windowed (so its edges do not leak into every
 * frequency), transformed by a 2D FFT channel by channel, and its power split
 * at the source's Nyquist frequency: a component finer than the source's
 * texel pitch along either axis is detail the source did not have.
 */
import type { Raster } from "./raster.ts";

/** In-place iterative radix-2 FFT of `n` complex values (`n` a power of two). */
function fft(re: Float64Array, im: Float64Array, n: number) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a);
    const wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k;
        const q = p + len / 2;
        const tr = (re[q] as number) * cr - (im[q] as number) * ci;
        const ti = (re[q] as number) * ci + (im[q] as number) * cr;
        re[q] = (re[p] as number) - tr;
        im[q] = (im[p] as number) - ti;
        re[p] = (re[p] as number) + tr;
        im[p] = (im[p] as number) + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const pow2AtLeast = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/**
 * Mean power per value (the windowed variance) below which an image counts as
 * flat: a deviation of 1e-6, far below one level of a 16-bit encode.
 */
const POWERLESS = 1e-12;

/**
 * The share of `r`'s windowed power (its mean removed, every channel) at
 * frequencies above `source`'s Nyquist along either axis, where `source` is
 * the size it was upscaled from. `weight`, if given, picks the channels and
 * texels that count (one value per texel, 0..1, applied before the window).
 */
export function aboveBandShare(
  r: Raster,
  source: { width: number; height: number },
  weight?: Float32Array,
): number {
  const p = bandPowers(r, source, weight);
  // A flat image has no power to split: its share would be a ratio of rounding noise.
  return p.total > POWERLESS ? p.high / p.total : 0;
}

/**
 * `r`'s windowed power per value (its mean removed, every channel; Parseval's
 * normalisation, so a variance), in all and above `source`'s Nyquist.
 */
export function bandPowers(
  r: Raster,
  source: { width: number; height: number },
  weight?: Float32Array,
): { high: number; total: number } {
  const { width: w, height: h, channels: c } = r;
  // Any size: the windowed image is zero-padded to the next power of two.
  const W = pow2AtLeast(w);
  const H = pow2AtLeast(h);
  const hann = (n: number) =>
    Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n));
  const wx = hann(w);
  const wy = hann(h);
  // A bin is above the source's Nyquist when its frequency, in cycles per
  // texel of the image, exceeds half the source's texels per image texel.
  const above = (k: number, n: number, s: number, size: number) =>
    Math.min(k, n - k) / n > (0.5 * s) / size;
  let total = 0;
  let high = 0;
  const re = new Float64Array(W * H);
  const im = new Float64Array(W * H);
  const lineRe = new Float64Array(Math.max(W, H));
  const lineIm = new Float64Array(Math.max(W, H));
  for (let ch = 0; ch < c; ch++) {
    let mean = 0;
    let wsum = 0;
    for (let i = 0; i < w * h; i++) {
      const wt = weight ? (weight[i] as number) : 1;
      mean += wt * (r.data[i * c + ch] as number);
      wsum += wt;
    }
    mean /= Math.max(1e-12, wsum);
    re.fill(0);
    im.fill(0);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const wt = weight ? (weight[i] as number) : 1;
        re[y * W + x] =
          ((r.data[i * c + ch] as number) - mean) * wt * (wx[x] as number) * (wy[y] as number);
      }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < W; x++) {
        lineRe[x] = re[y * W + x] as number;
        lineIm[x] = im[y * W + x] as number;
      }
      fft(lineRe, lineIm, W);
      for (let x = 0; x < W; x++) {
        re[y * W + x] = lineRe[x] as number;
        im[y * W + x] = lineIm[x] as number;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        lineRe[y] = re[y * W + x] as number;
        lineIm[y] = im[y * W + x] as number;
      }
      fft(lineRe, lineIm, H);
      const hiX = above(x, W, source.width, w);
      for (let y = 0; y < H; y++) {
        const p = (lineRe[y] as number) ** 2 + (lineIm[y] as number) ** 2;
        total += p;
        if (hiX || above(y, H, source.height, h)) high += p;
      }
    }
  }
  // By Parseval, the padded transform's power is W·H times the image's.
  const norm = W * H * w * h * c;
  return { high: high / norm, total: total / norm };
}

/** Edge of the tiles `tilePowers` splits an image into, output texels. */
export const TILE = 32;

/**
 * `bandPowers` of each `TILE`² tile of `r` (whole tiles only, row by row), so
 * a local artefact is not diluted by the rest of the image. A tile with less
 * than half its `weight` gets NaN for both.
 */
export function tilePowers(
  r: Raster,
  source: { width: number; height: number },
  weight?: Float32Array,
): { high: Float64Array; total: Float64Array } {
  const cols = Math.floor(r.width / TILE);
  const rows = Math.floor(r.height / TILE);
  const high = new Float64Array(cols * rows);
  const total = new Float64Array(cols * rows);
  const tile: Raster = {
    width: TILE,
    height: TILE,
    channels: r.channels,
    data: new Float32Array(TILE * TILE * r.channels),
  };
  const tw = new Float32Array(TILE * TILE);
  const tileSource = {
    width: (TILE * source.width) / r.width,
    height: (TILE * source.height) / r.height,
  };
  for (let ty = 0; ty < rows; ty++)
    for (let tx = 0; tx < cols; tx++) {
      let wsum = 0;
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const i = (ty * TILE + y) * r.width + tx * TILE + x;
          const j = y * TILE + x;
          for (let k = 0; k < r.channels; k++)
            tile.data[j * r.channels + k] = r.data[i * r.channels + k] as number;
          tw[j] = weight ? (weight[i] as number) : 1;
          wsum += tw[j] as number;
        }
      const p =
        wsum < (TILE * TILE) / 2
          ? { high: Number.NaN, total: Number.NaN }
          : bandPowers(tile, tileSource, weight && tw);
      high[ty * cols + tx] = p.high;
      total[ty * cols + tx] = p.total;
    }
  return { high, total };
}
