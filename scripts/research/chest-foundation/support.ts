/**
 * The chest support: which base vertices a chest foundation may move, chosen ONCE
 * on a canonical figure by figure-relative coordinates (lengths in units of the
 * figure's own half-span and rise, never metres), then used by index on every
 * figure. Because membership is by vertex index, the support follows any body, and
 * "the boundary does not move" is a topological fact, not a coordinate test.
 */
import type { BodyManifest, HumanoidAssets } from "../../../src/format/assetFormat.ts";
import type { Anchors } from "./figure.ts";
import { type BodyMesh, hopDistance, vertexNormals } from "./mesh.ts";

export interface Support {
  /** Vertices inside the footprint ellipse (either side), by index. */
  inside: Uint8Array;
  /** Vertices free to move: inside, and at least two hops from outside. */
  free: Uint32Array;
  /** Per vertex: the side it belongs to (-1 none, 0 = x<0 'R'..., see `sideOf`). */
  side: Int8Array;
}

/** Figure-relative chest coordinates of a point for one side: u lateral from the apex, v downward from it. */
export function chestUV(p: readonly number[], a: Anchors, side: "L" | "R") {
  const A = a.apex[side];
  return {
    u: (Math.abs(p[0] as number) - Math.abs(A[0])) / a.halfSpan,
    v: (A[1] - (p[1] as number)) / a.rise,
  };
}

export interface SupportShape {
  /** Footprint semi-axes in (halfSpan, rise) units. */
  au: number;
  bUp: number;
  bDown: number;
  /** A vertex's normal must face this far forward (cosine on +z) to count as chest front. */
  minFront: number;
  /** Half-width of the sternal strip, in halfSpan units, kept out of the support. */
  sternum: number;
}

export const SUPPORT: SupportShape = {
  au: 1.05,
  bUp: 0.95,
  bDown: 1.15,
  minFront: -2,
  sternum: 0.15,
};

/** Vertices whose weight on the arm chain (upper arm, forearm, wrist, hand, fingers) is small: the trunk. */
export function trunkMask(assets: HumanoidAssets, manifest: BodyManifest): Uint8Array {
  const armBones = new Set<number>();
  manifest.skeleton.bones.forEach((b, i) => {
    if (/^(upperarm|lowerarm|wrist|metacarpal|finger|hand|shoulder01)/.test(b.name))
      armBones.add(i);
  });
  const out = new Uint8Array(manifest.vertexCount);
  for (let v = 0; v < manifest.vertexCount; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++)
      if (armBones.has(assets.skinIndex[v * 4 + k] as number))
        w += assets.skinWeight[v * 4 + k] as number;
    out[v] = w <= 0.3 ? 1 : 0;
  }
  return out;
}

export function chooseSupport(
  mesh: BodyMesh,
  control: Float32Array,
  a: Anchors,
  trunk: Uint8Array,
  shape: SupportShape = SUPPORT,
): Support {
  const n = mesh.vertexCount;
  const inside = new Uint8Array(n);
  const side = new Int8Array(n).fill(-1);
  const normals = vertexNormals(mesh, control);
  for (const v of mesh.vertices) {
    const p = [control[v * 3], control[v * 3 + 1], control[v * 3 + 2]] as number[];
    const s: "L" | "R" = (p[0] as number) >= 0 ? "L" : "R";
    if (Math.abs(p[0] as number) < shape.sternum * a.halfSpan) continue;
    if (!trunk[v] || (normals[v * 3 + 2] as number) < shape.minFront) continue;
    if ((p[2] as number) < 0.15 * a.apex.L[2]) continue;
    const { u, v: vv } = chestUV(p, a, s);
    const b = vv < 0 ? shape.bUp : shape.bDown;
    if ((u / shape.au) ** 2 + (vv / b) ** 2 <= 1) {
      inside[v] = 1;
      side[v] = s === "L" ? 0 : 1;
    }
  }
  // Free = inside and two hops from any vertex outside, so two fixed rings clamp position and slope.
  const outside: number[] = [];
  for (const v of mesh.vertices) if (!inside[v]) outside.push(v);
  const dist = hopDistance(mesh, outside, 3);
  const free: number[] = [];
  for (const v of mesh.vertices) if (inside[v] && (dist[v] as number) >= 3) free.push(v);
  return { inside, free: Uint32Array.from(free), side };
}
