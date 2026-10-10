/**
 * The adult pack's reservoirs (src/build/reservoir.ts, docs/research/
 * ADULT-SCULPT-PLAN.md, sections 6b and 6d): where the collapsed strips sit on the
 * adult surface, so that detail can draw a phallic body and the labioscrotal
 * swelling out of them. One phallic structure at different sizes covers a clitoral
 * glans to a penis, and one labioscrotal one the vulva's folds to a scrotum, so
 * intersex presentations are points on the same continuum and no reservoir knows
 * which anatomy it will become.
 *
 * A reservoir sits where a sculpted part attaches (`detail/sculpt.ts`): its disc
 * is the skin inside the part's cut, seen along the way the part leaves the body
 * (`findFootprint`). The phallic disc is placed first; the labioscrotal one keeps
 * clear of it by a ring of polygons, so the two share no vertex.
 */
import type { AdultReservoirSpec } from "../../src/format/assetFormat.ts";
import type { AdultDetailLattice } from "../../src/model/humanoidModel.ts";
import { discVertices, findFootprint, type Vec3 } from "./detail/disc.ts";
import { cutOutline, partAxis, type SculptPart } from "./detail/sculpt.ts";
import type { IslandSize } from "./uvIslands.ts";

/** Collapsed rings between each loop and cap: the length a detail can draw a tube out to, in steps. */
export const RESERVOIR_RINGS = { phallic: 32, labioscrotal: 16 } as const;

/** How far behind its cut's centre, along its axis, a part's skin may lie, metres. */
const FOOTPRINT_DEPTH = 0.03;

/**
 * The skin layer (`SKIN_LAYERS` id) that colours each reservoir's island, and the
 * size of the tube the island is made for (`uvIslands.ts`), metres: the largest the
 * detail draws (a large erect organ, a large testis' sac), so a smaller tube shows
 * its texture compressed along its rings and never cut off.
 */
export const ISLAND_LAYERS: Readonly<Record<string, string>> = {
  phallic: "penis-skin",
  labioscrotal: "testes-skin",
};
export const ISLAND_SIZES: Readonly<Record<string, IslandSize>> = {
  phallic: { circumference: 0.16, length: 0.22, cap: 0.016 },
  labioscrotal: { circumference: 0.24, length: 0.12, cap: 0.03 },
};

export type ReservoirLattice = Pick<
  AdultDetailLattice,
  "regionCount" | "regionIds" | "positions" | "normals" | "polygons" | "latticePositions"
>;

/** The sculpted parts the reservoirs are placed for. */
export interface ReservoirParts {
  phallus: SculptPart;
  scrotum: SculptPart;
}

/** The reservoirs for this lattice, in the order phallic, labioscrotal. */
export function reservoirSpecs(
  lattice: ReservoirLattice,
  parts: ReservoirParts,
): AdultReservoirSpec[] {
  const at = (v: number): Vec3 => [
    lattice.latticePositions[v * 3] as number,
    lattice.latticePositions[v * 3 + 1] as number,
    lattice.latticePositions[v * 3 + 2] as number,
  ];
  const disc = (part: SculptPart, avoid?: ReadonlySet<number>) =>
    findFootprint(lattice.polygons, at, {
      outline: cutOutline(part),
      axis: partAxis(part),
      inset: 1,
      depth: FOOTPRINT_DEPTH,
      ...(avoid && { avoid }),
    });
  const phallic = disc(parts.phallus);
  const labioscrotal = disc(parts.scrotum, discVertices(lattice.polygons, phallic, 1));
  return [
    { id: "phallic", loop: phallic.loop, cap: phallic.cap, rings: RESERVOIR_RINGS.phallic },
    {
      id: "labioscrotal",
      loop: labioscrotal.loop,
      cap: labioscrotal.cap,
      rings: RESERVOIR_RINGS.labioscrotal,
    },
  ];
}
