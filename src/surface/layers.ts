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

export interface SkinLayerFields {
  /** Per base vertex, 0..1. */
  mask: Float32Array;
  /** Per base vertex, 0..1 across the region; null for a single colour. */
  coord: Float32Array | null;
}

export interface SkinLayer {
  id: string;
  /**
   * How the colour applies: `mix` replaces the skin's colour, `multiply` tints
   * it (a stop of [1, 1, 1] leaves it unchanged).
   */
  blend: "mix" | "multiply";
  /** Targets the fields are measured from; packed with the first stage. */
  targets: readonly string[];
  fields(assets: HumanoidAssets): SkinLayerFields;
  paint(input: SkinPaintInput): SkinLayerPaint;
}

/** Colour stops per layer in the stop table. */
export const STOP_COUNT = 8;

/** Stop-table texels per layer: one header (strength, blend) and the stops. */
export const STOP_TABLE_WIDTH = STOP_COUNT + 1;

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

/**
 * The figure's stop table: `layers.length` rows of `STOP_TABLE_WIDTH` RGBA
 * texels. Texel 0 is (strength, blend: 0 mix / 1 multiply, 0, 0); texels 1 to
 * `STOP_COUNT` are the stops, resampled evenly so the shader's linear filtering
 * interpolates between them.
 */
export function paintStopTable(
  layers: readonly SkinLayer[],
  input: SkinPaintInput,
  out: Float32Array = new Float32Array(layers.length * STOP_TABLE_WIDTH * 4),
): Float32Array {
  layers.forEach((layer, l) => {
    const { strength, stops } = layer.paint(input);
    if (stops.length < 1 || stops.length > STOP_COUNT)
      throw new RangeError(`skin layer ${layer.id}: 1 to ${STOP_COUNT} stops, got ${stops.length}`);
    const row = l * STOP_TABLE_WIDTH * 4;
    out.set([Math.min(1, Math.max(0, strength)), layer.blend === "multiply" ? 1 : 0, 0, 0], row);
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
    const a = mask * (table[row] as number);
    const multiply = (table[row + 1] as number) > 0.5;
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
