/**
 * Which base faces the adult pack refines, and how much: the pelvic region the
 * anatomy features live in, graded so the surface stays conforming
 * (`refineGraded`).
 *
 * The core (level 2: each base quad becomes 4 by 4, from about 19 mm to 4.7 mm,
 * and 2.3 mm after the first subdivision level, the size of a texel of the field
 * atlas) is a box round the genital region of the base body: from the lower
 * abdomen over the mons, between the legs and back through the perineum, and 5 cm
 * to either side of the midline, the reach of the labia majora (Kreklau et al.
 * 2018: 8 cm long on average) and the scrotum. Its extent is the CC0
 * `helper-genital` group's (x ±3.4 cm, y −4.3 to +5.5 cm, z 5 to 14.6 cm at rest)
 * widened to the perineum and the folds beside the anatomy. The ring (level 1)
 * is every body face that shares a vertex with the core, which is what keeps
 * neighbouring faces within one level of each other.
 *
 * It is the pack's data, written into its manifest (`anatomy.surface`) so the
 * core refines whatever the pack names and knows nothing of why.
 */
import { groupFaces, type HumanoidAssets } from "../../src/format/assetFormat.ts";

/** The core's box, in the base mesh's metres: |x| < halfWidth, yMin < y < yMax, z > zMin (centroids). */
export const PELVIS_CORE = {
  halfWidth: 0.05,
  yMin: -0.11,
  yMax: 0.05,
  /** Behind this is the gluteal cleft and the buttocks, which the anatomy does not reach. */
  zMin: -0.03,
} as const;

export function pelvicRefinement(assets: HumanoidAssets): { faces: number[]; levels: number[] } {
  const P = assets.positions;
  const body = Array.from(groupFaces(assets, "body"));
  const corner = (f: number, i: number) => assets.faceVerts[f * 4 + i] as number;
  const inCore = (f: number) => {
    const c = [0, 1, 2].map(
      (k) => [0, 1, 2, 3].reduce((s, i) => s + (P[corner(f, i) * 3 + k] as number), 0) / 4,
    ) as [number, number, number];
    return (
      Math.abs(c[0]) < PELVIS_CORE.halfWidth &&
      c[1] > PELVIS_CORE.yMin &&
      c[1] < PELVIS_CORE.yMax &&
      c[2] > PELVIS_CORE.zMin
    );
  };
  const core = body.filter(inCore);
  const coreFaces = new Set(core);
  const coreVerts = new Set(core.flatMap((f) => [0, 1, 2, 3].map((i) => corner(f, i))));
  const ring = body.filter(
    (f) => !coreFaces.has(f) && [0, 1, 2, 3].some((i) => coreVerts.has(corner(f, i))),
  );
  return {
    faces: [...core, ...ring],
    levels: [...core.map(() => 2), ...ring.map(() => 1)],
  };
}
