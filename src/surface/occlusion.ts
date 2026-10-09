/**
 * Ambient occlusion for attachments, baked against the figure itself.
 *
 * Eyes sit under the lids and teeth inside the lips and cheeks. Lit as if
 * nothing surrounded them, they glow: eye whites look pasted on and teeth read
 * as a bright strip. For every attachment vertex this casts a fixed set of
 * cosine-weighted rays over its hemisphere against the body and every
 * attachment (so teeth also shade each other) and records the fraction that
 * escape within `distance`. Materials scale their lighting by it.
 *
 * The ray set is deterministic (a Fibonacci spiral), so the same figure always
 * bakes the same values. Colour plays no part: the result is geometry only.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";

export interface OccluderMesh {
  positions: Float32Array;
  /** Triangle indices into `positions`. */
  index: Uint32Array;
}

export interface OcclusionTarget {
  positions: Float32Array;
  normals: Float32Array;
}

export interface OcclusionOptions {
  /** Rays per vertex. Default 48. */
  rays?: number;
  /** How far occluders count, in metres. Default 0.05 (lids, lips, cheeks; not the room). */
  distance?: number;
  /** Ray start offset along the normal, in metres, so a surface does not occlude itself. Default 0.0004. */
  bias?: number;
}

/** Unit directions over +z, cosine-weighted, from a Fibonacci spiral. */
export function hemisphereDirections(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    // Cosine weighting: uniform in the disk, projected up onto the hemisphere.
    const r = Math.sqrt((i + 0.5) / n);
    const phi = i * golden;
    out[i * 3] = r * Math.cos(phi);
    out[i * 3 + 1] = r * Math.sin(phi);
    out[i * 3 + 2] = Math.sqrt(Math.max(0, 1 - r * r));
  }
  return out;
}

function mergedGeometry(meshes: readonly OccluderMesh[]): BufferGeometry {
  const vertexCount = meshes.reduce((n, m) => n + m.positions.length / 3, 0);
  const positions = new Float32Array(vertexCount * 3);
  const index = new Uint32Array(meshes.reduce((n, m) => n + m.index.length, 0));
  let v = 0;
  let i = 0;
  for (const m of meshes) {
    positions.set(m.positions, v * 3);
    for (const k of m.index) index[i++] = k + v;
    v += m.positions.length / 3;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

/**
 * Per-vertex visibility in [0, 1] (1 = fully open) for each target, against
 * all `occluders`.
 */
export function bakeOcclusion(
  occluders: readonly OccluderMesh[],
  targets: readonly OcclusionTarget[],
  options: OcclusionOptions = {},
): Float32Array[] {
  const rays = options.rays ?? 48;
  const distance = options.distance ?? 0.05;
  const bias = options.bias ?? 0.0004;
  const bvh = new MeshBVH(mergedGeometry(occluders), { verbose: false });
  const dirs = hemisphereDirections(rays);
  const ray = new Ray();
  const n = new Vector3();
  const t = new Vector3();
  const b = new Vector3();
  const up = new Vector3();

  return targets.map(({ positions, normals }) => {
    const count = positions.length / 3;
    const out = new Float32Array(count);
    for (let v = 0; v < count; v++) {
      n.fromArray(normals, v * 3);
      if (n.lengthSq() < 1e-12) {
        out[v] = 1;
        continue;
      }
      n.normalize();
      // Any tangent frame will do: the direction set is rotationally even.
      up.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0);
      t.crossVectors(up, n).normalize();
      b.crossVectors(n, t);
      let open = 0;
      for (let k = 0; k < rays; k++) {
        const dx = dirs[k * 3] as number;
        const dy = dirs[k * 3 + 1] as number;
        const dz = dirs[k * 3 + 2] as number;
        ray.origin.fromArray(positions, v * 3).addScaledVector(n, bias);
        ray.direction
          .set(0, 0, 0)
          .addScaledVector(t, dx)
          .addScaledVector(b, dy)
          .addScaledVector(n, dz);
        if (!bvh.raycastFirst(ray, DoubleSide, 0, distance)) open++;
      }
      out[v] = open / rays;
    }
    return out;
  });
}
