/**
 * Source-derived independent chest tissue.
 *
 * The library is evaluated from the loaded MakeHuman targets: a canonical
 * average-tissue control, its no-tissue counterpart, and the upstream size ×
 * firmness grid. It contains no drawn or inferred anatomy. At runtime the
 * caller gives the already-evaluated control mesh; the foundation removes only
 * its measured carried source tissue and adds the selected source tissue.
 */
import type { BodyManifest } from "../../format/assetFormat.ts";
import { type ChestAnchors, type ChestSide, chestAnchors } from "./anchors.ts";
import { type BodyMesh, biharmonicFill } from "./mesh.ts";
import type { Support } from "./support.ts";

export interface ChestFoundationContext {
  mesh: BodyMesh;
  support: Support;
  manifest: BodyManifest;
}

export interface ChestSideParams {
  /** Blend from the measured source-flat baseline (0) to requested source tissue (1). */
  presence?: number;
  /** The unscaled MakeHuman breast-size coordinate. */
  size: number;
  firmness: number;
}
export type ChestParams = ChestSideParams | Partial<Record<ChestSide, ChestSideParams>>;
export interface ChestSource {
  /** MakeHuman's canonical female-source control at this size and firmness. */
  female(size: number, firmness: number): Float32Array;
  /** MakeHuman's canonical no-tissue control at this age. */
  bare(): Float32Array;
}

const SIZES = [0, 0.5, 0.75, 1] as const;
const FIRMS = [0, 0.5, 1] as const;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const key = (size: number, firmness: number) => `${size}/${firmness}`;

export interface ChestFoundation {
  halfSpan: number;
  /** Source-tissue displacements, including every vertex reached by an upstream target. */
  grid: ReadonlyMap<string, Float32Array>;
  /** The source average control used to bind the generated library. */
  cell: Float32Array;
  /** The source no-tissue relief used to distinguish a frame from carried tissue. */
  bare: Float32Array;
  /** Exact union of the source support and every upstream breast target reach. */
  reach: Uint32Array;
  side: Int8Array;
}

export interface ChestFoundationResult {
  positions: Float32Array;
  tissue: Float32Array;
  anchors: ChestAnchors;
  scale: number;
  carried: Record<ChestSide, number>;
}

/** Builds one canonical, inspectable library from the current loaded source targets. */
export function buildChestFoundation(
  ctx: ChestFoundationContext,
  source: ChestSource,
): ChestFoundation {
  const free = Array.from(ctx.support.free);
  const cell = source.female(0.5, 0.5);
  const fill = biharmonicFill(ctx.mesh, cell, free);
  const bareControl = source.bare();
  const bareFill = biharmonicFill(ctx.mesh, bareControl, free);
  const bare = new Float32Array(cell.length);
  for (const vertex of free)
    for (let axis = 0; axis < 3; axis++)
      bare[vertex * 3 + axis] =
        (bareControl[vertex * 3 + axis] as number) - (bareFill[vertex * 3 + axis] as number);

  const grid = new Map<string, Float32Array>();
  const moved = new Uint8Array(ctx.mesh.vertexCount);
  for (const vertex of ctx.support.free) moved[vertex] = 1;
  for (const size of SIZES)
    for (const firmness of FIRMS) {
      const evaluated = size === 0.5 && firmness === 0.5 ? cell : source.female(size, firmness);
      const tissue = new Float32Array(cell.length);
      for (let vertex = 0; vertex < ctx.mesh.vertexCount; vertex++)
        for (let axis = 0; axis < 3; axis++) {
          const delta =
            (evaluated[vertex * 3 + axis] as number) - (fill[vertex * 3 + axis] as number);
          tissue[vertex * 3 + axis] = delta;
          if (delta !== 0) moved[vertex] = 1;
        }
      grid.set(key(size, firmness), tissue);
    }

  const anchors = chestAnchors(ctx.manifest, cell);
  const reach: number[] = [];
  const side = new Int8Array(ctx.mesh.vertexCount).fill(-1);
  for (let vertex = 0; vertex < ctx.mesh.vertexCount; vertex++) {
    if (!moved[vertex]) continue;
    reach.push(vertex);
    const supportSide = ctx.support.side[vertex] as number;
    side[vertex] =
      supportSide >= 0
        ? supportSide
        : Math.abs((cell[vertex * 3] as number) - anchors.apex.L[0]) <=
            Math.abs((cell[vertex * 3] as number) - anchors.apex.R[0])
          ? 0
          : 1;
  }
  return { halfSpan: anchors.halfSpan, grid, cell, bare, reach: Uint32Array.from(reach), side };
}

function weights(size: number, firmness: number): readonly [string, number][] {
  const s = clamp01(size);
  const segment = s >= 0.75 ? 2 : s >= 0.5 ? 1 : 0;
  const start = SIZES[segment] as number;
  const end = SIZES[segment + 1] as number;
  const sizeMix = (s - start) / (end - start);
  const firmnessSegment = firmness >= 0.5 ? 1 : 0;
  const firmStart = FIRMS[firmnessSegment] as number;
  const firmEnd = FIRMS[firmnessSegment + 1] as number;
  const firmnessMix = (firmness - firmStart) / (firmEnd - firmStart);
  const samples: [string, number][] = [
    [key(start, firmStart), (1 - sizeMix) * (1 - firmnessMix)],
    [key(end, firmStart), sizeMix * (1 - firmnessMix)],
    [key(start, firmEnd), (1 - sizeMix) * firmnessMix],
    [key(end, firmEnd), sizeMix * firmnessMix],
  ];
  return samples.filter(([, value]) => value !== 0);
}

function perSide(params: ChestParams): Partial<Record<ChestSide, ChestSideParams>> {
  return "size" in params ? { L: params, R: params } : params;
}

/** Applies source tissue to an evaluated control without reading a recipe or frame macro. */
export function applyChestFoundation(
  ctx: ChestFoundationContext,
  foundation: ChestFoundation,
  control: Float32Array,
  params: ChestParams,
): ChestFoundationResult {
  const free = Array.from(ctx.support.free);
  const fill = biharmonicFill(ctx.mesh, control, free);
  const anchors = chestAnchors(ctx.manifest, control);
  const scale = anchors.halfSpan / foundation.halfSpan;
  const average = foundation.grid.get(key(0.5, 0.5));
  if (!average) throw new Error("chest foundation missing source average");
  const flat = new Float32Array(control);
  const carried = {} as Record<ChestSide, number>;

  for (const name of ["L", "R"] as const) {
    const side = name === "L" ? 0 : 1;
    if (!perSide(params)[name]) continue;
    const vertices = free.filter((vertex) => ctx.support.side[vertex] === side);
    let tt = 0,
      tb = 0,
      bb = 0,
      rt = 0,
      rb = 0;
    for (const vertex of vertices)
      for (let axis = 0; axis < 3; axis++) {
        const index = vertex * 3 + axis;
        const relief = (control[index] as number) - (fill[index] as number);
        const mound = scale * (average[index] as number);
        const bare = scale * (foundation.bare[index] as number);
        tt += mound * mound;
        tb += mound * bare;
        bb += bare * bare;
        rt += relief * mound;
        rb += relief * bare;
      }
    const determinant = tt * bb - tb * tb;
    const share =
      determinant > 1e-9 * tt * bb ? (rt * bb - rb * tb) / determinant : tt > 0 ? rt / tt : 0;
    carried[name] = clamp01(share);
    for (const vertex of vertices)
      for (let axis = 0; axis < 3; axis++) {
        const index = vertex * 3 + axis;
        flat[index] =
          (control[index] as number) -
          (carried[name] as number) * scale * (average[index] as number);
      }
  }

  const tissue = new Float32Array(control.length);
  const positions = new Float32Array(flat);
  const wanted = perSide(params);
  for (const name of ["L", "R"] as const) {
    const side = name === "L" ? 0 : 1;
    const request = wanted[name];
    if (!request) continue;
    const size = clamp01(request.size);
    const firmness = clamp01(request.firmness);
    const presence = clamp01(request.presence ?? 1);
    for (const vertex of foundation.reach) {
      if (foundation.side[vertex] !== side) continue;
      for (let axis = 0; axis < 3; axis++) {
        const index = vertex * 3 + axis;
        let value = 0;
        for (const [sample, weight] of weights(size, firmness))
          value += weight * ((foundation.grid.get(sample) as Float32Array)[index] as number);
        value *= scale * presence;
        tissue[index] = value;
        positions[index] = (flat[index] as number) + value;
      }
    }
  }
  return { positions, tissue, anchors, scale, carried };
}
