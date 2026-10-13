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
import { ANUS, OPENING as CANAL_OPENING, type CanalForm, VAGINA } from "./detail/canal.ts";
import { type Disc, discVertices, findDisc, findFootprint, type Vec3 } from "./detail/disc.ts";
import { cutOutline, type MaleParts, partAxis, type SculptPart } from "./detail/sculpt.ts";
import { smoothLoopPatch } from "./detail/smoothLoop.ts";
import type { IslandSize } from "./uvIslands.ts";

/** Collapsed rings between each loop and cap: the length a detail can draw a tube out to, in steps. */
export const RESERVOIR_RINGS = { phallic: 32, labioscrotal: 16, vaginal: 16, anal: 8 } as const;

/**
 * The canals' openings on the skin (`detail/canal.ts`): the disc round each landmark
 * (`PlacedVulva`), as an ellipsoid's semi-axes (x across, y up, z front to back),
 * metres. The vagina's opening is the introitus, 28 mm long by Kreklau's mean, its
 * disc 24 mm long and 4 mm across inside the vestibule; the anus's a 4 mm disc. Each is
 * closed at the skin (`canalClosure`), gathered across by its own width: 12 mm wide, the
 * gather stretched the skin round it into slivers (within 15 mm of the anus, triangles
 * under 5° from 165 to 322, m-muscular seated) that turned over in the pose. A disc
 * this narrow keeps no polygon inside its band (lattice edges are 1.6 to 2 mm here), so
 * its cap is a fan to a centre (`smoothLoopPatch`), and its loop keeps the vertices
 * round it the canal needs (`CANAL_SAMPLES`).
 */
const CANAL_DISCS = {
  vaginal: [0.002, 0.03, 0.012],
  anal: [0.002, 0.03, 0.002],
} as const satisfies Record<string, Vec3>;

/**
 * Vertices round each canal's loop: the vagina's lumen widens to 45 mm, the anal canal's is a
 * 3 mm tube (half a millimetre apart round it). At 60 round the anus's 4 mm opening, the
 * strip from the skin's coarse staircase to the loop fanned into slivers that turned over
 * in the pose (m-heavy seated, 14 more inverted round it).
 */
const CANAL_SAMPLES = { vaginal: 64, anal: 20 } as const;

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
  openings: { introitus: Vec3; anus: Vec3 },
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
  const withSac = patched([shaft.patch, sac.patch]);
  const vaginal = smoothLoopPatch(
    withSac,
    canalDisc(withSac, openings.introitus, CANAL_DISCS.vaginal),
    CANAL_SAMPLES.vaginal,
  );
  const withVagina = patched([shaft.patch, sac.patch, vaginal.patch]);
  const anal = smoothLoopPatch(
    withVagina,
    canalDisc(withVagina, openings.anus, CANAL_DISCS.anal),
    CANAL_SAMPLES.anal,
  );
  const patches = [shaft.patch, sac.patch, vaginal.patch, anal.patch];
  const on = patched(patches);
  const spec = (
    id: keyof typeof RESERVOIR_RINGS,
    smooth: { loop: number[]; capVertices: number[] },
    canal?: CanalForm,
  ): AdultReservoirSpec => {
    const disc = capOn(on, smooth);
    const base = { id, loop: disc.loop, cap: disc.cap, rings: RESERVOIR_RINGS[id] };
    return canal ? { ...base, canal: { opening: CANAL_OPENING, gap: canal.gap } } : base;
  };
  return {
    patches,
    reservoirs: [
      spec("phallic", shaft),
      spec("labioscrotal", sac),
      spec("vaginal", vaginal, VAGINA),
      spec("anal", anal, ANUS),
    ],
  };
}

/** The disc of a canal's opening: the polygons within `radii` of the skin nearest `landmark` (`findDisc`). */
function canalDisc(lattice: ReservoirLattice, landmark: Vec3, radii: Vec3): Disc {
  const at = (v: number): Vec3 => [
    lattice.latticePositions[v * 3] as number,
    lattice.latticePositions[v * 3 + 1] as number,
    lattice.latticePositions[v * 3 + 2] as number,
  ];
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (const v of lattice.regionIds) {
    const p = at(v);
    const d = Math.hypot(p[0] - landmark[0], p[1] - landmark[1], p[2] - landmark[2]);
    if (d < far) {
      far = d;
      near = v;
    }
  }
  return findDisc(lattice.polygons, at, at(near), radii);
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
