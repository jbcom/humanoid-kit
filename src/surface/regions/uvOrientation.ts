/**
 * A direction on the skin as the angle the relief is drawn at. Detail layers draw
 * their relief in the UV plane (p = uv × metres per UV unit), so a pattern that
 * has a direction (the sole's friction ridges, the stretch marks) needs it
 * measured there: per face, the wanted direction at each corner is taken into
 * the face's plane and carried through the face's UV map, then averaged over the
 * faces round a vertex by their area, as a doubled angle so opposite
 * directions agree (an orientation is a direction modulo a half turn). It is
 * stored as an orientation coordinate about a seam (`orientationCoordinate`):
 * the ridges' own by default.
 */
import { groupFaces, type HumanoidAssets } from "../../format/assetFormat.ts";
import { orientationCoordinate, RIDGE_ORIENTATION_SEAM } from "../ridges.ts";

export interface UvOrientation {
  /** The stored orientation, 0..1, where `valid` is 1. */
  coord: Float32Array;
  /** 1 where an orientation was measured: the vertex has weight and a face with a defined UV map. */
  valid: Uint8Array;
}

/**
 * The orientation of `direction` (three floats per base vertex, any length) in
 * the UV plane at each vertex with `weight` above 0; faces none of whose
 * corners has weight are not looked at.
 */
export function uvOrientation(
  assets: HumanoidAssets,
  direction: Float32Array,
  weight: Float32Array,
  seam: number = RIDGE_ORIENTATION_SEAM,
): UvOrientation {
  const n = assets.manifest.vertexCount;
  const P = assets.positions;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  for (const f of groupFaces(assets, "body")) {
    const q = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number);
    if (!q.some((v) => (weight[v] as number) > 0)) continue;
    const at = (v: number): [number, number, number] => [
      P[v * 3] as number,
      P[v * 3 + 1] as number,
      P[v * 3 + 2] as number,
    ];
    const uv = [0, 1, 2, 3].map((k) => [
      assets.uvs[(assets.faceUvs[f * 4 + k] as number) * 2] as number,
      assets.uvs[(assets.faceUvs[f * 4 + k] as number) * 2 + 1] as number,
    ]) as [number, number][];
    const p0 = at(q[0] as number);
    const sub3 = (
      a: [number, number, number],
      b: [number, number, number],
    ): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot3 = (a: [number, number, number], b: [number, number, number]) =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const e1 = sub3(at(q[1] as number), p0);
    const e2 = sub3(at(q[3] as number), p0);
    const b1 = [
      (uv[1] as [number, number])[0] - (uv[0] as [number, number])[0],
      (uv[1] as [number, number])[1] - (uv[0] as [number, number])[1],
    ];
    const b2 = [
      (uv[3] as [number, number])[0] - (uv[0] as [number, number])[0],
      (uv[3] as [number, number])[1] - (uv[0] as [number, number])[1],
    ];
    const g11 = dot3(e1, e1);
    const g12 = dot3(e1, e2);
    const g22 = dot3(e2, e2);
    const det = g11 * g22 - g12 * g12;
    if (det < 1e-18) continue;
    const area = Math.sqrt(det);
    for (const v of q) {
      if ((weight[v] as number) <= 0) continue;
      const w: [number, number, number] = [
        direction[v * 3] as number,
        direction[v * 3 + 1] as number,
        direction[v * 3 + 2] as number,
      ];
      // w = alpha e1 + beta e2 (its part in the face's plane), by least squares.
      const r1 = dot3(w, e1);
      const r2 = dot3(w, e2);
      const alpha = (r1 * g22 - r2 * g12) / det;
      const beta = (r2 * g11 - r1 * g12) / det;
      const du = alpha * (b1[0] as number) + beta * (b2[0] as number);
      const dv = alpha * (b1[1] as number) + beta * (b2[1] as number);
      const len = Math.hypot(du, dv);
      if (len < 1e-12) continue;
      // The doubled angle's unit vector, weighted by the face's area.
      const c2 = (du * du - dv * dv) / (len * len);
      const s2 = (2 * du * dv) / (len * len);
      cx[v] = (cx[v] as number) + area * c2;
      cy[v] = (cy[v] as number) + area * s2;
    }
  }
  const coord = new Float32Array(n);
  const valid = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const len = Math.hypot(cx[v] as number, cy[v] as number);
    if ((weight[v] as number) <= 0 || len < 1e-18) continue;
    valid[v] = 1;
    coord[v] = orientationCoordinate(0.5 * Math.atan2(cy[v] as number, cx[v] as number), seam);
  }
  return { coord, valid };
}
