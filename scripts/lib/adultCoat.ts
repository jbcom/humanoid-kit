/**
 * The adult anatomy pack's coat regions (`AdultAnatomySpec.coatRegions`):
 * where the core's adult-only coat regions grow, measured on the base mesh.
 * It is the pack's data, so the core names none of it (`pnpm check:pages`).
 *
 * Today pubic hair's area (docs/research/BODY-HAIR.md, "Pubic hair"), in the
 * frame of the mons: the centre of the mons target's displacement, weighted by
 * it. Its upper edge is a level hairline above the mons; its sides narrow from
 * there to the crotch; it runs on under the crotch toward the perineum, on the
 * pelvis's front and not round onto the buttocks. Every edge eases over a
 * centimetre or more. How far it rises (the escutcheon up the linea, more in
 * men) is not this mask's: the trunk's abdomen region covers it, and the body
 * hair model's coverage, by sex and age, says how much grows.
 */
import {
  ADULT_COAT_REGION_IDS,
  type AdultCoatRegionSpec,
  groupFaces,
  type HumanoidAssets,
} from "../../src/format/assetFormat.ts";

/** The target whose displacement is the mons: the frame pubic hair is placed in. */
export const MONS_TARGET = "pelvis/bulge-incr";

/**
 * Above the mons' centre to the hairline, metres: a little above the mons'
 * upper edge (its target reaches 5.4 cm above its centre), a choice in the
 * range of adult hairlines.
 */
const HAIRLINE = 0.075;
/** Below the mons' centre to the crotch, where the sides stop narrowing, metres. */
const CROTCH = 0.05;
/** Below the mons' centre to where the hair ends under the crotch, metres. */
const FLOOR = 0.11;
/** The half-width at the hairline and at the crotch, metres. */
const HALF_WIDTH = { hairline: 0.075, crotch: 0.02 } as const;

const unit = (x: number) => Math.min(1, Math.max(0, x));
const ramp = (lo: number, hi: number, x: number) => {
  const t = unit((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** The mons' centre: its target's displacement-weighted mean position. */
function monsCentre(base: HumanoidAssets): [number, number, number] {
  const t = base.targets.get(MONS_TARGET);
  if (!t) throw new Error(`adult coat regions: the base has no ${MONS_TARGET} target`);
  const P = base.positions;
  let [x, y, z, total] = [0, 0, 0, 0];
  t.indices.forEach((v, i) => {
    const w = Math.hypot(
      t.deltas[i * 3] as number,
      t.deltas[i * 3 + 1] as number,
      t.deltas[i * 3 + 2] as number,
    );
    total += w;
    x += w * (P[v * 3] as number);
    y += w * (P[v * 3 + 1] as number);
    z += w * (P[v * 3 + 2] as number);
  });
  return [x / total, y / total, z / total];
}

/** Pubic hair's mask at a point, in the mons' frame (`ax` the distance from the midline). */
function pubicMask(ax: number, y: number, z: number, mons: [number, number, number]): number {
  const top = mons[1] + HAIRLINE;
  const crotch = mons[1] - CROTCH;
  const floor = mons[1] - FLOOR;
  const down = unit((top - y) / (top - crotch));
  const half = HALF_WIDTH.hairline + (HALF_WIDTH.crotch - HALF_WIDTH.hairline) * down;
  return (
    (1 - ramp(top - 0.01, top + 0.01, y)) *
    ramp(floor - 0.015, floor + 0.015, y) *
    (1 - ramp(half - 0.012, half + 0.012, ax)) *
    // The pelvis's front: not round past the crotch onto the buttocks.
    ramp(mons[2] - 0.09, mons[2] - 0.06, z)
  );
}

/** The pack's coat regions, measured on `base`: each drawn vertex with any of a region, ascending. */
export function adultCoatRegions(base: HumanoidAssets): AdultCoatRegionSpec[] {
  const mons = monsCentre(base);
  const P = base.positions;
  const drawn = new Set<number>();
  for (const f of groupFaces(base, "body"))
    for (let k = 0; k < 4; k++) drawn.add(base.faceVerts[f * 4 + k] as number);
  const vertices: number[] = [];
  const mask: number[] = [];
  for (const v of [...drawn].sort((a, b) => a - b)) {
    const m =
      Math.round(
        pubicMask(
          Math.abs(P[v * 3] as number),
          P[v * 3 + 1] as number,
          P[v * 3 + 2] as number,
          mons,
        ) * 1000,
      ) / 1000;
    if (m > 0) {
      vertices.push(v);
      mask.push(m);
    }
  }
  return [{ id: ADULT_COAT_REGION_IDS[0], vertices, mask }];
}
