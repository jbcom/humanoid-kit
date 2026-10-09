/**
 * Skin layers: regional colour as a stack of layers over the base skin
 * (docs/ARCHITECTURE.md, "Parallel work: the base contract").
 *
 * A layer splits into what depends on the base mesh and what depends on the
 * figure. Its fields (a mask, and a coordinate across the region so colour can
 * be a gradient) come from the base mesh alone; the renderer rasterises them
 * once into a field atlas every figure shares. Its paint (strength and colour
 * stops along the coordinate) comes from the figure's tone, recipe and state
 * signals, and fills a few texels of the figure's stop table. The skin shader
 * applies the layers in order per pixel.
 *
 * Layer colour is plain TypeScript, so every region is unit-tested in Node;
 * the shader that applies the table is fixed.
 */
import { AssetFormatError, type HumanoidAssets, type SparseTarget } from "../format/assetFormat.ts";
import type { Rgb, SkinTone } from "./skinTone.ts";

/** What a layer's paint is computed from. */
export interface SkinPaintInput {
  tone: SkinTone;
  /** The recipe's regional skin parameters (0..1 each). */
  flush: number;
  lips: number;
  areola: number;
  /** Continuous state signals by name (temperature, arousal, …); absent = rest. */
  signals: Readonly<Record<string, number>>;
}

export interface SkinLayerPaint {
  /** Opacity scale, 0..1, applied to the layer's mask. */
  strength: number;
  /** Colours at evenly spaced points along the layer's coordinate (1 to `STOP_COUNT`). */
  stops: readonly Rgb[];
}

/** Procedural relief: its strength and its size in metres. */
export interface DetailPaint {
  strength: number;
  /** Peak height of the relief, metres (goosebumps: about 0.00015 to 0.0002). */
  height: number;
  /**
   * `bumps`: the spacing between bumps, metres (goosebumps: follicle spacing,
   * about 0.002). `creases`: how many creases span the layer's coordinate.
   */
  size: number;
}

/** How a layer changes the surface's reflection where its mask lies. */
export interface SurfacePaint {
  strength: number;
  /** Added to the skin's roughness at full strength (negative is glossier). */
  roughness: number;
  /** Added to the skin's specular intensity at full strength. */
  specular: number;
}

export interface SkinLayerFields {
  /** Per base vertex, 0..1. */
  mask: Float32Array;
  /** Per base vertex, 0..1 across the region; null for a single colour. */
  coord: Float32Array | null;
}

interface LayerBase {
  id: string;
  /** Targets the fields are measured from; packed with the first stage. */
  targets: readonly string[];
  fields(assets: HumanoidAssets): SkinLayerFields;
}

/** Changes the skin's colour (the default kind). */
export interface ColourLayer extends LayerBase {
  kind?: "colour";
  /**
   * How the colour applies: `mix` replaces the skin's colour, `multiply` tints
   * it (a stop of [1, 1, 1] leaves it unchanged).
   */
  blend: "mix" | "multiply";
  paint(input: SkinPaintInput): SkinLayerPaint;
}

/**
 * Adds fine relief, computed in the shader at true scale: `bumps` (a jittered
 * field of rounded bumps, as goosebumps) or `creases` (ridges across the
 * layer's coordinate, as at a flexed joint).
 */
export interface DetailLayer extends LayerBase {
  kind: "detail";
  pattern: "bumps" | "creases";
  paint(input: SkinPaintInput): DetailPaint;
}

/** Changes how glossy and how specular the skin is (sweat, oil, wetness). */
export interface SurfaceLayer extends LayerBase {
  kind: "surface";
  paint(input: SkinPaintInput): SurfacePaint;
}

export type SkinLayer = ColourLayer | DetailLayer | SurfaceLayer;

/** Colour stops per layer in the stop table. */
export const STOP_COUNT = 8;

/**
 * Stop-table texels per layer: one header and the stops. The header is
 * (strength, kind, a, b): kind 0 mix, 1 multiply (colour layers; the stops
 * follow), 2 bumps and 3 creases (detail; a height, b size), 4 surface
 * (a roughness, b specular).
 */
export const STOP_TABLE_WIDTH = STOP_COUNT + 1;

/** The header's kind code for a layer. */
export function layerKindCode(layer: SkinLayer): number {
  if (layer.kind === "detail") return layer.pattern === "bumps" ? 2 : 3;
  if (layer.kind === "surface") return 4;
  return layer.blend === "multiply" ? 1 : 0;
}

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * A mask from MakeHuman targets: a target moves exactly the vertices of the
 * feature it shapes, so its displacement, relative to its peak and eased
 * between `lo` and `hi`, outlines the feature. Several targets combine by max.
 */
export function targetMask(
  assets: HumanoidAssets,
  targets: readonly string[],
  lo: number,
  hi: number,
): Float32Array {
  const out = new Float32Array(assets.manifest.vertexCount);
  for (const name of targets) {
    const t: SparseTarget | undefined = assets.targets.get(name);
    if (!t) throw new AssetFormatError(`a skin layer needs target ${name}, which is not loaded`);
    const mags = new Float32Array(t.indices.length);
    let max = 0;
    for (let i = 0; i < t.indices.length; i++) {
      const m = Math.hypot(
        t.deltas[i * 3] as number,
        t.deltas[i * 3 + 1] as number,
        t.deltas[i * 3 + 2] as number,
      );
      mags[i] = m;
      if (m > max) max = m;
    }
    if (max === 0) continue;
    for (let i = 0; i < t.indices.length; i++) {
      const v = t.indices[i] as number;
      const w = smoothstep(lo, hi, (mags[i] as number) / max);
      if (w > (out[v] as number)) out[v] = w;
    }
  }
  return out;
}

/**
 * A filled region from MakeHuman targets, for a feature they outline rather
 * than cover: on each side of the body, the disk round the centre of the
 * vertices the targets move, out to the farthest of them, with a soft edge
 * `soft` × radius wide. (The nipple-size target moves the areola's rim more than
 * its centre, so `targetMask` would draw a ring.)
 */
export function diskMask(
  assets: HumanoidAssets,
  targets: readonly string[],
  soft = 0.25,
): Float32Array {
  const P = assets.positions;
  const n = assets.manifest.vertexCount;
  const out = new Float32Array(n);
  for (const side of [1, -1]) {
    const moved = new Set<number>();
    for (const name of targets) {
      const t = assets.targets.get(name);
      if (!t) throw new AssetFormatError(`a skin layer needs target ${name}, which is not loaded`);
      for (const v of t.indices) if (Math.sign(P[v * 3] as number) === side) moved.add(v);
    }
    if (moved.size === 0) continue;
    const c = [0, 0, 0];
    for (const v of moved)
      for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (P[v * 3 + k] as number);
    for (let k = 0; k < 3; k++) c[k] = (c[k] as number) / moved.size;
    const dist = (v: number) =>
      Math.hypot(
        (P[v * 3] as number) - (c[0] as number),
        (P[v * 3 + 1] as number) - (c[1] as number),
        (P[v * 3 + 2] as number) - (c[2] as number),
      );
    let r = 0;
    for (const v of moved) r = Math.max(r, dist(v));
    for (let v = 0; v < n; v++) {
      const w = 1 - smoothstep(r * (1 - soft), r * (1 + soft), dist(v));
      if (w > (out[v] as number)) out[v] = w;
    }
  }
  return out;
}

/**
 * Metres of skin per unit of UV at each base vertex of `faces` (quads): the
 * square root of the ratio of each face's surface area to its UV area,
 * averaged over the faces around the vertex. Detail layers use it to draw
 * relief at its true size wherever the UV layout stretches or shrinks.
 * Vertices on no listed face get 0.
 */
export function uvScale(assets: HumanoidAssets, faces: ArrayLike<number>): Float32Array {
  const n = assets.manifest.vertexCount;
  const sum = new Float32Array(n);
  const count = new Uint16Array(n);
  const P = assets.positions;
  const U = assets.uvs;
  const area3 = (a: number, b: number, c: number) => {
    const ab = [0, 1, 2].map((k) => (P[b * 3 + k] as number) - (P[a * 3 + k] as number));
    const ac = [0, 1, 2].map((k) => (P[c * 3 + k] as number) - (P[a * 3 + k] as number));
    return (
      0.5 *
      Math.hypot(
        (ab[1] as number) * (ac[2] as number) - (ab[2] as number) * (ac[1] as number),
        (ab[2] as number) * (ac[0] as number) - (ab[0] as number) * (ac[2] as number),
        (ab[0] as number) * (ac[1] as number) - (ab[1] as number) * (ac[0] as number),
      )
    );
  };
  const area2 = (a: number, b: number, c: number) =>
    0.5 *
    Math.abs(
      ((U[b * 2] as number) - (U[a * 2] as number)) *
        ((U[c * 2 + 1] as number) - (U[a * 2 + 1] as number)) -
        ((U[c * 2] as number) - (U[a * 2] as number)) *
          ((U[b * 2 + 1] as number) - (U[a * 2 + 1] as number)),
    );
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i] as number;
    const v = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
    const t = [0, 1, 2, 3].map((k) => assets.faceUvs[f * 4 + k] as number);
    const a3 =
      area3(v[0] as number, v[1] as number, v[2] as number) +
      area3(v[0] as number, v[2] as number, v[3] as number);
    const a2 =
      area2(t[0] as number, t[1] as number, t[2] as number) +
      area2(t[0] as number, t[2] as number, t[3] as number);
    if (a2 <= 0) continue;
    const s = Math.sqrt(a3 / a2);
    for (const k of v) {
      sum[k] = (sum[k] as number) + s;
      count[k] = (count[k] as number) + 1;
    }
  }
  return sum.map((s, k) => ((count[k] as number) > 0 ? s / (count[k] as number) : 0));
}

/**
 * Every layer's fields per base vertex, three floats per layer per vertex
 * (mask, coordinate, 0: the stride the subdivision stencil carries), layer
 * after layer: `layers.length * vertexCount * 3`.
 */
export function buildLayerFields(
  assets: HumanoidAssets,
  layers: readonly SkinLayer[],
): Float32Array {
  const n = assets.manifest.vertexCount;
  const out = new Float32Array(layers.length * n * 3);
  layers.forEach((layer, l) => {
    const { mask, coord } = layer.fields(assets);
    if (mask.length !== n || (coord && coord.length !== n))
      throw new AssetFormatError(`skin layer ${layer.id}: fields must have one value per vertex`);
    for (let v = 0; v < n; v++) {
      out[(l * n + v) * 3] = mask[v] as number;
      out[(l * n + v) * 3 + 1] = coord ? (coord[v] as number) : 0;
    }
  });
  return out;
}

const unit = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The figure's stop table: `layers.length` rows of `STOP_TABLE_WIDTH` RGBA
 * texels. Texel 0 is the header (`STOP_TABLE_WIDTH`); for a colour layer,
 * texels 1 to `STOP_COUNT` are its stops, resampled evenly so the shader's
 * linear filtering interpolates between them.
 */
export function paintStopTable(
  layers: readonly SkinLayer[],
  input: SkinPaintInput,
  out: Float32Array = new Float32Array(layers.length * STOP_TABLE_WIDTH * 4),
): Float32Array {
  layers.forEach((layer, l) => {
    const row = l * STOP_TABLE_WIDTH * 4;
    const code = layerKindCode(layer);
    out.fill(0, row, row + STOP_TABLE_WIDTH * 4);
    if (layer.kind === "detail") {
      const p = layer.paint(input);
      if (!(p.height >= 0 && p.size > 0))
        throw new RangeError(`skin layer ${layer.id}: height must be >= 0 and size > 0`);
      out.set([unit(p.strength), code, p.height, p.size], row);
      return;
    }
    if (layer.kind === "surface") {
      const p = layer.paint(input);
      out.set([unit(p.strength), code, p.roughness, p.specular], row);
      return;
    }
    const { strength, stops } = layer.paint(input);
    if (stops.length < 1 || stops.length > STOP_COUNT)
      throw new RangeError(`skin layer ${layer.id}: 1 to ${STOP_COUNT} stops, got ${stops.length}`);
    out.set([unit(strength), code, 0, 0], row);
    for (let k = 0; k < STOP_COUNT; k++) {
      const x = (k / (STOP_COUNT - 1)) * (stops.length - 1);
      const i = Math.min(Math.floor(x), stops.length - 1);
      const f = x - i;
      const a = stops[i] as Rgb;
      const b = stops[Math.min(i + 1, stops.length - 1)] as Rgb;
      out.set(
        [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, 1],
        row + (k + 1) * 4,
      );
    }
  });
  return out;
}

/**
 * What the shader computes for one pixel: the base colour with every layer
 * applied in order, at that pixel's field values (`fields[l] = [mask, coord]`).
 * The reference the browser tests hold the shader to.
 */
export function applyLayers(
  base: Rgb,
  table: Float32Array,
  fields: readonly (readonly [number, number])[],
): Rgb {
  const c: Rgb = [...base];
  fields.forEach(([mask, coord], l) => {
    const row = l * STOP_TABLE_WIDTH * 4;
    const kind = Math.round(table[row + 1] as number);
    if (kind > 1) return; // detail and surface layers leave the colour alone
    const a = mask * (table[row] as number);
    const multiply = kind === 1;
    const x = Math.min(1, Math.max(0, coord)) * (STOP_COUNT - 1);
    const i = Math.min(Math.floor(x), STOP_COUNT - 2);
    const f = x - i;
    for (let k = 0; k < 3; k++) {
      const s0 = table[row + (i + 1) * 4 + k] as number;
      const s1 = table[row + (i + 2) * 4 + k] as number;
      const stop = s0 + (s1 - s0) * f;
      const target = multiply ? (c[k] as number) * stop : stop;
      c[k] = (c[k] as number) + (target - (c[k] as number)) * a;
    }
  });
  return c;
}

/**
 * What the shader adds to the skin's roughness and specular intensity at one
 * pixel: every surface layer's change, weighted by its mask and strength.
 */
export function surfaceChange(
  table: Float32Array,
  fields: readonly (readonly [number, number])[],
): { roughness: number; specular: number } {
  let roughness = 0;
  let specular = 0;
  fields.forEach(([mask], l) => {
    const row = l * STOP_TABLE_WIDTH * 4;
    if (Math.round(table[row + 1] as number) !== 4) return;
    const a = mask * (table[row] as number);
    roughness += a * (table[row + 2] as number);
    specular += a * (table[row + 3] as number);
  });
  return { roughness, specular };
}

/**
 * A crease layer's relief at a point (metres): ridges across the coordinate,
 * `size` of them from 0 to 1, raised cosine profile. Bumps are the shader's
 * (a jittered cell field), so they are tested there.
 */
export function creaseHeight(height: number, size: number, coord: number): number {
  return height * 0.5 * (1 - Math.cos(2 * Math.PI * size * coord));
}
