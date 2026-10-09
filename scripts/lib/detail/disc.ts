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
  radius: number,
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
    for (let c = s; c < e; c++) {
      const p = position(polygons.vertices[c] as number);
      x += p[0];
      y += p[1];
      z += p[2];
    }
    const n = e - s;
    if (Math.hypot(x / n - centre[0], y / n - centre[1], z / n - centre[2]) > radius) continue;
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
