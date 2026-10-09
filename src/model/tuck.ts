/**
 * How far to sink the skin that shows at a garment's edge under the cloth over
 * it (docs/ARCHITECTURE.md, "Clothing", "Skin at a garment's edge").
 *
 * MakeHuman hides only the body faces a garment covers whole and keeps the ring
 * of faces round the edge, so no gap opens between cloth and skin. That ring sits
 * a centimetre or two under the cloth, and a joint moves cloth and skin
 * differently by that much: at the shoulder top, where four bones of very
 * different motion meet, the skin comes through the yoke in a raised-arm pose.
 * Sinking each ring vertex by its own clearance puts it under the cloth in every
 * pose, and moves nothing the cloth does not already cover.
 */

/** A garment's rest geometry: positions, and triangles (`faces` as quads, 4 vertices each). */
export interface TuckCloth {
  positions: Float32Array;
  /** Quads, four vertex indices each. */
  faces: Uint32Array;
}

export interface TuckInput {
  /** Rest positions of the body's vertices, xyz. */
  positions: Float32Array;
  /** Unit normals, same layout. */
  normals: Float32Array;
  /** The vertices to consider: the visible ones near the cloth's edge. */
  candidates: ArrayLike<number>;
  cloth: readonly TuckCloth[];
  /** Cloth further than this (metres) over the skin does not sink it. */
  cap: number;
}

const CELL = 0.03;

/**
 * Per vertex, the distance (metres, at most `cap`) to the nearest cloth along
 * its normal, taking the outermost garment's; zero for a vertex that is not a
 * candidate, has no cloth over it within `cap`, or only cloth behind it.
 */
export function tuckDepths(input: TuckInput): Float32Array {
  const { positions, normals, candidates, cloth, cap } = input;
  const out = new Float32Array(positions.length / 3);
  for (const garment of cloth) {
    const grid = triangleGrid(garment);
    for (let i = 0; i < candidates.length; i++) {
      const v = candidates[i] as number;
      const t = firstHit(grid, garment, v, positions, normals, cap);
      if (t !== null && t > (out[v] as number)) out[v] = t;
    }
  }
  return out;
}

interface Grid {
  cells: Map<string, number[]>;
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** Triangle `t` of a garment's quads: (0,1,2) for even, (0,2,3) for odd. */
function corners(g: TuckCloth, t: number): [number, number, number] {
  const q = (t >> 1) * 4;
  return t & 1
    ? [g.faces[q] as number, g.faces[q + 2] as number, g.faces[q + 3] as number]
    : [g.faces[q] as number, g.faces[q + 1] as number, g.faces[q + 2] as number];
}

function triangleGrid(g: TuckCloth): Grid {
  const cells = new Map<string, number[]>();
  const count = (g.faces.length / 4) * 2;
  for (let t = 0; t < count; t++) {
    const c = corners(g, t);
    const lo = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const hi = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const v of c)
      for (let a = 0; a < 3; a++) {
        const p = g.positions[v * 3 + a] as number;
        lo[a] = Math.min(lo[a] as number, p);
        hi[a] = Math.max(hi[a] as number, p);
      }
    for (
      let x = Math.floor((lo[0] as number) / CELL);
      x <= Math.floor((hi[0] as number) / CELL);
      x++
    )
      for (
        let y = Math.floor((lo[1] as number) / CELL);
        y <= Math.floor((hi[1] as number) / CELL);
        y++
      )
        for (
          let z = Math.floor((lo[2] as number) / CELL);
          z <= Math.floor((hi[2] as number) / CELL);
          z++
        ) {
          const k = key(x, y, z);
          const list = cells.get(k);
          if (list) list.push(t);
          else cells.set(k, [t]);
        }
  }
  return { cells };
}

/** The smallest t in (0, cap] at which the ray from vertex `v` along its normal meets the garment, or null. */
function firstHit(
  grid: Grid,
  g: TuckCloth,
  v: number,
  positions: Float32Array,
  normals: Float32Array,
  cap: number,
): number | null {
  const o = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]] as [
    number,
    number,
    number,
  ];
  const d = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]] as [number, number, number];
  let best: number | null = null;
  const seen = new Set<number>();
  // Walk the ray a cell at a time: a cap of 3 cm is a cell or two.
  const steps = Math.ceil(cap / CELL) + 1;
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(cap, s * CELL);
    const k = key(
      Math.floor((o[0] + d[0] * t) / CELL),
      Math.floor((o[1] + d[1] * t) / CELL),
      Math.floor((o[2] + d[2] * t) / CELL),
    );
    for (const tri of grid.cells.get(k) ?? []) {
      if (seen.has(tri)) continue;
      seen.add(tri);
      const [a, b, c] = corners(g, tri);
      const hit = rayTriangle(o, d, g.positions, a, b, c);
      if (hit !== null && hit > 0 && hit <= cap && (best === null || hit < best)) best = hit;
    }
  }
  return best;
}

/** Möller–Trumbore: the distance along `d` from `o` to triangle abc, or null. */
function rayTriangle(
  o: readonly [number, number, number],
  d: readonly [number, number, number],
  P: Float32Array,
  a: number,
  b: number,
  c: number,
): number | null {
  const ax = P[a * 3] as number;
  const ay = P[a * 3 + 1] as number;
  const az = P[a * 3 + 2] as number;
  const e1x = (P[b * 3] as number) - ax;
  const e1y = (P[b * 3 + 1] as number) - ay;
  const e1z = (P[b * 3 + 2] as number) - az;
  const e2x = (P[c * 3] as number) - ax;
  const e2y = (P[c * 3 + 1] as number) - ay;
  const e2z = (P[c * 3 + 2] as number) - az;
  const px = d[1] * e2z - d[2] * e2y;
  const py = d[2] * e2x - d[0] * e2z;
  const pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  const tx = o[0] - ax;
  const ty = o[1] - ay;
  const tz = o[2] - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const w = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (w < 0 || u + w > 1) return null;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}
