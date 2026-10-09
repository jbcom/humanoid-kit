/**
 * Binds authored geometry to the base mesh the way an MHCLO file binds a MakeHuman
 * garment: each vertex is a weighted sum of three base vertices (the corners of the
 * nearest triangle) plus an offset, so `evaluateBinding` (`src/mhclo/bound.ts`) puts it
 * back on the body at rest and carries it with the body in every other shape.
 *
 * It lets a procedurally generated style (`scripts/lib/hairCards`) travel through the
 * same pack, worker and renderer as a MakeHuman one: nothing downstream can tell the two
 * apart, so their hair is skinned, occluded, faded and tinted by one set of code.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";

export interface BodyMesh {
  /** Control positions, metres, `x y z` per vertex. */
  positions: Float32Array;
  /** Triangle corners, three per face. */
  triangles: Uint32Array;
}

export interface Binding {
  /** Three base vertices per bound vertex. */
  refVerts: Uint32Array;
  /** Their weights, summing to 1. */
  weights: Float32Array;
  /** What the weighted corners miss of the vertex, metres (no axis scaling: bind with `scale: null`). */
  offsets: Float32Array;
}

/** The face a vertex binds to is its nearest by distance to the triangle itself. */
export function bindToBody(points: Float32Array, body: BodyMesh): Binding {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(body.positions, 3));
  geometry.setIndex(new BufferAttribute(body.triangles, 1));
  const bvh = new MeshBVH(geometry, { verbose: false });
  const count = points.length / 3;
  const refVerts = new Uint32Array(count * 3);
  const weights = new Float32Array(count * 3);
  const offsets = new Float32Array(count * 3);
  const p = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const target = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const corner = (face: number, k: number) => body.triangles[face * 3 + k] as number;
  const place = (into: Vector3, vertex: number) =>
    into.set(
      body.positions[vertex * 3] as number,
      body.positions[vertex * 3 + 1] as number,
      body.positions[vertex * 3 + 2] as number,
    );
  for (let v = 0; v < count; v++) {
    p.set(points[v * 3] as number, points[v * 3 + 1] as number, points[v * 3 + 2] as number);
    const hit = bvh.closestPointToPoint(p, target);
    if (!hit) throw new Error("hairCards: the body has no triangles to bind to");
    const face = hit.faceIndex;
    place(a, corner(face, 0));
    place(b, corner(face, 1));
    place(c, corner(face, 2));
    const w = barycentric(hit.point, a, b, c);
    for (let k = 0; k < 3; k++) {
      refVerts[v * 3 + k] = corner(face, k);
      weights[v * 3 + k] = w[k] as number;
    }
    // The offset is measured from the weighted corners, in float32 as `evaluateBinding` will
    // sum them, so the vertex comes back exactly (to rounding) and not to the surface point.
    const x = (w[0] as number) * a.x + (w[1] as number) * b.x + (w[2] as number) * c.x;
    const y = (w[0] as number) * a.y + (w[1] as number) * b.y + (w[2] as number) * c.y;
    const z = (w[0] as number) * a.z + (w[1] as number) * b.z + (w[2] as number) * c.z;
    offsets[v * 3] = p.x - x;
    offsets[v * 3 + 1] = p.y - y;
    offsets[v * 3 + 2] = p.z - z;
  }
  return { refVerts, weights, offsets };
}

/** Barycentric coordinates of `p` (on the triangle's plane) in `a`, `b`, `c`; they sum to 1. */
function barycentric(p: Vector3, a: Vector3, b: Vector3, c: Vector3): [number, number, number] {
  const v0 = new Vector3().subVectors(b, a);
  const v1 = new Vector3().subVectors(c, a);
  const v2 = new Vector3().subVectors(p, a);
  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-30) return [1, 0, 0];
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  return [1 - v - w, v, w];
}
