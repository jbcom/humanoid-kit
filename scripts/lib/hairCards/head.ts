/**
 * Where on the scalp an authored style puts its hair: the head of the default figure at rest
 * seen from a point inside the skull, so a place on it is two angles, as a parting is drawn on
 * a head (front to back, side to side) rather than in vertex indices.
 *
 * Azimuth runs from the front (0) toward the figure's left (+x), in radians; elevation from the
 * horizontal plane through the skull's centre, up. A ray from the centre in that direction
 * meets the head's own triangles (the vertices the head bone moves most: not the neck, not the
 * shoulders), and the hit is the scalp point there with its outward normal.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { BodyMesh } from "./bind.ts";

export interface ScalpPoint {
  point: Vector3;
  /** Unit, away from the skull. */
  normal: Vector3;
}

/**
 * The skull's centre from the head's extent: the head is about as deep as it is wide behind the
 * face, so the centre sits a radius below the crown, midway between the back of the skull and the
 * forehead (which is a little behind the nose's tip).
 */
const FOREHEAD_BEHIND_NOSE = 0.04;

export class HeadFrame {
  readonly centre: Vector3;
  /** Metres from the crown to the top of the head's extent and so on, for authors who size to the head. */
  readonly extent: { min: Vector3; max: Vector3 };
  private readonly bvh: MeshBVH;
  private readonly positions: Float32Array;
  private readonly triangles: Uint32Array;

  constructor(rest: BodyMesh & { head: Uint8Array }) {
    const keep: number[] = [];
    for (let t = 0; t < rest.triangles.length; t += 3)
      if ([0, 1, 2].every((k) => rest.head[rest.triangles[t + k] as number] === 1))
        keep.push(
          rest.triangles[t] as number,
          rest.triangles[t + 1] as number,
          rest.triangles[t + 2] as number,
        );
    this.triangles = Uint32Array.from(keep);
    this.positions = rest.positions;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let v = 0; v < rest.head.length; v++)
      if (rest.head[v] === 1) {
        const p = new Vector3(
          rest.positions[v * 3] as number,
          rest.positions[v * 3 + 1] as number,
          rest.positions[v * 3 + 2] as number,
        );
        min.min(p);
        max.max(p);
      }
    this.extent = { min, max };
    const radius = (max.x - min.x) / 2;
    this.centre = new Vector3(
      (max.x + min.x) / 2,
      max.y - radius,
      (min.z + (max.z - FOREHEAD_BEHIND_NOSE)) / 2,
    );
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(rest.positions, 3));
    geometry.setIndex(new BufferAttribute(this.triangles, 1));
    this.bvh = new MeshBVH(geometry, { verbose: false });
  }

  /** The scalp point in a direction from the skull's centre, or null where the head has none (the face's underside, the neck). */
  surface(azimuth: number, elevation: number): ScalpPoint | null {
    const dir = new Vector3(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(azimuth) * Math.cos(elevation),
    );
    const hit = this.bvh.raycastFirst(new Ray(this.centre.clone(), dir), DoubleSide);
    const face = hit?.faceIndex;
    if (!hit || typeof face !== "number") return null;
    const corner = (k: number) => this.triangles[face * 3 + k] as number;
    const at = (v: number) =>
      new Vector3(
        this.positions[v * 3] as number,
        this.positions[v * 3 + 1] as number,
        this.positions[v * 3 + 2] as number,
      );
    const a = at(corner(0));
    const normal = new Vector3()
      .crossVectors(at(corner(1)).sub(a), at(corner(2)).sub(a))
      .normalize();
    if (normal.dot(dir) < 0) normal.negate();
    return { point: hit.point.clone(), normal };
  }
}

/**
 * The whole body as something hair can lie on and hang over: how far a point is outside it,
 * and the direction out. Winding is taken from the skull (a ray from its centre meets the
 * scalp from inside), so it does not matter which way the mesh's triangles wind.
 */
export class BodySurface {
  private readonly bvh: MeshBVH;
  private readonly positions: Float32Array;
  private readonly triangles: Uint32Array;
  private readonly sign: number;

  constructor(body: BodyMesh, head: HeadFrame) {
    this.positions = body.positions;
    this.triangles = body.triangles;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(body.positions, 3));
    geometry.setIndex(new BufferAttribute(body.triangles, 1));
    this.bvh = new MeshBVH(geometry, { verbose: false });
    // Up from the skull's centre meets the crown from inside: a triangle there faces out when its
    // normal agrees with the ray, so the sign that makes it so is the mesh's winding.
    const crown = new Ray(head.centre.clone(), new Vector3(0, 1, 0));
    const hit = this.bvh.raycastFirst(crown, DoubleSide);
    const face = hit?.faceIndex;
    if (typeof face !== "number")
      throw new Error("hairCards: the body has no crown above the head's centre");
    this.sign = this.faceNormal(face).dot(new Vector3(0, 1, 0)) >= 0 ? 1 : -1;
  }

  private faceNormal(face: number): Vector3 {
    const at = (k: number) => {
      const v = this.triangles[face * 3 + k] as number;
      return new Vector3(
        this.positions[v * 3] as number,
        this.positions[v * 3 + 1] as number,
        this.positions[v * 3 + 2] as number,
      );
    };
    const a = at(0);
    return new Vector3().crossVectors(at(1).sub(a), at(2).sub(a)).normalize();
  }

  /** Signed distance of `p` from the body (positive outside), the nearest body point and the outward normal there. */
  probe(p: Vector3): { distance: number; point: Vector3; normal: Vector3 } {
    const target = { point: new Vector3(), distance: 0, faceIndex: 0 };
    const hit = this.bvh.closestPointToPoint(p, target);
    if (!hit) throw new Error("hairCards: the body has no triangles");
    const normal = this.faceNormal(hit.faceIndex).multiplyScalar(this.sign);
    const outside = new Vector3().subVectors(p, hit.point).dot(normal) >= 0;
    return {
      distance: outside ? hit.distance : -hit.distance,
      point: hit.point.clone(),
      normal,
    };
  }
}
