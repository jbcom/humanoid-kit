/**
 * Where vitiligo's patches lie (docs/research/BODY-ART.md, A2 and C2).
 * Non-segmental vitiligo, the common form, favours the skin round the eyes and
 * mouth, the backs of the hands and the wrists, the elbows and knees and the
 * tops of the feet, and spreads symmetrically, so each patch is placed on the
 * left at one of those sites and mirrored to the right (the base mesh is
 * mirrored exactly). How many patches and how large follows `extent`; where,
 * the seed. The patches are marks of kind `"vitiligo"`, baked like the others.
 */

import { quadVertexNormals, unitNormals } from "../build/normals.ts";
import { groupFaces, type HumanoidAssets, jointPosition } from "../format/assetFormat.ts";
import { seededRandom } from "../random.ts";
import type { Vitiligo } from "../recipe/bodyArt.ts";
import { handFrame } from "../surface/regions/hands/frame.ts";

/** A patch: its centre vertex on each side, its size across (metres) and its outline's seed. */
export interface VitiligoPatch {
  vertices: [number, number];
  size: number;
  seed: number;
}

/**
 * The sites, each the skin within a band of distances of a joint (metres),
 * facing a direction, with how often a patch is placed there. Weights and
 * bands are CHOICES following where non-segmental vitiligo is reported most.
 */
const SITES: readonly {
  name: string;
  joints: readonly string[];
  band: [number, number];
  facing: [number, number, number] | null;
  weight: number;
}[] = [
  {
    name: "eyes",
    joints: ["eye.L____head"],
    band: [0.016, 0.035],
    facing: [0, 0, 1],
    weight: 0.15,
  },
  {
    name: "mouth",
    joints: ["oris01____head", "oris05____head"],
    band: [0.012, 0.035],
    facing: [0, 0, 1],
    weight: 0.15,
  },
  { name: "wrists", joints: ["wrist.L____head"], band: [0, 0.035], facing: null, weight: 0.1 },
  {
    name: "elbows",
    joints: ["lowerarm01.L____head"],
    band: [0, 0.045],
    facing: [0, 0, -1],
    weight: 0.1,
  },
  {
    name: "knees",
    joints: ["lowerleg01.L____head"],
    band: [0, 0.055],
    facing: [0, 0, 1],
    weight: 0.1,
  },
  { name: "feet", joints: ["foot.L____tail"], band: [0, 0.06], facing: [0, 1, 0], weight: 0.1 },
];
/** The backs of the hands: the hand frame's dorsal skin. */
const HANDS_WEIGHT = 0.3;

/** Patches at extent 0 and 1 (pairs), and their size across at those extents, metres: CHOICES. */
export const VITILIGO_PATCHES: [number, number] = [2, 14];
export const VITILIGO_SIZE: [number, number] = [0.015, 0.06];

const cache = new WeakMap<
  HumanoidAssets,
  { regions: number[][]; weights: number[]; mirror: Int32Array }
>();

/** The left-side skin vertices of each site, and each vertex's mirror image. */
function sites(assets: HumanoidAssets) {
  const known = cache.get(assets);
  if (known) return known;
  const P = assets.positions;
  const n = assets.manifest.vertexCount;
  const skin = new Uint8Array(n);
  for (const f of groupFaces(assets, "body"))
    for (let k = 0; k < 4; k++) skin[assets.faceVerts[f * 4 + k] as number] = 1;
  const normals = unitNormals(quadVertexNormals(P, assets.faceVerts));
  const at = new Float32Array(3);
  const regions = SITES.map((site) => {
    const centre = [0, 0, 0];
    for (const j of site.joints) {
      jointPosition(assets, P, j, at);
      for (let k = 0; k < 3; k++)
        centre[k] = (centre[k] as number) + (at[k] as number) / site.joints.length;
    }
    const out: number[] = [];
    for (let v = 0; v < n; v++) {
      if (!skin[v] || (P[v * 3] as number) <= 0) continue;
      const d = Math.hypot(
        (P[v * 3] as number) - (centre[0] as number),
        (P[v * 3 + 1] as number) - (centre[1] as number),
        (P[v * 3 + 2] as number) - (centre[2] as number),
      );
      if (d < site.band[0] || d > site.band[1]) continue;
      const f = site.facing;
      if (f) {
        const facing =
          (normals[v * 3] as number) * f[0] +
          (normals[v * 3 + 1] as number) * f[1] +
          (normals[v * 3 + 2] as number) * f[2];
        if (facing < 0.3) continue;
      }
      out.push(v);
    }
    return out;
  });
  const frame = handFrame(assets);
  const hands: number[] = [];
  for (let v = 0; v < n; v++)
    if (skin[v] && frame.digit[v] && frame.side[v] === 0 && (frame.volar[v] as number) < -0.3)
      hands.push(v);
  regions.push(hands);
  // Each vertex's mirror: the vertex at (-x, y, z), found through rounded positions.
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
  const byPosition = new Map<string, number>();
  for (let v = 0; v < n; v++)
    byPosition.set(key(P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number), v);
  const mirror = new Int32Array(n).fill(-1);
  for (let v = 0; v < n; v++)
    mirror[v] =
      byPosition.get(key(-(P[v * 3] as number), P[v * 3 + 1] as number, P[v * 3 + 2] as number)) ??
      -1;
  const out = { regions, weights: [...SITES.map((s) => s.weight), HANDS_WEIGHT], mirror };
  cache.set(assets, out);
  return out;
}

/** Vitiligo's patches for these assets, the same for the same `extent` and seed. */
export function vitiligoPatches(assets: HumanoidAssets, vitiligo: Vitiligo): VitiligoPatch[] {
  const { regions, weights, mirror } = sites(assets);
  const rand = seededRandom(vitiligo.seed);
  const e = Math.min(1, Math.max(0, vitiligo.extent));
  const count = Math.round(VITILIGO_PATCHES[0] + e * (VITILIGO_PATCHES[1] - VITILIGO_PATCHES[0]));
  const size = VITILIGO_SIZE[0] + e * (VITILIGO_SIZE[1] - VITILIGO_SIZE[0]);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: VitiligoPatch[] = [];
  for (let i = 0; i < count; i++) {
    let pick = rand() * total;
    let r = 0;
    while (r < weights.length - 1 && pick >= (weights[r] as number)) pick -= weights[r++] as number;
    const region = regions[r] as number[];
    if (region.length === 0) continue;
    const v = region[Math.floor(rand() * region.length)] as number;
    const m = mirror[v] as number;
    if (m < 0) continue;
    out.push({
      vertices: [v, m],
      size: size * (0.6 + 0.8 * rand()),
      seed: Math.floor(rand() * 2 ** 31),
    });
  }
  return out;
}
