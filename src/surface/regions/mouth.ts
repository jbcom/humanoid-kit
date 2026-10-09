/**
 * The mouth's lining. Inside the lips the surface is mucosa, not skin: a thin,
 * unkeratinised epithelium over blood, red where skin is tan. The body mesh
 * carries one UV-mapped surface from the lips inward and the lip layer stops at
 * the lips' volume, so the mouth's inside took the skin's own colour, and with
 * the jaw dropped it read as a wall of skin.
 *
 * The lining is found from data the pack already has. Its seeds are what the
 * closed lips enclose (the body's cavity occlusion at rest, `BodyOcclusion`),
 * within the mouth, which the lip joints place; the nostrils, ear canals and
 * eye sockets are enclosed too and are not the mouth's, so the region keeps
 * them out. From the seeds the lining spreads along the mesh's own edges to
 * the vertices behind the lips: the pocket's far end, which the mesh leaves
 * open and whose enclosure no ray can measure, is joined to the lips by edges
 * and by nothing else, so this reaches it and never the skin outside.
 */
import type { HumanoidAssets } from "../../format/assetFormat.ts";
import { jointPosition } from "../../format/assetFormat.ts";
import { vertexAdjacency } from "../../makehuman/regions.ts";
import type { ColourLayer } from "../layers.ts";
import { lipAlbedo, type Rgb, type SkinTone } from "../skinTone.ts";

const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Half the mouth's width, and how far it reaches below and above the lips' centre, metres. */
const HALF_WIDTH = 0.032;
const REACH: readonly [number, number] = [0.045, 0.025];
/** How far behind the lips the mouth reaches before the mesh ends, metres. */
const DEPTH = 0.14;
/** How far the region's edge fades over, metres. */
const EDGE = 0.006;
/** Enclosure at rest (1 − occlusion) that seeds the lining: none below the first, all above the second. */
const ENCLOSED: readonly [number, number] = [0.3, 0.7];
/** The least enclosure the lining spreads through while it is still near the lips. */
const SPREADS_THROUGH = 0.1;
/** Deeper behind the lips than this the lining spreads through anything: only the mouth is there. */
const FAR_END = 0.035;

/** Per base vertex: how much of the mouth's lining it is, 0..1. */
export function mouthInteriorMask(assets: HumanoidAssets): Float32Array {
  const n = assets.manifest.vertexCount;
  const out = new Float32Array(n);
  const occlusion = assets.bodyOcclusion;
  if (!occlusion) return out;
  // The lips' joints: the centre of the opening and how far forward it is.
  const upper = new Float32Array(3);
  const lower = new Float32Array(3);
  jointPosition(assets, assets.positions, "oris05____head", upper);
  jointPosition(assets, assets.positions, "oris01____head", lower);
  const cy = ((upper[1] as number) + (lower[1] as number)) / 2;
  const front = Math.max(upper[2] as number, lower[2] as number);
  const P = assets.positions;
  /** 1 inside the mouth's region, fading to 0 across its edge. */
  const region = (v: number) => {
    const x = P[v * 3] as number;
    const y = P[v * 3 + 1] as number;
    const z = P[v * 3 + 2] as number;
    return (
      (1 - smoothstep(HALF_WIDTH - EDGE, HALF_WIDTH, Math.abs(x))) *
      smoothstep(cy - REACH[0] - EDGE, cy - REACH[0], y) *
      (1 - smoothstep(cy + REACH[1] - EDGE, cy + REACH[1], y)) *
      smoothstep(front - DEPTH, front - DEPTH + EDGE, z) *
      (1 - smoothstep(front, front + EDGE, z))
    );
  };
  const inRegion = new Float32Array(n);
  for (let v = 0; v < n; v++) inRegion[v] = region(v);
  // Seeds: enclosed at rest, in the region.
  const enclosed = new Float32Array(n);
  occlusion.vertices.forEach((v, i) => {
    enclosed[v] = 1 - (occlusion.values[i] as number) / 255;
  });
  const queue: number[] = [];
  occlusion.vertices.forEach((v) => {
    const seed =
      smoothstep(ENCLOSED[0], ENCLOSED[1], enclosed[v] as number) * (inRegion[v] as number);
    if (seed > 0) {
      out[v] = seed;
      if (seed > 0.5) queue.push(v);
    }
  });
  // Spread along edges through the region, at the region's own weight.
  const adjacency = vertexAdjacency(n, assets.faceVerts);
  const seen = new Uint8Array(n);
  for (const v of queue) seen[v] = 1;
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head] as number;
    for (let k = adjacency.start[v] as number; k < (adjacency.start[v + 1] as number); k++) {
      const w = adjacency.list[k] as number;
      if (seen[w] || (inRegion[w] as number) <= 0) continue;
      // Past the lips only through what is enclosed, or what lies deep: the outer
      // skin of the chin below the lower lip is neither, though it joins the lips' edge.
      if ((enclosed[w] as number) < SPREADS_THROUGH && (P[w * 3 + 2] as number) > front - FAR_END)
        continue;
      seen[w] = 1;
      out[w] = Math.max(out[w] as number, inRegion[w] as number);
      queue.push(w);
    }
  }
  return out;
}

/**
 * The mucosa's albedo: the measured lip colour at its deepest (`lipAlbedo`),
 * which is the same epithelium over the same blood, continued inward from the
 * lips. It follows the skin tone as the lips do.
 */
export function mucosaAlbedo(tone: SkinTone): Rgb {
  return lipAlbedo(tone, 1);
}

export const MOUTH_INTERIOR_LAYER: ColourLayer = {
  id: "mouth-interior",
  blend: "mix",
  targets: [],
  fields: (assets) => ({ mask: mouthInteriorMask(assets), coord: null }),
  paint: ({ tone }) => ({ strength: 0.95, stops: [mucosaAlbedo(tone)] }),
};
