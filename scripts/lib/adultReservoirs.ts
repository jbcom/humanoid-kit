/**
 * The adult pack's reservoirs (src/build/reservoir.ts, docs/research/
 * ADULT-SCULPT-PLAN.md, section 6b): where the collapsed strips sit on the
 * adult surface, so that detail can extrude a phallic body and a pair of
 * labioscrotal swellings from them. One structure at different sizes covers a
 * clitoral glans to a penis, and the pair, fused to any degree, labia majora to
 * a scrotum, so intersex presentations are points on the same continuum and no
 * reservoir knows which anatomy it will become.
 *
 * Placement is found on the default figure from the lattice's own shape, not
 * from fixed coordinates: the phallic disc sits on the midline where the front of
 * the pelvis turns under (its normal 45 degrees below forward); the pair sit
 * either side of the midline on the flat underside between the legs. The sizes
 * are modelled: a disc has to be large enough for the largest shaft the detail
 * will make, and small enough that the three share no vertex.
 */
import type { AdultReservoirSpec } from "../../src/format/assetFormat.ts";
import type { AdultDetailLattice } from "../../src/model/humanoidModel.ts";
import { findDisc, type Vec3 } from "./detail/disc.ts";

/** Collapsed rings between each loop and cap: the length a detail can draw a tube out to, in steps. */
export const RESERVOIR_RINGS = { phallic: 32, labioscrotal: 16 } as const;

/** The ellipsoids (semi-axes x, y, z, metres) whose polygons make each cap. */
const SIZE = {
  phallic: [0.013, 0.013, 0.013] as Vec3,
  labioscrotal: [0.009, 0.02, 0.02] as Vec3,
};
/** How far each labioscrotal disc's centre is from the midline, metres. */
const LABIOSCROTAL_OFFSET = 0.014;

export type ReservoirLattice = Pick<
  AdultDetailLattice,
  "regionCount" | "regionIds" | "positions" | "normals" | "polygons" | "latticePositions"
>;

const MIDLINE = 0.0012;

/** The reservoirs for this lattice, in the order phallic, labioscrotal left, labioscrotal right (x negative first). */
export function reservoirSpecs(lattice: ReservoirLattice): AdultReservoirSpec[] {
  const { positions: P, normals: N, regionCount: n } = lattice;
  const at = (v: number): Vec3 => [
    lattice.latticePositions[v * 3] as number,
    lattice.latticePositions[v * 3 + 1] as number,
    lattice.latticePositions[v * 3 + 2] as number,
  ];
  const middle: number[] = [];
  for (let i = 0; i < n; i++)
    if (Math.abs(P[i * 3] as number) < MIDLINE && (P[i * 3 + 2] as number) > 0.02) middle.push(i);
  if (!middle.length) throw new Error("reservoirs: no midline on the front of the pelvis");
  // The root of the phallus: on the midline, where the surface faces 45 degrees below forward.
  const root = middle.reduce((best, i) =>
    Math.abs((N[i * 3 + 1] as number) + Math.SQRT1_2) <
    Math.abs((N[best * 3 + 1] as number) + Math.SQRT1_2)
      ? i
      : best,
  );
  // The flat underside between the legs: the midline where the surface faces straight down.
  const under = middle.filter((i) => (N[i * 3 + 1] as number) < -0.98);
  if (!under.length) throw new Error("reservoirs: no underside on the midline");
  const underY = under.reduce((s, i) => s + (P[i * 3 + 1] as number), 0) / under.length;
  const zs = under.map((i) => P[i * 3 + 2] as number);
  const underZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const rootAt: Vec3 = [0, P[root * 3 + 1] as number, P[root * 3 + 2] as number];
  const place = (id: string, centre: Vec3, size: Vec3, rings: number): AdultReservoirSpec => {
    const disc = findDisc(lattice.polygons, at, centre, size);
    return { id, loop: disc.loop, cap: disc.cap, rings };
  };
  return [
    place("phallic", rootAt, SIZE.phallic, RESERVOIR_RINGS.phallic),
    place(
      "labioscrotal-left",
      [-LABIOSCROTAL_OFFSET, underY, underZ],
      SIZE.labioscrotal,
      RESERVOIR_RINGS.labioscrotal,
    ),
    place(
      "labioscrotal-right",
      [LABIOSCROTAL_OFFSET, underY, underZ],
      SIZE.labioscrotal,
      RESERVOIR_RINGS.labioscrotal,
    ),
  ];
}
