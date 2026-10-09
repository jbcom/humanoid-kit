/**
 * Measurements of how a skinning scheme deforms a body, for choosing and
 * checking one (docs/ARCHITECTURE.md, "Skinning artefacts"). They work on the
 * base mesh's triangles and any posed positions, so they compare schemes
 * without knowing which produced them.
 *
 * - `meshVolume`: the volume a closed, outward-wound mesh encloses. Bending one
 *   limb joint of a figure and comparing it with rest gives that joint's volume
 *   loss, since nothing else moves.
 * - `sliceLoops`: the closed outlines in which a plane cuts the mesh, with the
 *   area each encloses: the cross-section of a limb at a joint (a pinched elbow
 *   or a candy-wrapper wrist is a small one).
 */
import type { HumanoidAssets } from "../../src/format/assetFormat.ts";

type Vec3 = readonly [number, number, number];

/** The enclosed volume of a closed mesh whose triangles wind outward. */
export function meshVolume(positions: Float32Array, tris: Uint32Array): number {
  // Measured from the first vertex: the sum is exact for a closed mesh from any
  // origin, and a near origin keeps the float error small.
  const ox = positions[0] as number;
  const oy = positions[1] as number;
  const oz = positions[2] as number;
  let volume = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = (tris[t] as number) * 3;
    const b = (tris[t + 1] as number) * 3;
    const c = (tris[t + 2] as number) * 3;
    const ax = (positions[a] as number) - ox;
    const ay = (positions[a + 1] as number) - oy;
    const az = (positions[a + 2] as number) - oz;
    const bx = (positions[b] as number) - ox;
    const by = (positions[b + 1] as number) - oy;
    const bz = (positions[b + 2] as number) - oz;
    const cx = (positions[c] as number) - ox;
    const cy = (positions[c + 1] as number) - oy;
    const cz = (positions[c + 2] as number) - oz;
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

export interface Loop {
  /** The area the outline encloses (m²), on the cutting plane. */
  area: number;
  /** The mean of the outline's points. */
  centroid: [number, number, number];
  /** Whether the outline closes (a hole in the mesh leaves it open and its area unreliable). */
  closed: boolean;
}

/**
 * The outlines in which the plane through `origin` with normal `normal` cuts
 * the mesh. Triangles must wind consistently, so the outlines orient alike.
 */
export function sliceLoops(
  positions: Float32Array,
  tris: Uint32Array,
  origin: Vec3,
  normal: Vec3,
): Loop[] {
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  const n: Vec3 = [normal[0] / len, normal[1] / len, normal[2] / len];
  const vertexCount = positions.length / 3;
  const above = new Uint8Array(vertexCount);
  const dist = new Float64Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const d =
      ((positions[v * 3] as number) - origin[0]) * n[0] +
      ((positions[v * 3 + 1] as number) - origin[1]) * n[1] +
      ((positions[v * 3 + 2] as number) - origin[2]) * n[2];
    dist[v] = d;
    above[v] = d >= 0 ? 1 : 0;
  }

  // Each crossed mesh edge is one outline point, shared by the triangles on
  // both sides of it, which is what joins their segments into outlines.
  const pointOf = new Map<number, number>();
  const points: number[] = [];
  const crossing = (a: number, b: number): number => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * vertexCount + hi;
    const known = pointOf.get(key);
    if (known !== undefined) return known;
    const da = dist[lo] as number;
    const db = dist[hi] as number;
    const s = da / (da - db);
    const id = points.length / 3;
    for (let k = 0; k < 3; k++) {
      const p = positions[lo * 3 + k] as number;
      const q = positions[hi * 3 + k] as number;
      points.push(p + (q - p) * s);
    }
    pointOf.set(key, id);
    return id;
  };

  const from: number[] = [];
  const to: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const v = [tris[t] as number, tris[t + 1] as number, tris[t + 2] as number] as const;
    const sides = (above[v[0]] as number) + (above[v[1]] as number) + (above[v[2]] as number);
    if (sides === 0 || sides === 3) continue;
    let enter = -1;
    let exit = -1;
    for (let e = 0; e < 3; e++) {
      const a = v[e] as number;
      const b = v[(e + 1) % 3] as number;
      if (above[a] === above[b]) continue;
      if (above[a] === 0) enter = crossing(a, b);
      else exit = crossing(a, b);
    }
    from.push(enter);
    to.push(exit);
  }

  // Outlines are the connected sets of segments.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as number;
    parent.set(x, r);
    return r;
  };
  const degree = new Map<number, number>();
  for (let s = 0; s < from.length; s++) {
    const a = from[s] as number;
    const b = to[s] as number;
    parent.set(find(a), find(b));
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  const groups = new Map<
    number,
    {
      twice: number;
      count: number;
      sum: [number, number, number];
      open: boolean;
      seen: Set<number>;
    }
  >();
  const group = (id: number) => {
    const root = find(id);
    let g = groups.get(root);
    if (!g) {
      g = { twice: 0, count: 0, sum: [0, 0, 0], open: false, seen: new Set() };
      groups.set(root, g);
    }
    return g;
  };
  for (let s = 0; s < from.length; s++) {
    const a = from[s] as number;
    const b = to[s] as number;
    const g = group(a);
    for (const id of [a, b]) {
      if (g.seen.has(id)) continue;
      g.seen.add(id);
      g.count++;
      for (let k = 0; k < 3; k++) g.sum[k] = (g.sum[k] as number) + (points[id * 3 + k] as number);
      if (degree.get(id) !== 2) g.open = true;
    }
    const ax = (points[a * 3] as number) - origin[0];
    const ay = (points[a * 3 + 1] as number) - origin[1];
    const az = (points[a * 3 + 2] as number) - origin[2];
    const bx = (points[b * 3] as number) - origin[0];
    const by = (points[b * 3 + 1] as number) - origin[1];
    const bz = (points[b * 3 + 2] as number) - origin[2];
    g.twice += (ay * bz - az * by) * n[0] + (az * bx - ax * bz) * n[1] + (ax * by - ay * bx) * n[2];
  }
  return [...groups.values()].map((g) => ({
    area: Math.abs(g.twice) / 2,
    centroid: [g.sum[0] / g.count, g.sum[1] / g.count, g.sum[2] / g.count],
    closed: !g.open,
  }));
}

/** The outline nearest `near` that closes (the limb's cross-section there), or null. */
export function loopNear(loops: readonly Loop[], near: Vec3): Loop | null {
  let best: Loop | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const l of loops) {
    if (!l.closed) continue;
    const d = Math.hypot(l.centroid[0] - near[0], l.centroid[1] - near[1], l.centroid[2] - near[2]);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/** The distance from point (x, y, z) to a polyline of joints. */
function distanceToLine(x: number, y: number, z: number, line: readonly Vec3[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let s = 0; s + 1 < line.length; s++) {
    const a = line[s] as Vec3;
    const b = line[s + 1] as Vec3;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const apx = x - a[0];
    const apy = y - a[1];
    const apz = z - a[2];
    const t = Math.max(
      0,
      Math.min(1, (apx * abx + apy * aby + apz * abz) / (abx * abx + aby * aby + abz * abz)),
    );
    best = Math.min(best, Math.hypot(apx - t * abx, apy - t * aby, apz - t * abz));
  }
  return best;
}

/**
 * How far each of `vertices` sits from the limb's centreline, posed over rest:
 * 1 where the body keeps its girth, below 1 where it is pinched (0 is the
 * candy wrapper's neck), above 1 where it bulges. The centreline is the
 * polyline of the limb's joints, at rest and posed.
 */
export function girthRatios(
  rest: Float32Array,
  posed: Float32Array,
  vertices: ArrayLike<number>,
  restLine: readonly Vec3[],
  posedLine: readonly Vec3[],
): number[] {
  const out: number[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const v = (vertices[i] as number) * 3;
    const before = distanceToLine(
      rest[v] as number,
      rest[v + 1] as number,
      rest[v + 2] as number,
      restLine,
    );
    const after = distanceToLine(
      posed[v] as number,
      posed[v + 1] as number,
      posed[v + 2] as number,
      posedLine,
    );
    out.push(after / before);
  }
  return out;
}

/** The visible body's faces (its `body` group), as triangles. */
export function bodyTriangles(assets: HumanoidAssets): Uint32Array {
  const group = assets.manifest.groups.find((g) => g.name === "body");
  if (!group) throw new Error("the pack has no body group");
  const tris = new Uint32Array(group.faceCount * 6);
  for (let f = 0; f < group.faceCount; f++) {
    const q = (group.faceStart + f) * 4;
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => assets.faceVerts[q + k] as number) as [
      number,
      number,
      number,
      number,
    ];
    tris.set([a, b, c, a, c, d], f * 6);
  }
  return tris;
}
