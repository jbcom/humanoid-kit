/**
 * Body regions for independent traits, derived from the MakeHuman default
 * skeleton's skin weights. Skin weights already fall off smoothly across
 * joints, so summing the weights of each region's bones gives soft masks that
 * blend naturally at the neck, shoulders, waist and hips. A few rounds of
 * neighbour averaging widen the transitions so regional shape differences
 * never leave a visible step.
 */
import type { HumanoidAssets } from "../format/assetFormat.ts";
import type { RegionField } from "../morph/evaluate.ts";

export const BODY_REGIONS = [
  "head",
  "neck",
  "chest",
  "breastL",
  "breastR",
  "arms",
  "hands",
  "abdomen",
  "pelvis",
  "legs",
  "feet",
] as const;
export type BodyRegion = (typeof BODY_REGIONS)[number];

/** Which region a bone's skin weight counts towards. */
export function regionOfBone(bone: string): BodyRegion {
  if (bone === "breast.L") return "breastL";
  if (bone === "breast.R") return "breastR";
  if (/^neck0/.test(bone)) return "neck";
  if (/^(spine01|spine02|clavicle)/.test(bone)) return "chest";
  if (/^(spine03|spine04)$/.test(bone)) return "abdomen";
  if (/^(spine05|root|pelvis|upperleg01)/.test(bone)) return "pelvis";
  if (/^(upperleg02|lowerleg)/.test(bone)) return "legs";
  if (/^(foot|toe)/.test(bone)) return "feet";
  if (/^(shoulder|upperarm|lowerarm)/.test(bone)) return "arms";
  if (/^(wrist|metacarpal|finger)/.test(bone)) return "hands";
  return "head";
}

/** Undirected vertex adjacency (CSR) from quad faces. */
export function vertexAdjacency(
  vertexCount: number,
  faceVerts: Uint32Array,
): { start: Uint32Array; list: Uint32Array } {
  const sets: Set<number>[] = Array.from({ length: vertexCount }, () => new Set());
  for (let f = 0; f < faceVerts.length; f += 4) {
    for (let k = 0; k < 4; k++) {
      const a = faceVerts[f + k] as number;
      const b = faceVerts[f + ((k + 1) % 4)] as number;
      sets[a]?.add(b);
      sets[b]?.add(a);
    }
  }
  const start = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v++) start[v + 1] = (start[v] as number) + (sets[v]?.size ?? 0);
  const list = new Uint32Array(start[vertexCount] as number);
  for (let v = 0; v < vertexCount; v++) {
    let k = start[v] as number;
    for (const n of sets[v] ?? []) list[k++] = n;
  }
  return { start, list };
}

/**
 * Builds the region field. `smoothing` rounds of neighbour averaging widen
 * transitions; masks are renormalised afterwards so they stay a partition of
 * unity. Vertices with no skin weight (joint marker cubes) fall to `chest` so
 * every vertex belongs somewhere.
 */
export function buildRegionField(assets: HumanoidAssets, smoothing = 6): RegionField {
  return buildBoneField(
    assets,
    BODY_REGIONS,
    (bone) => BODY_REGIONS.indexOf(regionOfBone(bone)),
    BODY_REGIONS.indexOf("chest"),
    smoothing,
  );
}

/**
 * The same construction for any partition of the skeleton: `zoneOfBone` names
 * the index in `names` each bone's weight counts towards (skin states split the
 * limbs and trunk more finely than the shape traits do), and vertices with no
 * skin weight fall to zone `fallback`.
 */
export function buildBoneField(
  assets: HumanoidAssets,
  names: readonly string[],
  zoneOfBone: (bone: string) => number,
  fallback: number,
  smoothing = 6,
): RegionField {
  const n = assets.manifest.vertexCount;
  const R = names.length;
  const boneRegion = assets.manifest.skeleton.bones.map((b) => zoneOfBone(b.name));
  let masks = names.map(() => new Float32Array(n));
  for (let v = 0; v < n; v++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = assets.skinWeight[v * 4 + k] as number;
      if (w <= 0) continue;
      const r = boneRegion[assets.skinIndex[v * 4 + k] as number] as number;
      (masks[r] as Float32Array)[v] = ((masks[r] as Float32Array)[v] as number) + w;
      sum += w;
    }
    if (sum === 0) (masks[fallback] as Float32Array)[v] = 1;
  }
  const adj = vertexAdjacency(n, assets.faceVerts);
  for (let it = 0; it < smoothing; it++) {
    const next = names.map(() => new Float32Array(n));
    for (let v = 0; v < n; v++) {
      const s = adj.start[v] as number;
      const e = adj.start[v + 1] as number;
      for (let r = 0; r < R; r++) {
        const m = masks[r] as Float32Array;
        let acc = m[v] as number;
        for (let k = s; k < e; k++) acc += m[adj.list[k] as number] as number;
        (next[r] as Float32Array)[v] = acc / (1 + e - s);
      }
    }
    masks = next;
  }
  for (let v = 0; v < n; v++) {
    let sum = 0;
    for (let r = 0; r < R; r++) sum += (masks[r] as Float32Array)[v] as number;
    if (sum > 0)
      for (let r = 0; r < R; r++)
        (masks[r] as Float32Array)[v] = ((masks[r] as Float32Array)[v] as number) / sum;
  }
  return { names, masks };
}
