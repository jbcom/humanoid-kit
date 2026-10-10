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
 * clear of it by a ring of polygons, so the two share no vertex, and reaches up to
 * it: seen along the sac's axis, its outline is grown to take in the half of the
 * shaft's cut that faces the sac, as the scrotum's root meets the shaft's ventral
 * root at the penoscrotal junction. By the sac's cut alone the two discs' loops lay
 * 16 mm apart there, and a band of the body's skin showed between the shaft's root
 * and the sac's neck in every state, plain under an erect shaft.
 */
import type { AdultReservoirSpec, AdultSurfacePatch } from "../../src/format/assetFormat.ts";
import type { AdultDetailLattice } from "../../src/model/humanoidModel.ts";
import { type Disc, discVertices, findFootprint, type Vec3 } from "./detail/disc.ts";
import { cutOutline, type MaleParts, partAxis, type SculptPart } from "./detail/sculpt.ts";
import { smoothLoopPatch } from "./detail/smoothLoop.ts";
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
  | "regionCount"
  | "regionIds"
  | "positions"
  | "normals"
  | "polygons"
  | "latticePositions"
  | "uvCount"
>;

/** The points of cut `a` on the side facing cut `b`'s centre. */
function facing(a: readonly Vec3[], b: readonly Vec3[]): Vec3[] {
  const mean = (ps: readonly Vec3[]): Vec3 =>
    [0, 1, 2].map(
      (k) => ps.reduce((s, p) => s + (p[k] as number), 0) / ps.length,
    ) as unknown as Vec3;
  const ca = mean(a);
  const cb = mean(b);
  const toward: Vec3 = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];
  return a.filter(
    (p) => (p[0] - ca[0]) * toward[0] + (p[1] - ca[1]) * toward[1] + (p[2] - ca[2]) * toward[2] > 0,
  );
}

/** A part's footprint on a lattice (`findFootprint`). */
function footprintOn(
  lattice: ReservoirLattice,
  part: SculptPart,
  avoid?: ReadonlySet<number>,
  reach?: readonly Vec3[],
): Disc {
  const at = (v: number): Vec3 => [
    lattice.latticePositions[v * 3] as number,
    lattice.latticePositions[v * 3 + 1] as number,
    lattice.latticePositions[v * 3 + 2] as number,
  ];
  return findFootprint(lattice.polygons, at, {
    outline: cutOutline(part),
    axis: partAxis(part),
    inset: 1,
    depth: FOOTPRINT_DEPTH,
    ...(avoid && { avoid }),
    ...(reach && { reach }),
  });
}

/**
 * The reservoirs, in the order phallic, labioscrotal, and the surface patches they
 * sit in: each where its part attaches, the phallic one at the flaccid shaft's cut
 * (the erect sculpt is projected onto the same loop). Each footprint is remeshed
 * (`smoothLoopPatch`) so its loop is a smooth edge loop, not a staircase of whole
 * polygons. `patched` is the lattice with the patches so far: the labioscrotal
 * footprint is found on the one with the phallic patch, and both reservoirs' loops and
 * caps are named on the one with both.
 */
export function reservoirLayout(
  lattice: ReservoirLattice,
  parts: MaleParts,
  patched: (patches: AdultSurfacePatch[]) => ReservoirLattice,
): { patches: AdultSurfacePatch[]; reservoirs: AdultReservoirSpec[] } {
  const shaft = smoothLoopPatch(lattice, footprintOn(lattice, parts.phallus.flaccid));
  const withShaft = patched([shaft.patch]);
  const sac = smoothLoopPatch(
    withShaft,
    footprintOn(
      withShaft,
      parts.scrotum,
      discVertices(withShaft.polygons, capOn(withShaft, shaft), 1),
      facing(cutOutline(parts.phallus.flaccid), cutOutline(parts.scrotum)),
    ),
  );
  const patches = [shaft.patch, sac.patch];
  const on = patched(patches);
  const phallic = capOn(on, shaft);
  const labioscrotal = capOn(on, sac);
  return {
    patches,
    reservoirs: [
      { id: "phallic", loop: phallic.loop, cap: phallic.cap, rings: RESERVOIR_RINGS.phallic },
      {
        id: "labioscrotal",
        loop: labioscrotal.loop,
        cap: labioscrotal.cap,
        rings: RESERVOIR_RINGS.labioscrotal,
      },
    ],
  };
}

/** A smooth loop's disc on a patched lattice: its loop, and the polygons inside it (every corner a loop or cap vertex). */
function capOn(lattice: ReservoirLattice, smooth: { loop: number[]; capVertices: number[] }): Disc {
  const inside = new Set([...smooth.loop, ...smooth.capVertices]);
  const L = lattice.polygons;
  const cap: number[] = [];
  for (let p = 0; p < L.id.length; p++) {
    const corners = L.vertices.subarray(L.start[p] as number, L.start[p + 1] as number);
    if (Array.from(corners).every((v) => inside.has(v))) cap.push(L.id[p] as number);
  }
  return { loop: smooth.loop, cap };
}
