/**
 * Float rasters for the upscale pipeline (docs/evidence/upscale.md): decoding
 * and encoding through sharp, and the three resamplers it measures with. Each
 * resampler is written out here rather than taken from libvips, so its
 * behaviour is exactly what the gates reason about, and stays the same for
 * every sharp version.
 *
 * - `areaResize`: each output pixel the area-weighted mean of the source
 *   pixels it covers (a box filter of the exact footprint), the round trip's
 *   downsample.
 * - `bilinearResize`: what a GPU's linear magnification samples (pixel
 *   centres, clamped to the edge), the baseline an upscale must beat.
 * - `lanczosResize`: a separable Lanczos-3 interpolation, for upscaling.
 */
import sharp from "sharp";

/** Interleaved channels, row by row from the top, each 0..1 unless a caller says otherwise. */
export interface Raster {
  width: number;
  height: number;
  channels: number;
  data: Float32Array;
}

export const raster = (
  width: number,
  height: number,
  channels: number,
  data = new Float32Array(width * height * channels),
): Raster => {
  if (data.length !== width * height * channels)
    throw new RangeError(`${data.length} values for ${width}×${height}×${channels}`);
  return { width, height, channels, data };
};

/** Decodes an image at full precision (8 or 16 bits a channel) to 0..1, keeping its channels. */
export async function readRaster(file: string): Promise<Raster> {
  const image = sharp(file);
  const meta = await image.metadata();
  const sixteen = meta.depth === "ushort";
  const grey = (meta.channels ?? 3) <= 2;
  // sharp's pipeline is 8-bit sRGB unless told to stay in 16 bits.
  const { data, info } = await (sixteen ? image.toColourspace(grey ? "grey16" : "rgb16") : image)
    .raw({ depth: sixteen ? "ushort" : "uchar" })
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height * info.channels;
  const out = new Float32Array(n);
  if (sixteen) {
    const v = new Uint16Array(data.buffer, data.byteOffset, n);
    for (let i = 0; i < n; i++) out[i] = (v[i] as number) / 65535;
  } else for (let i = 0; i < n; i++) out[i] = (data[i] as number) / 255;
  return raster(info.width, info.height, info.channels, out);
}

/**
 * Encodes `r` as a PNG, 16 bits a channel by default (lossless, so the packer's
 * own encode is the only rounding) or 8.
 */
export async function writeRaster(r: Raster, file: string, depth: 8 | 16 = 16): Promise<void> {
  const max = depth === 16 ? 65535 : 255;
  const v = depth === 16 ? new Uint16Array(r.data.length) : new Uint8Array(r.data.length);
  for (let i = 0; i < v.length; i++)
    v[i] = Math.round(Math.min(1, Math.max(0, r.data[i] as number)) * max);
  const raw = { width: r.width, height: r.height, channels: r.channels as 1 | 2 | 3 | 4 };
  // sharp reads the sample depth from the typed array it is given.
  const image = sharp(v, { raw });
  await (depth === 16 ? image.toColourspace(r.channels <= 2 ? "grey16" : "rgb16") : image)
    .png({ compressionLevel: 9 })
    .toFile(file);
}

/** One channel of `r` as a raster of its own. */
export function channel(r: Raster, c: number): Raster {
  const out = raster(r.width, r.height, 1);
  for (let i = 0; i < r.width * r.height; i++) out.data[i] = r.data[i * r.channels + c] as number;
  return out;
}

/** 1D resampling weights: for each output index, its source indices and weights. */
interface Taps {
  start: Int32Array;
  count: Int32Array;
  index: Int32Array;
  weight: Float32Array;
}

function taps(rows: { index: number; weight: number }[][]): Taps {
  const total = rows.reduce((s, r) => s + r.length, 0);
  const t: Taps = {
    start: new Int32Array(rows.length),
    count: new Int32Array(rows.length),
    index: new Int32Array(total),
    weight: new Float32Array(total),
  };
  let k = 0;
  for (const [i, row] of rows.entries()) {
    t.start[i] = k;
    t.count[i] = row.length;
    const sum = row.reduce((s, w) => s + w.weight, 0);
    for (const w of row) {
      t.index[k] = w.index;
      t.weight[k++] = w.weight / sum;
    }
  }
  return t;
}

const clampIndex = (i: number, n: number) => Math.min(n - 1, Math.max(0, i));

function areaTaps(from: number, to: number): Taps {
  const step = from / to;
  return taps(
    Array.from({ length: to }, (_, i) => {
      const a = i * step;
      const b = (i + 1) * step;
      const row = [];
      for (let j = Math.floor(a); j < Math.ceil(b); j++) {
        const w = Math.min(b, j + 1) - Math.max(a, j);
        if (w > 1e-9) row.push({ index: j, weight: w });
      }
      return row;
    }),
  );
}

function bilinearTaps(from: number, to: number): Taps {
  return taps(
    Array.from({ length: to }, (_, i) => {
      const x = ((i + 0.5) * from) / to - 0.5;
      const j = Math.floor(x);
      const f = x - j;
      return [
        { index: clampIndex(j, from), weight: 1 - f },
        { index: clampIndex(j + 1, from), weight: f },
      ];
    }),
  );
}

const LANCZOS_A = 3;
const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (x: number) => (Math.abs(x) < LANCZOS_A ? sinc(x) * sinc(x / LANCZOS_A) : 0);

function lanczosTaps(from: number, to: number): Taps {
  if (to < from) throw new RangeError("lanczosResize only upscales; downsample with areaResize");
  return taps(
    Array.from({ length: to }, (_, i) => {
      const x = ((i + 0.5) * from) / to - 0.5;
      const row = [];
      for (let j = Math.floor(x) - LANCZOS_A + 1; j <= Math.floor(x) + LANCZOS_A; j++)
        row.push({ index: clampIndex(j, from), weight: lanczos(x - j) });
      return row;
    }),
  );
}

/** Applies `h` along rows, then `v` along columns. */
function separable(r: Raster, width: number, height: number, h: Taps, v: Taps): Raster {
  const c = r.channels;
  const mid = new Float32Array(width * r.height * c);
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < width; x++)
      for (let k = h.start[x] as number, e = k + (h.count[x] as number); k < e; k++) {
        const w = h.weight[k] as number;
        const src = (y * r.width + (h.index[k] as number)) * c;
        const dst = (y * width + x) * c;
        for (let ch = 0; ch < c; ch++)
          mid[dst + ch] = (mid[dst + ch] as number) + w * (r.data[src + ch] as number);
      }
  const out = raster(width, height, c);
  for (let y = 0; y < height; y++)
    for (let k = v.start[y] as number, e = k + (v.count[y] as number); k < e; k++) {
      const w = v.weight[k] as number;
      const row = v.index[k] as number;
      for (let x = 0; x < width; x++) {
        const src = (row * width + x) * c;
        const dst = (y * width + x) * c;
        for (let ch = 0; ch < c; ch++)
          out.data[dst + ch] = (out.data[dst + ch] as number) + w * (mid[src + ch] as number);
      }
    }
  return out;
}

/** The exact-footprint box average of `r` at `width`×`height` (a downsample). */
export const areaResize = (r: Raster, width: number, height: number) =>
  separable(r, width, height, areaTaps(r.width, width), areaTaps(r.height, height));

/** `r` magnified as a GPU's linear filter samples it, clamped to the edge. */
export const bilinearResize = (r: Raster, width: number, height: number) =>
  separable(r, width, height, bilinearTaps(r.width, width), bilinearTaps(r.height, height));

/** `r` upscaled by a separable Lanczos-3 interpolation, clamped to the edge (it can overshoot 0..1). */
export const lanczosResize = (r: Raster, width: number, height: number) =>
  separable(r, width, height, lanczosTaps(r.width, width), lanczosTaps(r.height, height));

export const linearFromSrgb = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
export const srgbFromLinear = (c: number) => {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
};
