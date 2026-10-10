/**
 * Places a reservoir's loop and cap on the adult surface's lattice
 * (`src/build/reservoir.ts`): the cap is the polygons whose centres lie within a
 * radius of a point, the loop is the boundary of that disc, in the direction the
 * cap's own polygons run, starting at its lowest vertex id so the result does not
 * depend on traversal order.
 */
import type { LatticePolygons } from "../../../src/build/surfaceMesh.ts";

export type Vec3 = readonly [number, number, number];

export interface Disc {
  /** Polygon ids (of the refinement mesh) of the cap. */
  cap: number[];
  /** Vertex ids (of the refinement mesh) round the cap, in order. */
  loop: number[];
}

/**
 * The disc of polygons within `radius` of `centre`. Throws when what it finds
 * is not a single disc (a hole, or two pieces), so a bad choice of centre or
 * radius is an error and not a quietly odd shape.
 */
export function findDisc(
  polygons: LatticePolygons,
  position: (vertex: number) => Vec3,
  centre: Vec3,
  /** A radius, or the three semi-axes (x, y, z) of an ellipsoid. */
  radius: number | Vec3,
): Disc {
  const axes: Vec3 = typeof radius === "number" ? [radius, radius, radius] : radius;
  return discOf(polygons, position, (c) =>
    Math.hypot(
      (c[0] - centre[0]) / axes[0],
      (c[1] - centre[1]) / axes[1],
      (c[2] - centre[2]) / axes[2],
    ) <= 1,
  );
}

/** Where a sculpted part meets the skin: its cut, and the way it leaves the body. */
export interface Footprint {
  /** The cut's points, in order round it. */
  outline: readonly Vec3[];
  /** Unit vector from the body out along the part. */
  axis: Vec3;
  /** The outline is shrunk toward its centre by this factor (1 keeps it). */
  inset: number;
  /** How far behind the outline's centre, along the axis, the skin may be, metres. */
  depth: number;
  /** Vertices claimed already (another reservoir's disc and a margin round it): no polygon of the disc may use one. */
  avoid?: ReadonlySet<number>;
}

/** The vertices of a disc's polygons and `margin` rings of polygons round it. */
export function discVertices(polygons: LatticePolygons, disc: Disc, margin: number): Set<number> {
  const capIds = new Set(disc.cap);
  const out = new Set<number>();
  for (let i = 0; i + 1 < polygons.start.length; i++)
    if (capIds.has(polygons.id[i] as number))
      for (let c = polygons.start[i] as number; c < (polygons.start[i + 1] as number); c++)
        out.add(polygons.vertices[c] as number);
  for (let r = 0; r < margin; r++) {
    const grown = new Set(out);
    for (let i = 0; i + 1 < polygons.start.length; i++) {
      const s = polygons.start[i] as number;
      const e = polygons.start[i + 1] as number;
      let touches = false;
      for (let c = s; c < e && !touches; c++) touches = out.has(polygons.vertices[c] as number);
      if (touches) for (let c = s; c < e; c++) grown.add(polygons.vertices[c] as number);
    }
    for (const v of grown) out.add(v);
  }
  return out;
}

/**
 * The disc of polygons a part covers: those facing out along the part whose centre,
 * seen along its axis, lies inside its cut and at most `depth` behind it.
 */
export function findFootprint(
  polygons: LatticePolygons,
  position: (vertex: number) => Vec3,
  footprint: Footprint,
): Disc {
  const { outline, axis, inset, depth, avoid } = footprint;
  const m = outline.length;
  const centre: Vec3 = [
    outline.reduce((s, p) => s + p[0] / m, 0),
    outline.reduce((s, p) => s + p[1] / m, 0),
    outline.reduce((s, p) => s + p[2] / m, 0),
  ];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // A frame of the plane across the axis.
  const seed: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = dot(seed, axis);
  const e1raw: Vec3 = [seed[0] - axis[0] * d, seed[1] - axis[1] * d, seed[2] - axis[2] * d];
  const l1 = Math.hypot(...e1raw);
  const e1: Vec3 = [e1raw[0] / l1, e1raw[1] / l1, e1raw[2] / l1];
  const e2: Vec3 = [
    axis[1] * e1[2] - axis[2] * e1[1],
    axis[2] * e1[0] - axis[0] * e1[2],
    axis[0] * e1[1] - axis[1] * e1[0],
  ];
  const flat = (p: Vec3): [number, number] => {
    const o: Vec3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    return [dot(o, e1), dot(o, e2)];
  };
  const shape = outline.map((p) => flat(p).map((x) => x * inset) as [number, number]);
  const inside = ([x, y]: [number, number]) => {
    let odd = false;
    for (let i = 0, j = m - 1; i < m; j = i++) {
      const [xi, yi] = shape[i] as [number, number];
      const [xj, yj] = shape[j] as [number, number];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
    return odd;
  };
  return discOf(polygons, position, (c, normal, vertices) => {
    if (avoid && vertices.some((v) => avoid.has(v))) return false;
    const behind = -dot([c[0] - centre[0], c[1] - centre[1], c[2] - centre[2]], axis);
    return behind >= -depth && behind <= depth && dot(normal, axis) > 0 && inside(flat(c));
  });
}

/** The disc of the polygons `keep` accepts by their centre, unit normal and vertices; throws unless one disc. */
function discOf(
  polygons: LatticePolygons,
  position: (vertex: number) => Vec3,
  keep: (centre: Vec3, normal: Vec3, vertices: number[]) => boolean,
): Disc {
  const cap: number[] = [];
  const edges = new Map<string, { from: number; to: number; count: number }>();
  const vertexSet = new Set<number>();
  let faces = 0;
  for (let i = 0; i + 1 < polygons.start.length; i++) {
    const s = polygons.start[i] as number;
    const e = polygons.start[i + 1] as number;
    let x = 0;
    let y = 0;
    let z = 0;
    // Newell's normal.
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let c = s; c < e; c++) {
      const p = position(polygons.vertices[c] as number);
      const q = position(polygons.vertices[c + 1 < e ? c + 1 : s] as number);
      x += p[0];
      y += p[1];
      z += p[2];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const n = e - s;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const corners = Array.from(polygons.vertices.subarray(s, e));
    if (!keep([x / n, y / n, z / n], [nx / nl, ny / nl, nz / nl], corners)) continue;
    cap.push(polygons.id[i] as number);
    faces++;
    for (let c = s; c < e; c++) {
      const a = polygons.vertices[c] as number;
      const b = polygons.vertices[c + 1 < e ? c + 1 : s] as number;
      vertexSet.add(a);
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const seen = edges.get(key);
      if (seen) seen.count++;
      else edges.set(key, { from: a, to: b, count: 1 });
    }
  }
  if (!faces) throw new Error("disc: no polygon within the radius");
  // A disc has Euler characteristic 1: it has no hole and is one piece.
  const chi = vertexSet.size - edges.size + faces;
  if (chi !== 1)
    throw new Error(`disc: the polygons are not one disc (Euler characteristic ${chi})`);
  const next = new Map<number, number>();
  for (const e of edges.values()) {
    if (e.count !== 1) continue;
    if (next.has(e.from)) throw new Error(`disc: its boundary pinches at vertex ${e.from}`);
    next.set(e.from, e.to);
  }
  const start = Math.min(...next.keys());
  const loop: number[] = [];
  let at = start;
  do {
    loop.push(at);
    const to = next.get(at);
    if (to === undefined) throw new Error("disc: its boundary is not closed");
    at = to;
  } while (at !== start && loop.length <= next.size);
  if (loop.length !== next.size) throw new Error("disc: its boundary is not one loop");
  return { cap, loop };
}
