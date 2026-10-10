/**
 * The nails. The base mesh sculpts each nail but has no nail geometry of its
 * own, so they are drawn on the back of each fingertip: a coordinate along
 * the last segment carries the proximal fold, lunula, bed and free edge as
 * colour stops (painted with the knuckles, `DIGIT_LAYER`), and a surface
 * layer the plate's gloss. Every magnitude cites docs/research/SKIN-STATES.md
 * Part C5 or is marked there as a choice.
 */
import type { HumanoidAssets } from "../../../format/assetFormat.ts";
import type { SkinLayerFields, SurfaceLayer } from "../../layers.ts";
import { handFrame, smoothstep } from "./frame.ts";

/**
 * Where each nail lies on its digit's last segment, as fractions of that
 * segment from its joint to the tip: the proximal fold's start, the cuticle
 * (where the plate emerges), the lunula's end and the free edge's start. The
 * mesh sculpts each nail; these follow the sculpt (measured on the base mesh's
 * dorsal profile). The lunula is largest on the thumb and least visible on the
 * little finger, as its visibility by finger is (SKIN-STATES.md C5); its size
 * is a CHOICE.
 */
export const NAIL_LAYOUT: readonly {
  fold: number;
  cuticle: number;
  lunula: number;
  freeEdge: number;
}[] = [
  { fold: 0.4, cuticle: 0.52, lunula: 0.62, freeEdge: 0.97 },
  { fold: 0.34, cuticle: 0.45, lunula: 0.51, freeEdge: 0.965 },
  { fold: 0.34, cuticle: 0.45, lunula: 0.5, freeEdge: 0.965 },
  { fold: 0.34, cuticle: 0.45, lunula: 0.48, freeEdge: 0.965 },
  { fold: 0.34, cuticle: 0.45, lunula: 0.46, freeEdge: 0.965 },
];

/** How far the lunula and free edge bow toward the tip at the nail's middle, fraction of the segment (CHOICE). */
const NAIL_BOW = 0.03;
/** The nail's half-width as a fraction of the fingertip's radius, and the width of its soft edge (CHOICE). */
const NAIL_HALF_WIDTH = 0.62;
const NAIL_EDGE = 0.18;
/** Half the width of a sharp colour edge on the nail, metres. */
export const NAIL_SHARP = 0.0004;

/**
 * The nail coordinate at fraction `u` of the last segment: its eight stops are
 * fold, fold, lunula, lunula, bed, bed, free edge, free edge, and each colour
 * changes sharply at the cuticle, the lunula's end and the free edge.
 */
export function nailCoordinate(
  u: number,
  layout: (typeof NAIL_LAYOUT)[number],
  sharp: number,
): number {
  const lunula = Math.max(layout.lunula, layout.cuticle + 2 * sharp);
  const knots: [number, number][] = [
    [layout.fold, 0],
    [layout.cuticle - sharp, 1],
    [layout.cuticle + sharp, 2],
    [lunula - sharp, 3],
    [lunula + sharp, 4],
    [layout.freeEdge - sharp, 5],
    [layout.freeEdge + sharp, 6],
    [1, 7],
  ];
  if (u <= (knots[0] as [number, number])[0]) return 0;
  for (let k = 1; k < knots.length; k++) {
    const [u1, c1] = knots[k] as [number, number];
    const [u0, c0] = knots[k - 1] as [number, number];
    if (u <= u1) return (c0 + ((u - u0) / Math.max(1e-9, u1 - u0)) * (c1 - c0)) / 7;
  }
  return 1;
}

const nailCache = new WeakMap<HumanoidAssets, { colour: SkinLayerFields; gloss: Float32Array }>();

/** The nails' fields: the colour layer's mask and coordinate, and the plate's gloss mask. */
export function nailFields(assets: HumanoidAssets): {
  colour: SkinLayerFields;
  gloss: Float32Array;
} {
  const known = nailCache.get(assets);
  if (known) return known;
  const frame = handFrame(assets);
  const n = assets.manifest.vertexCount;
  const mask = new Float32Array(n);
  const coord = new Float32Array(n);
  const gloss = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const digit = frame.digit[v] as number;
    if (digit === 0) continue;
    const side = frame.side[v] as number;
    const joints = (frame.joints[side] as number[][])[digit] as number[];
    const start = joints[2] as number;
    const len = (joints[3] as number) - start;
    const r = ((frame.radius[side] as number[])[digit] as number) || 0.007;
    const across = frame.across[v] as number;
    const bow = NAIL_BOW * (1 - (across / (NAIL_HALF_WIDTH * r)) ** 2);
    const u = ((frame.along[v] as number) - start) / len + bow;
    const layout = NAIL_LAYOUT[digit - 1] as (typeof NAIL_LAYOUT)[number];
    if (u < layout.fold - 0.1) continue;
    const width =
      1 - smoothstep(NAIL_HALF_WIDTH * r, (NAIL_HALF_WIDTH + NAIL_EDGE) * r, Math.abs(across));
    // The nail faces the back of the hand; at the tip it curls over toward the front.
    const facing = smoothstep(-0.25, 0.25, -(frame.volar[v] as number));
    const sharp = NAIL_SHARP / len;
    const m = width * facing * smoothstep(layout.fold - 0.08, layout.fold, u);
    mask[v] = m;
    coord[v] = nailCoordinate(u, layout, sharp);
    gloss[v] = m * smoothstep(layout.cuticle - sharp, layout.cuticle + sharp, u);
  }
  const fields = { colour: { mask, coord }, gloss };
  nailCache.set(assets, fields);
  return fields;
}

/**
 * The nail plates: attachments of these kinds in the body pack (CC0 nail
 * meshes, `scripts/lib/nailPlates.ts`), drawn translucent over the painted
 * bed, lunula and fold, so the bed's colour shows through the plate at every
 * tone, and whiter and more opaque along the free edge, where there is no bed
 * under the plate.
 */
export const NAIL_PLATE_KINDS: readonly string[] = ["fingernails", "toenails"];

/**
 * How opaque the plate is over the bed, and at its free edge (CHOICES: the
 * plate is clear keratin that transmits most light, so the bed shows through;
 * the free edge, with air under it, scatters as white keratin).
 */
export const NAIL_PLATE_OPACITY = 0.18;
export const NAIL_FREE_EDGE_OPACITY = 0.85;

/**
 * How long the free edge is, metres from the plate's tip, and how soft its
 * start (CHOICES: a short nail's free edge is a millimetre or two).
 */
export const NAIL_FREE_EDGE_LENGTH = 0.0015;
export const NAIL_FREE_EDGE_SOFT = 0.0005;

/**
 * How much of the free edge each plate vertex is (0 over the bed, 1 at the
 * tip), for a plate mesh of several nails: each nail is a connected piece of
 * the mesh; its direction from cuticle to tip is the way the skin's nail
 * coordinate (`along`, the knuckles' and nails' coordinate of the skin each
 * vertex is bound to) grows across it; and its free edge is its last
 * `NAIL_FREE_EDGE_LENGTH` along that direction. `positions` are the plate's
 * at rest, metres.
 */
export function nailPlateEdges(
  positions: Float32Array,
  faceVerts: Uint32Array,
  along: Float32Array,
): Float32Array {
  const n = along.length;
  // The nails: connected pieces of the plate mesh.
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  for (let f = 0; f < faceVerts.length; f += 4)
    for (let k = 1; k < 4; k++)
      parent[root(faceVerts[f + k] as number)] = root(faceVerts[f] as number);
  const pieces = new Map<number, number[]>();
  for (let v = 0; v < n; v++) {
    const r = root(v);
    pieces.set(r, [...(pieces.get(r) ?? []), v]);
  }
  const out = new Float32Array(n);
  const at = (v: number, k: number) => positions[v * 3 + k] as number;
  for (const verts of pieces.values()) {
    // Cuticle to tip: the least and most advanced vertices on the skin's coordinate.
    let lo = verts[0] as number;
    let hi = lo;
    for (const v of verts) {
      if ((along[v] as number) < (along[lo] as number)) lo = v;
      if ((along[v] as number) > (along[hi] as number)) hi = v;
    }
    const axis = [0, 1, 2].map((k) => at(hi, k) - at(lo, k));
    const len = Math.hypot(...axis) || 1;
    const dir = axis.map((x) => x / len);
    const reach = (v: number) =>
      (dir[0] as number) * at(v, 0) + (dir[1] as number) * at(v, 1) + (dir[2] as number) * at(v, 2);
    let tip = Number.NEGATIVE_INFINITY;
    for (const v of verts) tip = Math.max(tip, reach(v));
    for (const v of verts)
      out[v] = smoothstep(
        NAIL_FREE_EDGE_LENGTH + NAIL_FREE_EDGE_SOFT,
        NAIL_FREE_EDGE_LENGTH - NAIL_FREE_EDGE_SOFT,
        tip - reach(v),
      );
  }
  return out;
}

/**
 * The nail plate's gloss: hard, smooth keratin over the bed. Roughness and
 * specular changes are CHOICES (no gloss of nails was found measured;
 * SKIN-STATES.md C5), tuned on the contact sheets.
 */
export const NAIL_ROUGHNESS = -0.28;
export const NAIL_SPECULAR = 0.35;

export const NAIL_GLOSS_LAYER: SurfaceLayer = {
  id: "nail-gloss",
  kind: "surface",
  targets: [],
  fields: (assets) => ({ mask: nailFields(assets).gloss, coord: null }),
  paint: () => ({ strength: 1, roughness: NAIL_ROUGHNESS, specular: NAIL_SPECULAR }),
};
