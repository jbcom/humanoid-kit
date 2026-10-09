/**
 * A reservoir as detail targets address it (`src/build/reservoir.ts`): the rest
 * positions of its loop and of the cap's interior vertices, and the detail index
 * of every vertex a target may move. Shared by the generators that draw a shape
 * out of a reservoir (`phallus.ts`, `scrotum.ts`).
 *
 * A detail target lists the cap's interior vertices (indices of the refined
 * region, which come first) and then each ring's vertices (ring 1, loop position
 * 0 to n - 1, then ring 2, and so on). `RootShape` keeps that order: a shape is
 * one position per such vertex, and a target is the difference of two shapes.
 */
import type { AdultReservoirSpec } from "../../../src/format/assetFormat.ts";
import type { AdultDetailLattice } from "../../../src/model/humanoidModel.ts";
import type { Vec3 } from "./disc.ts";

export interface ReservoirRoot {
  id: string;
  rings: number;
  /** Detail index of ring 1, loop position 0. */
  base: number;
  /** Rest positions of the loop's vertices, in the spec's order, metres. */
  loop: readonly Vec3[];
  /** The cap's interior vertices, by ascending detail index. */
  cap: readonly { index: number; position: Vec3 }[];
  /** Unit outward normal of the skin over the root. */
  normal: Vec3;
  /** Mean of the loop. */
  centre: Vec3;
}

/** One position per vertex a target of this root may move: the cap's, then each ring's. */
export type RootShape = readonly Vec3[];

/** The root of one reservoir on the lattice the pack's targets are authored against. */
export function reservoirRoot(
  lattice: AdultDetailLattice,
  spec: AdultReservoirSpec,
): ReservoirRoot {
  const info = lattice.reservoirs.find((r) => r.id === spec.id);
  if (!info) throw new Error(`the lattice has no reservoir ${spec.id}`);
  const region = new Map<number, number>();
  lattice.regionIds.forEach((id, i) => {
    region.set(id, i);
  });
  const at = (r: number): Vec3 => [
    lattice.positions[r * 3] as number,
    lattice.positions[r * 3 + 1] as number,
    lattice.positions[r * 3 + 2] as number,
  ];
  const regionOf = (v: number) => {
    const r = region.get(v);
    if (r === undefined) throw new Error(`reservoir ${spec.id}: vertex ${v} is not in the region`);
    return r;
  };
  const loopRegion = spec.loop.map(regionOf);
  const inLoop = new Set(spec.loop);
  const poly = lattice.polygons;
  const cap = new Set(spec.cap);
  const interior = new Set<number>();
  for (let i = 0; i + 1 < poly.start.length; i++) {
    if (!cap.has(poly.id[i] as number)) continue;
    for (let c = poly.start[i] as number; c < (poly.start[i + 1] as number); c++) {
      const v = poly.vertices[c] as number;
      if (!inLoop.has(v)) interior.add(regionOf(v));
    }
  }
  const centre = [0, 0, 0] as [number, number, number];
  const sum = [0, 0, 0] as [number, number, number];
  for (const r of loopRegion) {
    const p = at(r);
    for (const k of [0, 1, 2] as const) {
      centre[k] += p[k] / loopRegion.length;
      sum[k] += lattice.normals[r * 3 + k] as number;
    }
  }
  const length = Math.hypot(...sum);
  return {
    id: spec.id,
    rings: info.rings,
    base: info.base,
    loop: loopRegion.map(at),
    cap: [...interior].sort((a, b) => a - b).map((index) => ({ index, position: at(index) })),
    normal: [sum[0] / length, sum[1] / length, sum[2] / length],
    centre,
  };
}

/** Detail index of ring `ring` (1 to rings), loop position `i`. */
export const ringIndex = (root: ReservoirRoot, ring: number, i: number): number =>
  root.base + (ring - 1) * root.loop.length + i;

/** The detail indices a target of this root may move, ascending, in `RootShape` order. */
export function rootIndices(root: ReservoirRoot): number[] {
  const out = root.cap.map((c) => c.index);
  for (let j = 1; j <= root.rings; j++)
    for (let i = 0; i < root.loop.length; i++) out.push(ringIndex(root, j, i));
  return out;
}

/** The shape at rest: the cap where it is, every ring on its loop. */
export function restShape(root: ReservoirRoot): RootShape {
  const out: Vec3[] = root.cap.map((c) => c.position);
  for (let j = 1; j <= root.rings; j++) out.push(...root.loop);
  return out;
}

/**
 * The target that takes shape `from` to shape `to`, over the vertices that move
 * by more than `epsilon` metres. A vertex that does not move is left out so the
 * target stays sparse.
 */
export function shapeDifference(
  root: ReservoirRoot,
  from: RootShape,
  to: RootShape,
  epsilon = 2e-6,
): { indices: number[]; xyz: number[] } {
  const all = rootIndices(root);
  if (from.length !== all.length || to.length !== all.length)
    throw new Error(`reservoir ${root.id}: a shape has the wrong number of vertices`);
  const indices: number[] = [];
  const xyz: number[] = [];
  all.forEach((index, k) => {
    const a = from[k] as Vec3;
    const b = to[k] as Vec3;
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    if (Math.hypot(...d) <= epsilon) return;
    indices.push(index);
    xyz.push(...d);
  });
  return { indices, xyz };
}
