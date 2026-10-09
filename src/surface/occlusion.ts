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
  /**
   * A previous bake of the same meshes in another pose. A target vertex that
   * has not moved, with no moved occluder triangle (where it was or where it
   * is) within reach of its rays, would cast exactly the same rays with the
   * same hits, so it takes its baseline value and casts none.
   */
  baseline?: OcclusionBaseline;
}

export interface OcclusionBaseline {
  occluders: readonly OccluderMesh[];
  targets: readonly OcclusionTarget[];
  values: readonly Float32Array[];
}

/** A triangle's bounding sphere: centre (xyz) and radius. */
type Sphere = [number, number, number, number];

function triangleSphere(p: Float32Array, a: number, b: number, c: number): Sphere {
  const cx = ((p[a * 3] as number) + (p[b * 3] as number) + (p[c * 3] as number)) / 3;
  const cy = ((p[a * 3 + 1] as number) + (p[b * 3 + 1] as number) + (p[c * 3 + 1] as number)) / 3;
  const cz = ((p[a * 3 + 2] as number) + (p[b * 3 + 2] as number) + (p[c * 3 + 2] as number)) / 3;
  let r = 0;
  for (const v of [a, b, c])
    r = Math.max(
      r,
      Math.hypot(
        (p[v * 3] as number) - cx,
        (p[v * 3 + 1] as number) - cy,
        (p[v * 3 + 2] as number) - cz,
      ),
    );
  return [cx, cy, cz, r];
}

/** Which target vertices may differ from the baseline: moved themselves, or near moved occluders. */
function changedTargets(
  occluders: readonly OccluderMesh[],
  targets: readonly OcclusionTarget[],
  baseline: OcclusionBaseline,
  reach: number,
): Uint8Array[] {
  if (
    baseline.occluders.length !== occluders.length ||
    baseline.targets.length !== targets.length ||
    occluders.some(
      (o, i) =>
        o.positions.length !== baseline.occluders[i]?.positions.length ||
        o.index.length !== baseline.occluders[i]?.index.length,
    ) ||
    targets.some((t, i) => t.positions.length !== baseline.targets[i]?.positions.length)
  )
    throw new Error("occlusion baseline: the meshes differ from the ones being baked");
  const spheres: Sphere[] = [];
  occluders.forEach((o, i) => {
    const before = (baseline.occluders[i] as OccluderMesh).positions;
    const moved = new Uint8Array(o.positions.length / 3);
    for (let v = 0; v < moved.length; v++)
      for (let k = 0; k < 3; k++) if (o.positions[v * 3 + k] !== before[v * 3 + k]) moved[v] = 1;
    for (let t = 0; t < o.index.length; t += 3) {
      const [a, b, c] = [o.index[t] as number, o.index[t + 1] as number, o.index[t + 2] as number];
      if (!moved[a] && !moved[b] && !moved[c]) continue;
      spheres.push(triangleSphere(o.positions, a, b, c), triangleSphere(before, a, b, c));
    }
  });
  return targets.map((t, i) => {
    const before = baseline.targets[i] as OcclusionTarget;
    const count = t.positions.length / 3;
    const changed = new Uint8Array(count);
    for (let v = 0; v < count; v++) {
      for (let k = 0; k < 3; k++)
        if (
          t.positions[v * 3 + k] !== before.positions[v * 3 + k] ||
          t.normals[v * 3 + k] !== before.normals[v * 3 + k]
        )
          changed[v] = 1;
      if (changed[v]) continue;
      const [x, y, z] = [
        t.positions[v * 3] as number,
        t.positions[v * 3 + 1] as number,
        t.positions[v * 3 + 2] as number,
      ];
      for (const s of spheres)
        if (Math.hypot(x - s[0], y - s[1], z - s[2]) - s[3] <= reach) {
          changed[v] = 1;
          break;
        }
    }
    return changed;
  });
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
  // Rays start `bias` off the surface and reach `distance`; a slack covers rounding.
  const changed =
    options.baseline &&
    changedTargets(occluders, targets, options.baseline, distance + bias + 1e-6);
  const bvh = new MeshBVH(mergedGeometry(occluders), { verbose: false });
  const dirs = hemisphereDirections(rays);
  const ray = new Ray();
  const n = new Vector3();
  const t = new Vector3();
  const b = new Vector3();
  const up = new Vector3();

  return targets.map(({ positions, normals }, i) => {
    const count = positions.length / 3;
    const out = new Float32Array(count);
    const mayDiffer = changed?.[i];
    const previous = options.baseline?.values[i];
    for (let v = 0; v < count; v++) {
      if (mayDiffer && previous && !mayDiffer[v]) {
        out[v] = previous[v] as number;
        continue;
      }
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
