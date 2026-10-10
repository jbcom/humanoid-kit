/**
 * The gates an upscaled texture must pass to count as inventing nothing
 * (docs/evidence/upscale.md):
 *
 * - **Round trip.** Area-downsampled back to the source's size, it must match
 *   the source. For albedo: mean CIEDE2000 < 1 and 99th percentile < 3 over the
 *   opaque texels, and the same in every skin-tone bucket (ITA°) that holds
 *   enough texels, so a dark tone is judged on its own texels rather than
 *   averaged into the light ones (texels that are no skin tone, `SKIN_L_MIN`,
 *   count in the total only); and in every such bucket the mean luminance
 *   may shift by less than 1% and the mean a*b* by less than 0.5, a bias test
 *   that is equally strict at every tone (`BucketRoundTrip`). For coverage:
 *   mean |Δα| < 0.01, p99 < 0.05.
 *   For normals: mean angle < 1°, p99 < 3°.
 * - **No new features.** Detail finer than the source can hold is what an
 *   upscale invents. It is measured as the share of the result's power at
 *   frequencies above the source's Nyquist (`aboveBandShare`), and may exceed
 *   a Lanczos-3 interpolation's share (its own imaging) by at most one
 *   percentage point over the whole image; and in its 99th-percentile 32-texel
 *   tile, the excess above-band power may be at most 20% of the image's mean
 *   tile power, so a local artefact cannot hide in the average. A coverage
 *   mask may gain no connected region and no hole.
 *
 * Passing says an upscale invents nothing, not that it is worth its texels:
 * whether a method is closer to a larger original than the GPU's own
 * magnification is measured on held-out originals
 * (scripts/research/upscale-eval.ts).
 */
import { deltaE2000, type Lab, labFromLinear } from "../../../e2e/lib/colour.ts";
import { areaResizeNormal, slopesOf } from "./methods.ts";
import {
  areaResize,
  bilinearResize,
  lanczosResize,
  linearFromSrgb,
  type Raster,
  raster,
} from "./raster.ts";
import { aboveBandShare, tilePowers } from "./spectrum.ts";

export const ROUND_TRIP = {
  albedo: { mean: 1, p99: 3 },
  coverage: { mean: 0.01, p99: 0.05 },
  normal: { mean: 1, p99: 3 },
} as const;
/**
 * How far an upscale's share of power above the source's Nyquist may exceed a
 * Lanczos-3 interpolation's.
 */
export const NEW_DETAIL_SHARE = 0.01;
/**
 * The 99th-percentile 32-texel tile's above-band power beyond the reference's,
 * as a share of the image's mean tile power: a local artefact's bar. Set
 * against ground truth (docs/evidence/upscale.md): on the 22 skins upscaled ×4
 * from a quarter of their size, every result scoring 0.113 or less was at
 * least as close to the original as the GPU's bilinear, and every one scoring
 * 0.33 or more (two graphic-edged textures under Lanczos, every Real-ESRGAN
 * result) was further from it.
 */
export const LOCAL_DETAIL_SHARE = 0.2;
/** The variance of 8-bit rounding, (1/255)²/12: power below it is no pattern. */
export const QUANTISATION_NOISE = 1 / (255 * 255 * 12);
/** A tone bucket with fewer opaque texels than this is reported but not gated. */
export const BUCKET_MIN_TEXELS = 1000;
/** Texels with less coverage than this are not colour (a cut-out's clear part). */
const OPAQUE = 0.5;

/**
 * Skin-tone buckets by individual typology angle, ITA° = atan((L* − 50) / b*)
 * (Chardon et al. 1991; Del Bino et al. 2006), lightest first, and a last
 * bucket for what is not a skin tone at all.
 */
export const TONE_BUCKETS = [
  { name: "very light", min: 55 },
  { name: "light", min: 41 },
  { name: "intermediate", min: 28 },
  { name: "tan", min: 10 },
  { name: "brown", min: -30 },
  { name: "dark", min: -Infinity },
  { name: "not skin", min: Number.NaN },
] as const;
export type ToneBucket = (typeof TONE_BUCKETS)[number]["name"];

/**
 * Below this lightness no skin is (the kit's deepest anchor is L* 30 at ITA
 * −75°, src/surface/skinTone.ts), and skin always leans yellow (b* > 0): ITA
 * means nothing for a painted black line, a grey or a blue, which would
 * otherwise land in "dark" and judge dark skin by texels that are not skin.
 */
export const SKIN_L_MIN = 20;

export const ita = ([L, , b]: Lab) => (Math.atan2(L - 50, b) * 180) / Math.PI;
export const toneBucket = (lab: Lab): ToneBucket =>
  lab[0] < SKIN_L_MIN || lab[2] <= 0
    ? "not skin"
    : (TONE_BUCKETS.find((t) => ita(lab) > t.min) ?? TONE_BUCKETS[5]).name;

export interface Stat {
  n: number;
  mean: number;
  p99: number;
}

function stat(values: number[]): Stat {
  if (!values.length) return { n: 0, mean: 0, p99: 0 };
  const sorted = Float64Array.from(values).sort();
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    n: values.length,
    mean,
    p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] as number,
  };
}

const within = (s: Stat, limit: { mean: number; p99: number }) =>
  s.mean < limit.mean && s.p99 < limit.p99;

const alphaOf = (r: Raster, i: number) =>
  r.channels === 4
    ? (r.data[i * 4 + 3] as number)
    : r.channels === 2
      ? (r.data[i * 2 + 1] as number)
      : 1;

/** Linear RGB per texel of an sRGB raster, premultiplied by its alpha, with the alpha. */
function linearPremultiplied(r: Raster): Raster {
  const out = raster(r.width, r.height, 4);
  for (let i = 0; i < r.width * r.height; i++) {
    const a = alphaOf(r, i);
    for (let k = 0; k < 3; k++)
      out.data[i * 4 + k] = linearFromSrgb(r.data[i * r.channels + k] as number) * a;
    out.data[i * 4 + 3] = a;
  }
  return out;
}

const labAt = (premultiplied: Raster, i: number): Lab => {
  const a = Math.max(1e-6, premultiplied.data[i * 4 + 3] as number);
  return labFromLinear([
    (premultiplied.data[i * 4] as number) / a,
    (premultiplied.data[i * 4 + 1] as number) / a,
    (premultiplied.data[i * 4 + 2] as number) / a,
  ]);
};

/**
 * A tone bucket's round trip: its CIEDE2000 spread, and its bias, which is
 * tone-neutral where CIEDE2000 is not. CIEDE2000 weighs a lightness difference
 * less the further it lies from L* 50, so a 10% darkening of deep skin (L* 20)
 * scores 0.9 while the same darkening of light skin scores about 1.9: the
 * mean-ΔE gate alone would let a dark tone drift twice as far. The bias gate
 * judges every tone by the same relative change.
 */
export interface BucketRoundTrip extends Stat {
  /** Relative shift of the bucket's mean luminance, Y_back / Y_source − 1. */
  luminanceBias: number;
  /** Shift of the bucket's mean a*, b* (CIELAB units). */
  chromaBias: number;
}

/** Most a tone bucket's mean luminance may shift, relatively, and its mean a*b*, in CIELAB units. */
export const BIAS = { luminance: 0.01, chroma: 0.5 } as const;

export interface AlbedoRoundTrip extends Stat {
  /** By the source texel's tone bucket. */
  buckets: Record<ToneBucket, BucketRoundTrip>;
  pass: boolean;
}

const luminance = (p: Raster, i: number) =>
  0.2126 * (p.data[i * 4] as number) +
  0.7152 * (p.data[i * 4 + 1] as number) +
  0.0722 * (p.data[i * 4 + 2] as number);

/** The albedo round trip: `output` box-averaged (in linear light) to `source`'s size, against it. */
export function roundTripAlbedo(source: Raster, output: Raster): AlbedoRoundTrip {
  const src = linearPremultiplied(source);
  const back = areaResize(linearPremultiplied(output), source.width, source.height);
  const all: number[] = [];
  const by = new Map(
    TONE_BUCKETS.map((t) => [t.name, { d: [] as number[], ys: 0, yb: 0, da: 0, db: 0 }]),
  );
  for (let i = 0; i < source.width * source.height; i++) {
    if ((src.data[i * 4 + 3] as number) < OPAQUE) continue;
    const s = labAt(src, i);
    const b = labAt(back, i);
    const d = deltaE2000(s, b);
    all.push(d);
    const bucket = by.get(toneBucket(s));
    if (!bucket) continue;
    bucket.d.push(d);
    bucket.ys += luminance(src, i);
    bucket.yb += luminance(back, i);
    bucket.da += b[1] - s[1];
    bucket.db += b[2] - s[2];
  }
  const buckets = Object.fromEntries(
    [...by].map(([k, v]) => [
      k,
      {
        ...stat(v.d),
        luminanceBias: v.ys > 0 ? v.yb / v.ys - 1 : 0,
        chromaBias: v.d.length ? Math.hypot(v.da, v.db) / v.d.length : 0,
      },
    ]),
  ) as Record<ToneBucket, BucketRoundTrip>;
  const total = stat(all);
  const fair = (b: BucketRoundTrip) =>
    within(b, ROUND_TRIP.albedo) &&
    Math.abs(b.luminanceBias) < BIAS.luminance &&
    b.chromaBias < BIAS.chroma;
  // Every skin tone is held to the bar on its own; what is not skin counts in the total.
  const pass =
    within(total, ROUND_TRIP.albedo) &&
    Object.entries(buckets).every(
      ([k, b]) => k === "not skin" || b.n < BUCKET_MIN_TEXELS || fair(b),
    );
  return { ...total, buckets, pass };
}

/** 8-connected regions of `on` texels and 4-connected regions of `off` texels not touching the border. */
export function topology(mask: Raster, threshold = 0.5) {
  const { width: w, height: h } = mask;
  const on = (i: number) => (mask.data[i * mask.channels] as number) >= threshold;
  const seen = new Uint8Array(w * h);
  let regions = 0;
  let holes = 0;
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start]) continue;
    const fg = on(start);
    let border = false;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (!fg && dx && dy)) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (seen[j] || on(j) !== fg) continue;
          seen[j] = 1;
          stack.push(j);
        }
    }
    if (fg) regions++;
    else if (!border) holes++;
  }
  return { regions, holes };
}

export interface CoverageRoundTrip extends Stat {
  source: { regions: number; holes: number };
  output: { regions: number; holes: number };
  /** No region and no hole the source lacks. */
  noNewFeatures: boolean;
  pass: boolean;
}

/** The coverage round trip and its topology: one channel each. */
export function roundTripCoverage(source: Raster, output: Raster): CoverageRoundTrip {
  const back = areaResize(output, source.width, source.height);
  const d: number[] = [];
  for (let i = 0; i < source.width * source.height; i++)
    d.push(Math.abs((back.data[i] as number) - (source.data[i] as number)));
  const s = stat(d);
  const before = topology(source);
  const after = topology(output);
  const noNewFeatures = after.regions <= before.regions && after.holes <= before.holes;
  return {
    ...s,
    source: before,
    output: after,
    noNewFeatures,
    pass: within(s, ROUND_TRIP.coverage) && noNewFeatures,
  };
}

const angle = (a: Raster, i: number, b: Raster, j: number) => {
  const v = [0, 1, 2].map((k) => (a.data[i * a.channels + k] as number) * 2 - 1);
  const u = [0, 1, 2].map((k) => (b.data[j * b.channels + k] as number) * 2 - 1);
  const dot =
    v.reduce((s, x, k) => s + x * (u[k] as number), 0) / (Math.hypot(...v) * Math.hypot(...u));
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
};

export interface NormalRoundTrip extends Stat {
  pass: boolean;
}

/** The normal round trip: the output's slopes averaged to the source's size, in degrees, over the source's islands. */
export function roundTripNormal(source: Raster, output: Raster): NormalRoundTrip {
  const back = areaResizeNormal(output, source.width, source.height);
  const { valid } = slopesOf(source);
  const d: number[] = [];
  for (let i = 0; i < source.width * source.height; i++)
    if (valid.data[i] && (back.data[i * 3 + 2] as number) > 0) d.push(angle(source, i, back, i));
  const s = stat(d);
  return { ...s, pass: within(s, ROUND_TRIP.normal) };
}

export interface NewDetail {
  /** Share of the power above the source's Nyquist, in the result and in a Lanczos-3 interpolation of the source. */
  share: number;
  reference: number;
  /** How much the result's share exceeds the reference's. */
  excess: number;
  /**
   * Per 32-texel tile, the above-band power beyond the reference's as a share
   * of the image's mean tile power: its 99th percentile and greatest.
   */
  localP99: number;
  localMax: number;
  pass: boolean;
}

/**
 * Detail finer than the source in `output`, beyond what a Lanczos-3
 * interpolation of `source` carries: the difference of their power shares
 * above the source's Nyquist (`aboveBandShare`). `prepare` maps a raster to
 * the space detail is measured in (linear colour, or slopes); `weight`, at the
 * output's size, picks the texels that count; `range` bounds the values the
 * space can store (0..1 for colour), which the reference is clipped to, as any
 * stored result is.
 */
export function newDetail(
  source: Raster,
  output: Raster,
  prepare: (r: Raster) => Raster,
  weight?: Float32Array,
  range?: readonly [number, number],
): NewDetail {
  const out = prepare(output);
  // The reference as it could be stored: a Lanczos lobe below black is no colour.
  const reference = lanczosResize(prepare(source), output.width, output.height);
  if (range)
    for (let i = 0; i < reference.data.length; i++)
      reference.data[i] = Math.min(range[1], Math.max(range[0], reference.data[i] as number));
  const share = aboveBandShare(out, source, weight);
  const ref = aboveBandShare(reference, source, weight);
  const excess = Math.max(0, share - ref);
  // Tile by tile, so an artefact in one corner cannot hide in the whole: each
  // tile's above-band power beyond the reference's, against the image's mean
  // tile power (never below 8-bit rounding noise), so a flat tile's rounding
  // is not mistaken for a pattern.
  const tiles = tilePowers(out, source, weight);
  const refTiles = tilePowers(reference, source, weight);
  const valid = [...tiles.total.keys()].filter((t) => !Number.isNaN(tiles.total[t] as number));
  const meanPower =
    valid.reduce((s, t) => s + (tiles.total[t] as number), 0) / Math.max(1, valid.length);
  const floor = Math.max(meanPower, QUANTISATION_NOISE);
  const local = valid.map(
    (t) => Math.max(0, (tiles.high[t] as number) - (refTiles.high[t] as number)) / floor,
  );
  const s = stat(local);
  return {
    share,
    reference: ref,
    excess,
    localP99: s.p99,
    localMax: Math.max(0, ...local),
    pass: excess <= NEW_DETAIL_SHARE && s.p99 <= LOCAL_DETAIL_SHARE,
  };
}

/**
 * Where a normal map's detail is judged: the output texels at least
 * `LANCZOS_REACH` source texels inside its islands, so an island's crisp edge
 * (the coverage method's, gated as coverage) does not count as detail.
 */
export function normalInterior(source: Raster, width: number, height: number): Float32Array {
  const { valid } = slopesOf(source);
  const { width: w, height: h } = source;
  const eroded = raster(w, h, 1);
  const reach = 3;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (let dy = -reach; dy <= reach && all; dy++)
        for (let dx = -reach; dx <= reach && all; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          if (!valid.data[yy * w + xx]) all = 0;
        }
      eroded.data[y * w + x] = all;
    }
  return bilinearResize(eroded, width, height).data;
}

/** What linear colour can store: `newDetail`'s `range` for albedo. */
export const COLOUR_RANGE = [0, 1] as const;

/**
 * Linear colour (straight, not premultiplied: a cut-out's crisp edge is the
 * coverage method's doing, judged by its own gate), for `newDetail` on albedo.
 */
export function albedoSpace(r: Raster): Raster {
  const out = raster(r.width, r.height, 3);
  for (let i = 0; i < r.width * r.height; i++)
    for (let k = 0; k < 3; k++)
      out.data[i * 3 + k] = linearFromSrgb(r.data[i * r.channels + k] as number);
  return out;
}

/** Slopes, for `newDetail` on normal maps (with `normalInterior` as the weight). */
export function slopeSpace(n: Raster): Raster {
  const { gx, gy } = slopesOf(n);
  const out = raster(n.width, n.height, 2);
  for (let i = 0; i < n.width * n.height; i++) {
    out.data[i * 2] = gx[i] as number;
    out.data[i * 2 + 1] = gy[i] as number;
  }
  return out;
}
