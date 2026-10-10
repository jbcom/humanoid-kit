/**
 * The shape of a mark on the skin (docs/research/BODY-ART.md C2): how much of
 * a mark covers a point, 0 to 1, from the point's place in the mark's frame.
 * The bake draws exactly this (`src/render/bodyArtTexture.ts`, its GLSL twin).
 *
 * - A patch (vitiligo, a café-au-lait macule, a port-wine stain, dermal
 *   pigment) is an ellipsoid round its centre, width by length across the skin
 *   and its smaller half-size deep, so the skin curving away under it counts
 *   as distance just as skin across it does: the patch ends where the surface
 *   carries it, never in a cut where a flat projection would stop. Its edge is
 *   that distance thresholded by seeded noise in the frame's own 3D space, so
 *   the outline is organic, has no polar symmetry, and is the same on both
 *   sides of a UV seam. Vitiligo also throws satellite flecks just outside
 *   its edge, where a finer noise peaks.
 * - A scar is a line: an ellipse with harmonics on its radius and its x
 *   wandering along its length.
 *
 * A naevus, a few millimetres across, is no baked mark: it is a decal, a
 * round, slightly raised dot the skin shader draws exactly
 * (`src/render/bodyArtDecals.ts`).
 */
import { seededRandom } from "../random.ts";
import type { PlacedMark } from "./decals.ts";

/** A patch's outline: CHOICES after the clinical descriptions in BODY-ART.md A2 to A4. */
export interface PatchOutlineKind {
  /** How far the edge moves in and out, a share of the radius (the noise's amplitude). */
  irregular: number;
  /** The noise's cell, a share of the patch's smaller half-size: smaller cells, more and smaller lobes. */
  cell: number;
  /**
   * Half the edge's width, metres, across the outline; or, where `edgeShare`
   * is set, a share of the patch's smaller half-size. It varies by
   * ±`EDGE_VARIATION` along the outline.
   */
  edge: number;
  edgeShare: number;
  /** Whether it throws satellite flecks (`FLECK_*`). */
  flecks: boolean;
}

/**
 * Per patch kind: vitiligo's border scalloped, its transition 1 to 3 mm, with
 * satellite flecks; a café-au-lait macule an oval with a soft, gently
 * irregular edge; a port-wine stain geographic, in soft lobes; a Mongolian
 * spot ill-defined. A naevus is a decal, a round dot drawn exactly.
 */
export const PATCH_OUTLINE: Readonly<
  Record<Exclude<PlacedMark["kind"], "scar" | "naevus">, PatchOutlineKind>
> = {
  vitiligo: { irregular: 0.3, cell: 0.45, edge: 0.0009, edgeShare: 0, flecks: true },
  "cafe-au-lait": { irregular: 0.16, cell: 0.7, edge: 0.0011, edgeShare: 0, flecks: false },
  "port-wine": { irregular: 0.32, cell: 0.4, edge: 0.0011, edgeShare: 0, flecks: false },
  "dermal-melanocytosis": { irregular: 0.2, cell: 0.7, edge: 0, edgeShare: 0.3, flecks: false },
};

/** How much a patch's edge width varies along its outline, a share either way (with the noise). A CHOICE. */
export const EDGE_VARIATION = 0.35;

/**
 * The step of the central differences that measure the outline field's
 * gradient, metres: finer than the noise's finest octave (a cell's quarter).
 */
export const FIELD_STEP = 0.0002;

/**
 * Vitiligo's satellite flecks: a finer noise of cell `FLECK_CELL` metres
 * peaks above `FLECK_THRESHOLD` (±`FLECK_SOFT`), its top 5 or so percent, in
 * spots 1 to 3 mm across, within `FLECK_REACH` of the patch's smaller
 * half-size outside its edge, fading out. CHOICES: "confetti"
 * depigmentation round a patch's border (BODY-ART.md A2).
 */
export const FLECK_CELL = 0.0025;
export const FLECK_THRESHOLD = 0.45;
export const FLECK_SOFT = 0.05;
export const FLECK_REACH = 0.5;

/** A scar's line: its outline's irregularity, how much it wanders across (a share of its half-width), and its edge, metres. */
export const SCAR_OUTLINE = { irregular: 0, wander: 0.15, edge: 0.00025 } as const;

/** A mark's outline, from its kind and seed. */
export interface MarkOutline {
  /** A patch (noise-thresholded ellipsoid) rather than a scar (harmonic line). */
  patch: boolean;
  /** A scar's harmonics 2 to 5 of its radius, and its line's wander. */
  amplitude: [number, number, number, number];
  phase: [number, number, number, number];
  wander: number;
  wanderPhase: number;
  /** A patch's noise: its offset in lattice cells, its cell (metres) and amplitude. */
  offset: [number, number, number];
  cell: number;
  irregular: number;
  /** Vitiligo's flecks, 0 or 1, and their noise's offset. */
  flecks: number;
  fleckOffset: [number, number, number];
  /** The edge's half-width: a scar's a share of its half-size, a patch's metres. */
  soft: number;
}

/** The outline a mark's kind and seed give it (deterministic). */
export function markOutline(mark: PlacedMark): MarkOutline {
  const rand = seededRandom(mark.seed);
  const half = Math.min(Math.abs(mark.width), mark.length) / 2;
  const offset = () => [rand() * 64, rand() * 64, rand() * 64] as [number, number, number];
  const base = {
    amplitude: [0, 0, 0, 0] as MarkOutline["amplitude"],
    phase: [0, 0, 0, 0] as MarkOutline["phase"],
    wander: 0,
    wanderPhase: 0,
    offset: [0, 0, 0] as MarkOutline["offset"],
    cell: 1,
    irregular: 0,
    flecks: 0,
    fleckOffset: [0, 0, 0] as MarkOutline["fleckOffset"],
  };
  if (mark.kind === "scar")
    return {
      ...base,
      patch: false,
      amplitude: [0, 1, 2, 3].map(
        (i) => (SCAR_OUTLINE.irregular * (0.5 + rand())) / (i + 2),
      ) as MarkOutline["amplitude"],
      phase: [0, 1, 2, 3].map(() => rand() * Math.PI * 2) as MarkOutline["phase"],
      wander: SCAR_OUTLINE.wander,
      wanderPhase: rand() * Math.PI * 2,
      soft: SCAR_OUTLINE.edge / Math.max(1e-6, half),
    };
  if (mark.kind === "naevus")
    throw new RangeError("a naevus is a decal (bodyArtDecals.ts), not a baked mark");
  const o = PATCH_OUTLINE[mark.kind];
  return {
    ...base,
    patch: true,
    offset: offset(),
    cell: o.cell * half,
    irregular: o.irregular,
    flecks: o.flecks ? 1 : 0,
    fleckOffset: offset(),
    soft: o.edgeShare ? o.edgeShare * half : o.edge,
  };
}

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** A 32-bit integer hash of a lattice point (the GLSL twin uses the same uint arithmetic). */
function hash(x: number, y: number, z: number): number {
  let h =
    (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f)) >>>
    0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise at p, 0 to 1: the lattice's hashed values, blended by a quintic. */
function valueNoise(px: number, py: number, pz: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const [u, v, w] = [fade(px - ix), fade(py - iy), fade(pz - iz)];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/** Three octaves of value noise, -1 to 1. */
export function markNoise(px: number, py: number, pz: number): number {
  let sum = 0;
  let amp = 1;
  let f = 1;
  for (let o = 0; o < 3; o++) {
    sum += amp * (2 * valueNoise(px * f, py * f, pz * f) - 1);
    amp *= 0.5;
    f *= 2;
  }
  return sum / 1.75;
}

/**
 * How much of a mark covers the point (`x`, `y`, `z`) metres along its right,
 * up and normal from its centre, 0 to 1 (a negative width mirrors the mark).
 * The bake draws exactly this.
 */
export function markShape(
  mark: PlacedMark,
  outline: MarkOutline,
  x: number,
  y: number,
  z = 0,
): number {
  const hw = Math.abs(mark.width) / 2;
  const hl = mark.length / 2;
  if (!outline.patch) {
    const px = x / (mark.width / 2);
    const py = y / hl;
    const qx = px - outline.wander * Math.sin(Math.PI * 1.5 * py + outline.wanderPhase);
    const theta = Math.atan2(py, qx);
    let r = 1;
    for (let i = 0; i < 4; i++)
      r +=
        (outline.amplitude[i] as number) * Math.sin((i + 2) * theta + (outline.phase[i] as number));
    return 1 - smoothstep(r - outline.soft, r + outline.soft, Math.hypot(qx, py));
  }
  // The frame's own space, mirrored with the mark.
  const lx = mark.width < 0 ? -x : x;
  const h0 = Math.min(hw, hl);
  const reach = FLECK_REACH * h0 * outline.flecks;
  // Past the furthest the edge, its softness and the flecks reach: nothing.
  if (
    Math.hypot(lx / hw, y / hl, z / h0) >
    1 + outline.irregular + (outline.soft * (1 + EDGE_VARIATION) + reach) / h0 + 0.05
  )
    return 0;
  const [ox, oy, oz] = outline.offset;
  const noise = (px: number, py: number, pz: number) =>
    markNoise(px / outline.cell + ox, py / outline.cell + oy, pz / outline.cell + oz);
  // The outline field: the ellipsoid's radius less the noise's, negative inside.
  const field = (px: number, py: number, pz: number) =>
    Math.hypot(px / hw, py / hl, pz / h0) - 1 - outline.irregular * noise(px, py, pz);
  const h = FIELD_STEP;
  const gradient =
    Math.hypot(
      field(lx + h, y, z) - field(lx - h, y, z),
      field(lx, y + h, z) - field(lx, y - h, z),
      field(lx, y, z + h) - field(lx, y, z - h),
    ) /
    (2 * h);
  // The distance to the outline, metres (the field over its gradient), and the edge's half-width there.
  const d = field(lx, y, z) / Math.max(1e-6, gradient);
  const edge = outline.soft * (1 + EDGE_VARIATION * noise(lx, y, z));
  const main = 1 - smoothstep(-edge, edge, d);
  if (!outline.flecks) return main;
  const [fx, fy, fz] = outline.fleckOffset;
  const spot = smoothstep(
    FLECK_THRESHOLD - FLECK_SOFT,
    FLECK_THRESHOLD + FLECK_SOFT,
    markNoise(lx / FLECK_CELL + fx, y / FLECK_CELL + fy, z / FLECK_CELL + fz),
  );
  return Math.max(main, spot * (1 - smoothstep(0, reach, d)));
}
