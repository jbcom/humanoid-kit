/**
 * Per-vertex mean curvature magnitude of a triangle mesh, from its normals.
 *
 * Along an edge (i, j), the normal turns by (nᵢ − nⱼ)·(pᵢ − pⱼ) / |pᵢ − pⱼ|²
 * per unit length: the normal curvature in that direction. Averaging it over a
 * vertex's edges approximates the mean curvature. Subsurface scattering cares
 * how tightly the surface bends, not which way, so the magnitude is returned,
 * in inverse units of the positions (m⁻¹ for figures).
 */

/** Unique undirected edges of a triangle index, as pairs. Build once per topology. */
export function triangleEdges(index: Uint32Array): Uint32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  let max = 0;
  for (const v of index) max = Math.max(max, v);
  const n = max + 1;
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[t + k] as number;
      const b = index[t + ((k + 1) % 3)] as number;
      const key = a < b ? a * n + b : b * n + a;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a, b);
    }
  }
  return Uint32Array.from(out);
}

export function meanCurvature(
  positions: Float32Array,
  normals: Float32Array,
  edges: Uint32Array,
  out: Float32Array,
  /** Largest curvature reported (1000 m⁻¹ = a 1 mm radius), so creases stay finite. */
  max = 1000,
): Float32Array {
  const count = new Uint16Array(out.length);
  out.fill(0);
  for (let e = 0; e < edges.length; e += 2) {
    const i = edges[e] as number;
    const j = edges[e + 1] as number;
    let dot = 0;
    let len2 = 0;
    for (let k = 0; k < 3; k++) {
      const dp = (positions[i * 3 + k] as number) - (positions[j * 3 + k] as number);
      dot += ((normals[i * 3 + k] as number) - (normals[j * 3 + k] as number)) * dp;
      len2 += dp * dp;
    }
    if (len2 < 1e-14) continue;
    const kappa = dot / len2;
    out[i] = (out[i] as number) + kappa;
    out[j] = (out[j] as number) + kappa;
    count[i] = (count[i] as number) + 1;
    count[j] = (count[j] as number) + 1;
  }
  for (let v = 0; v < out.length; v++) {
    const c = count[v] as number;
    out[v] = c ? Math.min(max, Math.abs((out[v] as number) / c)) : 0;
  }
  return out;
}
