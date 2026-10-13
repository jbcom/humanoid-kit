/**
 * Bakes the age surface map (`src/surface/ageSurface.ts`): the creases of an old
 * face, neck and hands as a signed height in the body's UV space.
 *
 * Source: MakeHuman's CC0 old-skin photographs (`AGE_SURFACE_SOURCES`), which are
 * painted in the hm08 base mesh's own UV layout, so a texel of the map and of the
 * photograph are the same point of skin. The photograph's creases are its
 * luminance at the scale of a crease against its local mean: the log ratio of a
 * lightly blurred copy (pore noise out) over a broadly blurred one (tone,
 * lighting and the face's shading out), squashed (`tanh`) so the few things that
 * are no crease and far darker or lighter (a lash line, a nostril) cannot
 * dominate. Only skin that ages visibly keeps it: the face below the hairline
 * and in front of the ears, without the eyes' openings, brows, lips and mouth;
 * the backs of the hands without the nails. The neck, which the photographs
 * show almost smooth, gets procedural horizontal lines from the mesh's own 3D
 * positions, so they run on round the neck across the UV seam.
 *
 * Everything is rasterised from the base mesh at the map's size, so the map is a
 * function of the pack's mesh and the two source files alone.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { groupFaces, type HumanoidAssets, jointPosition } from "../../src/format/assetFormat.ts";
import { AGE_SURFACE_FILE, AGE_SURFACE_SIZE } from "../../src/surface/ageSurface.ts";
import { nailFields } from "../../src/surface/regions/hands/nails.ts";
import { mouthInteriorMask } from "../../src/surface/regions/mouth.ts";
import { LIPS_LAYER } from "../../src/surface/regions/rest.ts";
import { skinZones } from "../../src/surface/regions/skinZones.ts";

/** The photographs, in the system assets pack, with the material file that carries each one's CC0 header. */
export const AGE_SURFACE_SOURCES = [
  {
    channel: "male",
    image: "skins/old_caucasian_male/old_lightskinned_male_diffuse.png",
    material: "skins/old_caucasian_male/old_caucasian_male.mhmat",
  },
  {
    channel: "female",
    image: "skins/old_caucasian_female/old_lightskinned_female_diffuse.png",
    material: "skins/old_caucasian_female/old_caucasian_female.mhmat",
  },
] as const;

/** The line a source's material must carry: MakeHuman's CC0 release header. */
export const CC0_HEADER = "This asset was explicitly released as CC0";

/** Texels from an island's edge over which the photograph's detail fades in (its broad blur there sees the backdrop). */
export const SEAM_FADE = [2, 12] as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

export interface AgeRegions {
  /** Face skin that creases with age, 0..1 per base vertex. */
  face: Float32Array;
  /** The neck, where the procedural lines go. */
  neck: Float32Array;
  /** The backs of the hands and fingers. */
  hand: Float32Array;
}

const joint = (assets: HumanoidAssets, name: string): [number, number, number] => {
  const p = new Float32Array(3);
  jointPosition(assets, assets.positions, name, p, 0);
  return [p[0] as number, p[1] as number, p[2] as number];
};

/** Per base vertex, the regions the map covers (soft-edged). */
export function ageRegions(assets: HumanoidAssets): AgeRegions {
  const n = assets.manifest.vertexCount;
  const zones = skinZones(assets);
  const head = zones.zone("head");
  const handZone = zones.zone("hand");
  const lips = LIPS_LAYER.fields(assets).mask;
  const mouth = mouthInteriorMask(assets);
  const nails = nailFields(assets).colour.mask;
  const eye = joint(assets, "eye.L____head");
  const brow = joint(assets, "oculi01.L____head");
  // The body's cavities at rest (nostrils, ear canals, eye sockets: `BodyOcclusion`,
  // 1 open), whose photographed darkness is a hole, not a crease.
  const enclosed = new Float32Array(n);
  const occlusion = assets.bodyOcclusion;
  if (occlusion)
    occlusion.vertices.forEach((v, k) => {
      enclosed[v] = 1 - (occlusion.values[k] as number) / 255;
    });
  const P = assets.positions;
  // A cavity's photographed rim is as dark as its hole: keep clear of the
  // nostrils', ear canals' and eye sockets' enclosed vertices by a few millimetres
  // (the mouth is the lips' and the mouth's own masks).
  const seeds: number[] = [];
  for (let v = 0; v < n; v++)
    if (
      (enclosed[v] as number) > 0.3 &&
      (mouth[v] as number) < 0.5 &&
      (lips[v] as number) < 0.05 &&
      (head[v] as number) > 0.5
    )
      seeds.push(v);
  const cavityDistance = (v: number) => {
    let best = Number.POSITIVE_INFINITY;
    for (const s of seeds)
      best = Math.min(
        best,
        Math.hypot(
          (P[v * 3] as number) - (P[s * 3] as number),
          (P[v * 3 + 1] as number) - (P[s * 3 + 1] as number),
          (P[v * 3 + 2] as number) - (P[s * 3 + 2] as number),
        ),
      );
    return best;
  };
  const face = new Float32Array(n);
  const neck = new Float32Array(n);
  const hand = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const x = P[v * 3] as number;
    const y = P[v * 3 + 1] as number;
    const z = P[v * 3 + 2] as number;
    const ax = Math.abs(x);
    // In front of the ears and below the hairline: the ears' fold and the scalp's
    // hair are photographed detail, not creases.
    const front = smoothstep(eye[2] - 0.05, eye[2] - 0.035, z) * (1 - smoothstep(0.064, 0.072, ax));
    // The hairline, which comes down at the temples.
    const hairline =
      (1 - smoothstep(brow[1] + 0.042, brow[1] + 0.056, y)) *
      (1 - smoothstep(0.05, 0.06, ax) * smoothstep(brow[1] - 0.004, brow[1] + 0.008, y));
    // The eye's opening (lids' rims and the photographed eye): the eyeball's radius and a little.
    const eyeDistance = Math.hypot(ax - eye[0], y - eye[1], z - eye[2]);
    const eyeHole = 1 - smoothstep(0.0128, 0.0155, eyeDistance);
    // The brows' hair, which a figure draws as hair of its own; the glabella between them stays.
    const browBand =
      smoothstep(0.012, 0.018, ax) *
      (1 - smoothstep(0.062, 0.072, ax)) *
      smoothstep(brow[1] - 0.012, brow[1] - 0.007, y) *
      (1 - smoothstep(brow[1] + 0.004, brow[1] + 0.009, y));
    if ((head[v] as number) <= 0) {
      face[v] = 0;
    } else
      face[v] =
        (head[v] as number) *
        smoothstep(0.0035, 0.006, cavityDistance(v)) *
        front *
        hairline *
        (1 - eyeHole) *
        (1 - browBand) *
        (1 - smoothstep(0.05, 0.25, enclosed[v] as number)) *
        (1 - smoothstep(0.05, 0.4, lips[v] as number)) *
        (1 - clamp01(mouth[v] as number));
    neck[v] = (zones.neck[v] as number) * (1 - (head[v] as number) * front);
    hand[v] =
      (handZone[v] as number) * (1 - (zones.palm[v] as number)) * (1 - clamp01(nails[v] as number));
  }
  return { face, neck, hand };
}

/** Per-texel values rasterised from the base mesh's body faces at the map's UVs. */
interface Raster {
  size: number;
  /** 1 where an island covers the texel. */
  cover: Uint8Array;
  /** Interpolated per-vertex channels, `channels` per texel. */
  values: Float32Array;
  channels: number;
}

/**
 * Rasterises per-vertex channels over the body's faces into UV texels, image
 * orientation (row 0 is v = 1, as the photographs and a three.js texture are).
 */
export function rasteriseUv(
  assets: HumanoidAssets,
  size: number,
  channels: readonly Float32Array[],
): Raster {
  const k = channels.length;
  const values = new Float32Array(size * size * k);
  const cover = new Uint8Array(size * size);
  const U = assets.uvs;
  const tri = (vs: readonly number[], us: readonly number[]) => {
    const p = us.map((u) => [
      (U[u * 2] as number) * size - 0.5,
      (1 - (U[u * 2 + 1] as number)) * size - 0.5,
    ]) as [number, number][];
    const [a, b, c] = p as [[number, number], [number, number], [number, number]];
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-12) return;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const w0 = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / area;
        const w1 = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const i = y * size + x;
        cover[i] = 1;
        for (let c2 = 0; c2 < k; c2++) {
          const ch = channels[c2] as Float32Array;
          values[i * k + c2] =
            w0 * (ch[vs[0] as number] as number) +
            w1 * (ch[vs[1] as number] as number) +
            w2 * (ch[vs[2] as number] as number);
        }
      }
  };
  for (const q of groupFaces(assets, "body")) {
    const v = [0, 1, 2, 3].map((j) => assets.faceVerts[q * 4 + j] as number);
    const u = [0, 1, 2, 3].map((j) => assets.faceUvs[q * 4 + j] as number);
    tri([v[0], v[1], v[2]] as number[], [u[0], u[1], u[2]] as number[]);
    tri([v[0], v[2], v[3]] as number[], [u[0], u[2], u[3]] as number[]);
  }
  return { size, cover, values, channels: k };
}

/** Texels to the nearest uncovered texel (8-connected chamfer), capped at `cap`. */
export function distanceInside(cover: Uint8Array, size: number, cap: number): Float32Array {
  const d = new Float32Array(size * size);
  for (let i = 0; i < d.length; i++) d[i] = cover[i] ? cap : 0;
  const diag = Math.SQRT2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!d[i]) continue;
      let best = d[i] as number;
      if (x > 0) best = Math.min(best, (d[i - 1] as number) + 1);
      if (y > 0) {
        best = Math.min(best, (d[i - size] as number) + 1);
        if (x > 0) best = Math.min(best, (d[i - size - 1] as number) + diag);
        if (x < size - 1) best = Math.min(best, (d[i - size + 1] as number) + diag);
      }
      d[i] = best;
    }
  for (let y = size - 1; y >= 0; y--)
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      if (!d[i]) continue;
      let best = d[i] as number;
      if (x < size - 1) best = Math.min(best, (d[i + 1] as number) + 1);
      if (y < size - 1) {
        best = Math.min(best, (d[i + size] as number) + 1);
        if (x < size - 1) best = Math.min(best, (d[i + size + 1] as number) + diag);
        if (x > 0) best = Math.min(best, (d[i + size - 1] as number) + diag);
      }
      d[i] = best;
    }
  return d;
}

/** Separable Gaussian blur of a float image (edges clamped). */
export function gaussianBlur(src: Float32Array, size: number, sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma);
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = w;
    sum += w;
  }
  for (let i = 0; i < k.length; i++) k[i] = (k[i] as number) / sum;
  const tmp = new Float32Array(size * size);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(size - 1, Math.max(0, x + i));
        acc += (k[i + r] as number) * (src[y * size + xx] as number);
      }
      tmp[y * size + x] = acc;
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(size - 1, Math.max(0, y + i));
        acc += (k[i + r] as number) * (tmp[yy * size + x] as number);
      }
      out[y * size + x] = acc;
    }
  return out;
}

/**
 * The scales (Gaussian sigma, texels at 2048: about 0.4 mm each on the face) at
 * which creases are found, and each one's weight: fine lines (crow's feet, the
 * lips' and under-eye lines), forehead and glabellar lines, and the broad folds
 * (nasolabial, marionette, the lower lid's bag).
 */
export const CREASE_SCALES = [
  { sigma: 1.5, weight: 0.8 },
  { sigma: 3, weight: 1 },
  { sigma: 6, weight: 0.9 },
] as const;

/**
 * A photograph's creases: how much each texel lies in a dark valley, a line
 * darker than the skin either side of it. Per scale, the luminance's (log) Hessian
 * is taken; a crease curves up strongly across itself (its larger eigenvalue)
 * and hardly along (its smaller one), where a pore, a freckle or a hair's dot
 * curves up both ways and flat skin neither. Scale-normalised (σ²) and the
 * strongest scale taken, so it is a valley's depth in log luminance whatever
 * its width. Bright lines (a lit fold's crest) are not creases and give 0.
 */
export async function creaseSignal(file: string, size: number): Promise<Float32Array> {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .toColourspace("b-w")
    .resize(size, size, { kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== size || info.height !== size || info.channels !== 1)
    throw new Error(
      `${file}: expected ${size}² grey, got ${info.width}x${info.height}x${info.channels}`,
    );
  const log = new Float32Array(size * size);
  for (let i = 0; i < log.length; i++) log[i] = Math.log((data[i] as number) + 4);
  const out = new Float32Array(size * size);
  for (const { sigma, weight } of CREASE_SCALES) {
    const L = gaussianBlur(log, size, sigma);
    const s2 = sigma * sigma * weight;
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        const c = L[i] as number;
        const xx = (L[i - 1] as number) + (L[i + 1] as number) - 2 * c;
        const yy = (L[i - size] as number) + (L[i + size] as number) - 2 * c;
        const xy =
          ((L[i + size + 1] as number) -
            (L[i + size - 1] as number) -
            (L[i - size + 1] as number) +
            (L[i - size - 1] as number)) /
          4;
        const mean = (xx + yy) / 2;
        const root = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
        const across = mean + root;
        const along = mean - root;
        const valley = Math.max(0, across - Math.abs(along)) * s2;
        if (valley > (out[i] as number)) out[i] = valley;
      }
  }
  return out;
}

/** A crease signal's level (a high percentile over the region) that maps to a full-depth groove. */
export const CREASE_FULL_PERCENTILE = 0.99;
/** Below this share of the full-depth level, a valley is the skin's texture, not a crease, and is dropped. */
export const CREASE_FLOOR = 0.22;

/** The `p` quantile of `signal` where `weight` > 0.5. */
export function regionQuantile(
  signal: Float32Array,
  weight: (i: number) => number,
  p: number,
): number {
  const xs: number[] = [];
  for (let i = 0; i < signal.length; i++) if (weight(i) > 0.5) xs.push(signal[i] as number);
  if (xs.length < 100) throw new Error(`too few texels (${xs.length}) to measure a crease scale`);
  xs.sort((a, b) => a - b);
  return xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] as number;
}

/** A groove's height (-1..0) from its crease signal against the region's full-depth level. */
export function grooveHeight(signal: number, full: number): number {
  const t = (signal / full - CREASE_FLOOR) / (1 - CREASE_FLOOR);
  if (t <= 0) return 0;
  return -Math.tanh(1.3 * t);
}

/** The neck's horizontal lines (necklace lines), by height above the neck's base joint at its front. */
export const NECK_LINES = [
  { at: 0.0085, depth: 0.85 },
  { at: 0.0195, depth: 1 },
  { at: 0.031, depth: 0.7 },
] as const;
/** A neck line's half-width (Gaussian sigma) and how far its middle sags at the front, metres. */
export const NECK_LINE_WIDTH = 0.0017;
export const NECK_LINE_SAG = 0.004;

/**
 * The neck lines' height at a point of the neck (signed, -1 the floor of a
 * line), from its rest position: horizontal grooves round the front and sides,
 * each with a soft roll of skin above it, sagging a little at the front and
 * wandering slowly round the neck, gone by the nape.
 */
export function neckLines(
  x: number,
  y: number,
  z: number,
  base: readonly [number, number, number],
  axisZ: number,
): number {
  const theta = Math.atan2(x, z - axisZ);
  const front = Math.cos(theta);
  const reach = smoothstep(-0.35, 0.25, front);
  if (reach <= 0) return 0;
  let h = 0;
  NECK_LINES.forEach((line, i) => {
    const centre =
      base[1] +
      line.at -
      NECK_LINE_SAG * front * front * (front > 0 ? 1 : 0) +
      0.0012 * Math.sin(2.1 * theta + 1.9 * i) +
      0.0006 * Math.sin(5.3 * theta + 0.7 * i);
    const d = (y - centre) / NECK_LINE_WIDTH;
    const roll = (y - centre - 1.6 * NECK_LINE_WIDTH) / (1.3 * NECK_LINE_WIDTH);
    h += line.depth * (-Math.exp(-d * d) + 0.3 * Math.exp(-roll * roll));
  });
  return reach * h;
}

export interface AgeSurfaceMap {
  size: number;
  /** RGB, 8 bits: red the old man's crease height, green the old woman's, blue 128; 128 is flat. */
  rgb: Uint8Array;
  /** Robust crease scale of each source on the face and hands (log luminance). */
  scales: Record<string, { face: number; hand: number }>;
}

/** Bakes the map from the system assets pack at `systemDir`. */
export async function buildAgeSurfaceMap(
  assets: HumanoidAssets,
  systemDir: string,
  size = AGE_SURFACE_SIZE,
): Promise<AgeSurfaceMap> {
  const regions = ageRegions(assets);
  const n = assets.manifest.vertexCount;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pz = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    px[v] = assets.positions[v * 3] as number;
    py[v] = assets.positions[v * 3 + 1] as number;
    pz[v] = assets.positions[v * 3 + 2] as number;
  }
  const r = rasteriseUv(assets, size, [regions.face, regions.neck, regions.hand, px, py, pz]);
  const K = r.channels;
  const seam = distanceInside(r.cover, size, SEAM_FADE[1] + 1);
  const base = joint(assets, "neck01____head");
  const axisZ = (base[2] + joint(assets, "neck03____head")[2]) / 2;
  const rgb = new Uint8Array(size * size * 3).fill(128);
  const scales: AgeSurfaceMap["scales"] = {};
  const neck = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    if (!r.cover[i]) continue;
    const w = r.values[i * K + 1] as number;
    if (w > 0)
      neck[i] =
        w *
        neckLines(
          r.values[i * K + 3] as number,
          r.values[i * K + 4] as number,
          r.values[i * K + 5] as number,
          base,
          axisZ,
        );
  }
  for (const [c, source] of AGE_SURFACE_SOURCES.entries()) {
    const signal = await creaseSignal(path.join(systemDir, source.image), size);
    const level = (k: number) =>
      regionQuantile(
        signal,
        (i) => (r.cover[i] ? (r.values[i * K + k] as number) : 0),
        CREASE_FULL_PERCENTILE,
      );
    const face = level(0);
    const hand = level(2);
    scales[source.channel] = { face, hand };
    for (let i = 0; i < size * size; i++) {
      if (!r.cover[i]) continue;
      const fade = smoothstep(SEAM_FADE[0], SEAM_FADE[1], seam[i] as number);
      const s = signal[i] as number;
      const detail =
        fade *
        ((r.values[i * K] as number) * grooveHeight(s, face) +
          (r.values[i * K + 2] as number) * grooveHeight(s, hand));
      const h = Math.min(1, Math.max(-1, detail + (neck[i] as number)));
      rgb[i * 3 + c] = Math.round(127.5 + 127.5 * h);
    }
  }
  return { size, rgb, scales };
}

const sha256 = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

/** The manifest entry and provenance of a written map. */
export interface AgeSurfaceOutput {
  entry: { file: string; sha256: string; size: number };
  sources: { channel: string; image: string; sha256: string; licence: string }[];
}

/**
 * Bakes the map into `outDir` as lossless WebP, after checking each source's
 * CC0 header; returns its manifest entry and its sources' hashes.
 */
export async function writeAgeSurfaceMap(
  assets: HumanoidAssets,
  systemDir: string,
  outDir: string,
): Promise<AgeSurfaceOutput> {
  const sources = AGE_SURFACE_SOURCES.map((s) => {
    const material = fs.readFileSync(path.join(systemDir, s.material), "utf8");
    if (!material.includes(CC0_HEADER))
      throw new Error(`${s.material} does not carry the CC0 header; refusing ${s.image}`);
    return {
      channel: s.channel,
      image: s.image,
      sha256: sha256(fs.readFileSync(path.join(systemDir, s.image))),
      licence: `CC0-1.0 (${s.material}: "${CC0_HEADER}")`,
    };
  });
  const map = await buildAgeSurfaceMap(assets, systemDir);
  const bytes = await sharp(Buffer.from(map.rgb), {
    raw: { width: map.size, height: map.size, channels: 3 },
  })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  fs.writeFileSync(path.join(outDir, AGE_SURFACE_FILE), bytes);
  return { entry: { file: AGE_SURFACE_FILE, sha256: sha256(bytes), size: map.size }, sources };
}

/** The PROVENANCE.md section for the map. */
export function ageSurfaceProvenance(out: AgeSurfaceOutput): string[] {
  return [
    "## Age surface map",
    "",
    `\`${out.entry.file}\` (${out.entry.size}², \`scripts/lib/ageSurfaceMap.ts\`) is a crease height in the body's UV space,`,
    "derived from two photographs of the MakeHuman system assets pack (makehuman_system_assets_cc0.zip,",
    '"System assets, shared under CC0"): each one\'s luminance band-passed to crease scale and masked to the',
    "face, the backs of the hands and the neck, whose lines are procedural. Red is the first source, green the second.",
    "",
    "| Channel | Source | SHA-256 | Licence |",
    "| --- | --- | --- | --- |",
    ...out.sources.map((s) => `| ${s.channel} | ${s.image} | \`${s.sha256}\` | ${s.licence} |`),
    "",
  ];
}
