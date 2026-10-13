/**
 * The refined region of the adult lattice as a graph: the vertices skin targets
 * displace (`AdultDetailLattice`, the first `regionCount` detail indices).
 */
import type { AdultDetailLattice } from "../../../src/model/humanoidModel.ts";

/** Each refinement-mesh vertex id's region index (its detail index). */
export function regionIndex(lattice: AdultDetailLattice): Map<number, number> {
  const out = new Map<number, number>();
  lattice.regionIds.forEach((id, i) => {
    out.set(id, i);
  });
  return out;
}

/**
 * The lattice with its region displaced by a skin target (`indices` region indices,
 * `xyz` three metres each): where a target drawn after it finds the skin.
 */
export function displacedBy(
  lattice: AdultDetailLattice,
  target: { indices: readonly number[]; xyz: readonly number[] },
): AdultDetailLattice {
  const positions = Float32Array.from(lattice.positions);
  target.indices.forEach((v, i) => {
    if (v >= lattice.regionCount)
      throw new Error(`a skin target moves detail vertex ${v}, not the region`);
    for (let k = 0; k < 3; k++)
      positions[v * 3 + k] = (positions[v * 3 + k] as number) + (target.xyz[i * 3 + k] as number);
  });
  return { ...lattice, positions };
}

/** Each region vertex's neighbours along the lattice's polygons' edges, by region index. */
export function regionNeighbours(
  lattice: AdultDetailLattice,
  regionOf: ReadonlyMap<number, number>,
): number[][] {
  const sets = Array.from({ length: lattice.regionCount }, () => new Set<number>());
  const { start, vertices } = lattice.polygons;
  for (let p = 0; p + 1 < start.length; p++) {
    const s = start[p] as number;
    const e = start[p + 1] as number;
    for (let c = s; c < e; c++) {
      const a = regionOf.get(vertices[c] as number);
      const b = regionOf.get(vertices[c + 1 < e ? c + 1 : s] as number);
      if (a === undefined || b === undefined) continue;
      (sets[a] as Set<number>).add(b);
      (sets[b] as Set<number>).add(a);
    }
  }
  return sets.map((s) => [...s]);
}
