/** Vertex normals of the control mesh, for the model's shading, bindings and body-art frames. */

/** Area-weighted vertex normals of a quad mesh (each quad split along one diagonal). */
export function quadVertexNormals(positions: Float32Array, faceVerts: Uint32Array): Float32Array {
  const out = new Float32Array(positions.length);
  const p = (i: number, k: number) => positions[i * 3 + k] as number;
  for (let f = 0; f < faceVerts.length; f += 4) {
    const q = [0, 1, 2, 3].map((k) => faceVerts[f + k] as number) as [
      number,
      number,
      number,
      number,
    ];
    // Cross product of the diagonals: twice the quad's vector area.
    const d1 = [0, 1, 2].map((k) => p(q[2], k) - p(q[0], k));
    const d2 = [0, 1, 2].map((k) => p(q[3], k) - p(q[1], k));
    const nx = (d1[1] as number) * (d2[2] as number) - (d1[2] as number) * (d2[1] as number);
    const ny = (d1[2] as number) * (d2[0] as number) - (d1[0] as number) * (d2[2] as number);
    const nz = (d1[0] as number) * (d2[1] as number) - (d1[1] as number) * (d2[0] as number);
    for (const v of q) {
      out[v * 3] = (out[v * 3] as number) + nx;
      out[v * 3 + 1] = (out[v * 3 + 1] as number) + ny;
      out[v * 3 + 2] = (out[v * 3 + 2] as number) + nz;
    }
  }
  return out;
}

/** Each normal scaled to unit length (a zero normal stays zero). */
export function unitNormals(normals: Float32Array): Float32Array {
  const out = new Float32Array(normals.length);
  for (let v = 0; v < normals.length; v += 3) {
    const l = Math.hypot(normals[v] as number, normals[v + 1] as number, normals[v + 2] as number);
    if (l > 0) {
      out[v] = (normals[v] as number) / l;
      out[v + 1] = (normals[v + 1] as number) / l;
      out[v + 2] = (normals[v + 2] as number) / l;
    }
  }
  return out;
}
