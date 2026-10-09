/**
 * The body's own occlusion (docs/ARCHITECTURE.md, "Body occlusion"): the inside
 * of the mouth, the nostrils, the ear canals and the eye sockets are enclosed
 * by the figure, and lit as open skin they read as a flat wall. The pack
 * stores, for the few vertices that are ever enclosed, how enclosed they are at
 * each corner of the `OCCLUSION_KEYS` cube; every other vertex is open.
 *
 * What is stored is `cavityOcclusion` of the baked visibility, so a vertex
 * leaves the stored set exactly where its value reaches fully open, and no
 * step shows at the set's edge.
 */
import type { BodyOcclusion, HumanoidAssets } from "../format/assetFormat.ts";
import { groupFaces } from "../format/assetFormat.ts";
import { regionOfBone } from "../makehuman/regions.ts";

/**
 * Visibility at or above this counts as fully open. Open skin is never fully
 * visible (a cheek sees past the nose, a lid past the brow); only enclosure
 * beyond that is a cavity.
 */
export const OPEN_VISIBILITY = 0.85;

/** The stored occlusion for a baked visibility in [0, 1]: 1 at `OPEN_VISIBILITY` and above, linear below. */
export function cavityOcclusion(visibility: number): number {
  return Math.min(1, Math.max(0, visibility / OPEN_VISIBILITY));
}

/**
 * The visible body's vertices a head, jaw, tongue, eye or face-muscle bone
 * moves, ascending: where a cavity can be. A vertex any such bone touches is
 * included, so no crease is cut off at the edge of the face.
 */
export function cavityCandidates(assets: HumanoidAssets): Uint32Array {
  const head = assets.manifest.skeleton.bones.map((b) => regionOfBone(b.name) === "head");
  const visible = new Set<number>();
  for (const f of groupFaces(assets, "body"))
    for (let k = 0; k < 4; k++) visible.add(assets.faceVerts[f * 4 + k] as number);
  const out: number[] = [];
  for (const v of visible) {
    for (let k = 0; k < 4; k++) {
      if (
        (assets.skinWeight[v * 4 + k] as number) > 0 &&
        head[assets.skinIndex[v * 4 + k] as number]
      ) {
        out.push(v);
        break;
      }
    }
  }
  return Uint32Array.from(out.sort((a, b) => a - b));
}

/**
 * Keeps the candidates enclosed at some corner. `bakes` holds each corner's
 * visibility per candidate, corner 0 (rest) first.
 */
export function selectCavity(
  candidates: Uint32Array,
  bakes: readonly Float32Array[],
): BodyOcclusion {
  if (bakes.some((b) => b.length !== candidates.length))
    throw new RangeError("selectCavity: every bake needs one value per candidate");
  const kept: number[] = [];
  candidates.forEach((_, i) => {
    if (bakes.some((b) => (b[i] as number) < OPEN_VISIBILITY)) kept.push(i);
  });
  const values = new Uint8Array(kept.length * bakes.length);
  bakes.forEach((b, corner) => {
    kept.forEach((i, k) => {
      values[corner * kept.length + k] = Math.round(cavityOcclusion(b[i] as number) * 255);
    });
  });
  return { vertices: Uint32Array.from(kept, (i) => candidates[i] as number), values };
}

/**
 * One corner's occlusion per base vertex in [0, 1]: stored vertices hold their
 * value, every other vertex is open.
 */
export function expandBodyOcclusion(
  occlusion: BodyOcclusion,
  vertexCount: number,
  corner: number,
): Float32Array {
  const n = occlusion.vertices.length;
  if (!Number.isInteger(corner) || corner < 0 || (corner + 1) * n > occlusion.values.length)
    throw new RangeError(`body occlusion has no corner ${corner}`);
  const out = new Float32Array(vertexCount).fill(1);
  occlusion.vertices.forEach((v, i) => {
    if (v >= vertexCount) throw new RangeError(`body occlusion vertex ${v} is not in the mesh`);
    out[v] = (occlusion.values[corner * n + i] as number) / 255;
  });
  return out;
}
