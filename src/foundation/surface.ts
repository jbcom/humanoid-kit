/**
 * Queries on a posed body's skin as drawn (docs/FOUNDATION.md, "What the
 * foundation gives layers"): the closest point, the signed distance to it and
 * the body's local frame there, so a garment drapes and a held object
 * collides against the body as it is in the pose, not as it was at rest.
 *
 * The skin's triangles are put in a bounding-volume hierarchy once per posed
 * body. The sign of a distance is the side of the skin the point is on by the
 * skin's normal at the closest point (the skinned vertex normals, blended
 * across the triangle), which holds off the skin's smooth parts and within a
 * fold's depth of a crease. The invariant suite's penetration measure builds
 * its hierarchy here too, so there is one.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { LandmarkFrame, Vec3 } from "./landmarks.ts";
import type { PosedBody } from "./posed.ts";

/** A point of the skin: where, how far from what was asked, and on which triangle. */
export interface SurfacePoint {
  point: Vec3;
  /** The skin's outward normal there. */
  normal: Vec3;
  /** Distance from the point asked about, metres. */
  distance: number;
  /** The triangle's render vertices and the point's weight on each. */
  vertices: readonly [number, number, number];
  weights: readonly [number, number, number];
}

const UP: Vec3 = [0, 1, 0];
const FORWARD: Vec3 = [0, 0, 1];

export class BodySurface {
  readonly body: PosedBody;
  readonly bvh: MeshBVH;
  /** The triangles in the hierarchy's order: triangle `t` is these three render vertices. */
  readonly triangles: Uint32Array;
  private readonly geometry: BufferGeometry;
  private readonly target = { point: new Vector3(), distance: 0, faceIndex: 0 };
  private readonly query = new Vector3();

  constructor(body: PosedBody) {
    this.body = body;
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(body.positions, 3));
    this.geometry.setIndex(new BufferAttribute(Uint32Array.from(body.index), 1));
    this.bvh = new MeshBVH(this.geometry, { verbose: false });
    // The hierarchy orders the index anew.
    this.triangles = this.geometry.getIndex()?.array as Uint32Array;
  }

  /** The closest point of the skin to `p`, or null when none is within `within` metres. */
  closest(p: Vec3, within = Number.POSITIVE_INFINITY): SurfacePoint | null {
    this.query.set(p[0], p[1], p[2]);
    const hit = this.bvh.closestPointToPoint(this.query, this.target, 0, within);
    if (!hit) return null;
    const t = hit.faceIndex;
    const vertices = [0, 1, 2].map((k) => this.triangles[t * 3 + k] as number) as [
      number,
      number,
      number,
    ];
    const P = this.body.positions;
    const corner = (v: number): Vec3 => [
      P[v * 3] as number,
      P[v * 3 + 1] as number,
      P[v * 3 + 2] as number,
    ];
    const q: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
    const weights = barycentric(q, corner(vertices[0]), corner(vertices[1]), corner(vertices[2]));
    const N = this.body.normals;
    const n = [0, 1, 2].map((k) =>
      vertices.reduce((s, v, c) => s + (weights[c] as number) * (N[v * 3 + k] as number), 0),
    );
    const l = Math.hypot(n[0] as number, n[1] as number, n[2] as number);
    return {
      point: q,
      normal: [(n[0] as number) / l, (n[1] as number) / l, (n[2] as number) / l],
      distance: hit.distance,
      vertices,
      weights,
    };
  }

  /** How far `p` is from the skin: positive outside, negative inside. */
  signedDistance(p: Vec3): number {
    const hit = this.closest(p);
    if (!hit) return Number.POSITIVE_INFINITY;
    const side =
      (p[0] - hit.point[0]) * hit.normal[0] +
      (p[1] - hit.point[1]) * hit.normal[1] +
      (p[2] - hit.point[2]) * hit.normal[2];
    return side < 0 ? -hit.distance : hit.distance;
  }

  /**
   * The body's frame at the skin's closest point to `p`: the skin's normal, a
   * tangent up the skin (forward where the skin faces up, at the crown or a
   * shoulder's top), and their cross. Null when no skin is within `within`.
   */
  frame(p: Vec3, within = Number.POSITIVE_INFINITY): LandmarkFrame | null {
    const hit = this.closest(p, within);
    if (!hit) return null;
    const n = hit.normal;
    const want = Math.abs(n[1]) > 0.9 ? FORWARD : UP;
    const d = want[0] * n[0] + want[1] * n[1] + want[2] * n[2];
    const t0 = [want[0] - n[0] * d, want[1] - n[1] * d, want[2] - n[2] * d];
    const tl = Math.hypot(t0[0] as number, t0[1] as number, t0[2] as number);
    const t: Vec3 = [(t0[0] as number) / tl, (t0[1] as number) / tl, (t0[2] as number) / tl];
    return {
      position: hit.point,
      normal: n,
      tangent: t,
      bitangent: [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]],
    };
  }

  /** Frees the hierarchy's geometry. */
  dispose(): void {
    this.geometry.dispose();
  }
}

/** The weights of `p` (on the triangle's plane) on the triangle's corners. */
function barycentric(p: Vec3, a: Vec3, b: Vec3, c: Vec3): [number, number, number] {
  const v0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const v2 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (x: number[], y: number[]) =>
    (x[0] as number) * (y[0] as number) +
    (x[1] as number) * (y[1] as number) +
    (x[2] as number) * (y[2] as number);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const den = d00 * d11 - d01 * d01;
  if (den === 0) return [1, 0, 0];
  const v = (d11 * d20 - d01 * d21) / den;
  const w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}
