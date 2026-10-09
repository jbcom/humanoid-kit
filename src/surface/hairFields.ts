/**
 * Per-style data the packer measures from a hair style's cards against the body
 * at rest, for the three things alpha cards cannot do alone:
 *
 * - **growth**: how far along its card each vertex is from where the hair roots,
 *   in 0.1 mm steps. Its screen-space gradient is the strand's direction, which
 *   the Kajiya-Kay highlight needs (`src/render/hairMaterial.ts`) and which the
 *   cards' own geometry has no other way to say.
 * - **fade**: 0 on a card edge that meets the scalp (a hairline), rising to 1
 *   over `FADE_LENGTH` along the card. The renderer dithers the card away where
 *   it is low, so a hairline thins into the scalp instead of ending on a cut edge.
 * - **fin**: 1 on a card that stands out of the scalp instead of lying along it, 0
 *   on a card that does. Seen edge-on a fin is a hairline-thin dark sliver, so
 *   the renderer dithers it away as it turns from the eye; a card of a style's
 *   shell is seen at a grazing angle across a whole head and must not be.
 * - **scalp**: the body vertices the style grows from and how densely: 1 where a
 *   card sits on the scalp, falling to 0 over `SCALP_FALLOFF` beyond it. The skin
 *   is darkened and tinted by the hair's colour there (stubble), so the thinned
 *   hairline shows scalp rather than bare skin.
 *
 * All three depend only on the packs, so they are measured once, here.
 */
import { BufferAttribute, BufferGeometry, Line3, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";

/** Growth is stored as unsigned 16-bit steps of 1 / `GROWTH_SCALE` metre (6.5 m of hair at most). */
export const GROWTH_SCALE = 10_000;

/** A card vertex this near the scalp (metres) is a root. */
export const ROOT_NEAR = 0.015;

/** A card's boundary vertex this near the scalp (metres) is on a hairline... */
export const HAIRLINE_NEAR = 0.015;

/**
 * ...unless another card passes this near it (metres), with its own edge no nearer
 * than `COVER_MARGIN` to the spot: then the edge is inside the hair.
 */
export const COVERED_BY = 0.006;

/** How far inside the covering card's own edge (metres) a spot must be for the card to cover it. */
export const COVER_MARGIN = 0.004;

/** Metres along the card, from a hairline, over which hair thins in. */
export const FADE_LENGTH = 0.012;

/** A scalp vertex this near a card (metres) carries hair at full density. */
export const SCALP_FULL = 0.003;

/** Metres beyond `SCALP_FULL` over which the density falls to zero. */
export const SCALP_FALLOFF = 0.008;

/** A card vertex nearer the scalp than this (metres) is too close to tell which way it faces. */
const FIN_MIN_DISTANCE = 0.001;

/**
 * A card whose normal is within this cosine of the direction away from the scalp
 * lies along it (|cos| above `TO`: not a fin); one across it is a fin (below `FROM`).
 */
const FIN_ALIGNED_FROM = 0.35;
const FIN_ALIGNED_TO = 0.75;

/** Metres above the scalp over which hair brightens from the shade at its roots to open light. */
export const SCALP_DEPTH = 0.025;

/**
 * How open to light each point is by its height above the scalp alone: 0 at the
 * skin, rising smoothly to 1 at `SCALP_DEPTH`. Hair is darkest at its roots and
 * brightens along its length; unlike the ray bake, which treats cards as solid
 * and darkens whichever cards happen to overlap, this has no patches.
 */
export function scalpShade(
  positions: Float32Array,
  body: { positions: Float32Array; triangles: Uint32Array },
): Float32Array {
  const bvh = new MeshBVH(geometry(body.positions, body.triangles), { verbose: false });
  const target = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const p = new Vector3();
  const out = new Float32Array(positions.length / 3);
  for (let v = 0; v < out.length; v++) {
    p.set(
      positions[v * 3] as number,
      positions[v * 3 + 1] as number,
      positions[v * 3 + 2] as number,
    );
    const d = bvh.closestPointToPoint(p, target)?.distance ?? Number.POSITIVE_INFINITY;
    out[v] = smoothstep(0, SCALP_DEPTH, d);
  }
  return out;
}

export interface HairFieldsInput {
  /** The style's control vertices at rest (metres), three per vertex. */
  positions: Float32Array;
  /** The style's quads, four control vertices each. */
  faceVerts: Uint32Array;
  /** The body at rest: control positions and triangles. */
  body: { positions: Float32Array; triangles: Uint32Array };
  /** One per body control vertex: 1 where the skin may be tinted as scalp (the head), else 0. */
  scalpEligible: Uint8Array;
  /**
   * Whether a hairline thins out (default true). Dense curls have no cut edge to
   * soften: faded, their roots show the dark inside of the volume as a band.
   */
  feather?: boolean;
}

export interface HairFields {
  /** Per card vertex, distance along the card from its root in 1 / `GROWTH_SCALE` metre. */
  growth: Uint16Array;
  /** Per card vertex, 0 (cut away) to 255 (all there). */
  fade: Uint8Array;
  /** Per card vertex, 0 (lies along the scalp) to 255 (stands out of it). */
  fin: Uint8Array;
  /** Body control vertices the style grows from... */
  scalpVerts: Uint16Array;
  /** ...and each one's hair density, 1 to 255 (never 0: a vertex without hair is not listed). */
  scalpWeights: Uint8Array;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function geometry(positions: Float32Array, index: Uint32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

/** A binary min-heap of [priority, vertex] pairs. */
class Heap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    let i = this.keys.length;
    this.keys.push(key);
    this.vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.keys[p] as number) <= key) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.keys[0] as number, this.vals[0] as number];
    const lastKey = this.keys.pop() as number;
    const lastVal = this.vals.pop() as number;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.vals[0] = lastVal;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && (this.keys[l] as number) < (this.keys[m] as number)) m = l;
        if (r < this.keys.length && (this.keys[r] as number) < (this.keys[m] as number)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.keys[a], this.keys[b]] = [this.keys[b] as number, this.keys[a] as number];
    [this.vals[a], this.vals[b]] = [this.vals[b] as number, this.vals[a] as number];
  }
}

/** Shortest distance along the card's edges from the nearest of `sources` (Infinity where unreachable). */
function distanceAlong(
  adjacency: readonly (readonly [number, number][])[],
  sources: Iterable<number>,
): Float64Array {
  const dist = new Float64Array(adjacency.length).fill(Number.POSITIVE_INFINITY);
  const heap = new Heap();
  for (const s of sources) {
    dist[s] = 0;
    heap.push(0, s);
  }
  while (heap.size > 0) {
    const [d, v] = heap.pop();
    if (d > (dist[v] as number)) continue;
    for (const [w, len] of adjacency[v] as readonly [number, number][]) {
      const nd = d + len;
      if (nd < (dist[w] as number)) {
        dist[w] = nd;
        heap.push(nd, w);
      }
    }
  }
  return dist;
}

/** The connected piece (card) each vertex belongs to, as the lowest vertex index in it. */
function connectedPieces(adjacency: readonly (readonly [number, number][])[]): Int32Array {
  const piece = new Int32Array(adjacency.length).fill(-1);
  for (let s = 0; s < adjacency.length; s++) {
    if (piece[s] !== -1) continue;
    piece[s] = s;
    const stack = [s];
    while (stack.length > 0) {
      const v = stack.pop() as number;
      for (const [w] of adjacency[v] as readonly [number, number][])
        if (piece[w] === -1) {
          piece[w] = s;
          stack.push(w);
        }
    }
  }
  return piece;
}

export function hairFields(input: HairFieldsInput): HairFields {
  const { positions, faceVerts, body } = input;
  const n = positions.length / 3;
  const faces = faceVerts.length / 4;

  // The card's edges, their lengths, and which are boundary (used by one face).
  const adjacency: [number, number][][] = Array.from({ length: n }, () => []);
  const uses = new Map<number, number>();
  const at = (v: number) =>
    new Vector3(
      positions[v * 3] as number,
      positions[v * 3 + 1] as number,
      positions[v * 3 + 2] as number,
    );
  for (let f = 0; f < faces; f++)
    for (let k = 0; k < 4; k++) {
      const a = faceVerts[f * 4 + k] as number;
      const b = faceVerts[f * 4 + ((k + 1) % 4)] as number;
      const key = Math.min(a, b) * n + Math.max(a, b);
      const seen = uses.get(key) ?? 0;
      uses.set(key, seen + 1);
      if (seen === 0) {
        const len = at(a).distanceTo(at(b));
        (adjacency[a] as [number, number][]).push([b, len]);
        (adjacency[b] as [number, number][]).push([a, len]);
      }
    }
  const boundary = new Set<number>();
  for (const [key, count] of uses)
    if (count === 1) {
      boundary.add(Math.floor(key / n));
      boundary.add(key % n);
    }

  // How close each card vertex is to the body.
  const bodyBvh = new MeshBVH(geometry(body.positions, body.triangles), { verbose: false });
  const nearBody = new Float64Array(n);
  const target = { point: new Vector3(), distance: 0, faceIndex: 0 };
  for (let v = 0; v < n; v++)
    nearBody[v] = bodyBvh.closestPointToPoint(at(v), target)?.distance ?? Number.POSITIVE_INFINITY;

  // Fin: the card's normal against the direction from the nearest scalp point.
  const normals = new Float64Array(n * 3);
  const u = new Vector3();
  const w = new Vector3();
  const c = new Vector3();
  for (let f = 0; f < faces; f++) {
    const q = [0, 1, 2, 3].map((k) => faceVerts[f * 4 + k] as number);
    u.subVectors(at(q[2] as number), at(q[0] as number));
    w.subVectors(at(q[3] as number), at(q[1] as number));
    c.crossVectors(u, w);
    for (const v of q) {
      normals[v * 3] = (normals[v * 3] as number) + c.x;
      normals[v * 3 + 1] = (normals[v * 3 + 1] as number) + c.y;
      normals[v * 3 + 2] = (normals[v * 3 + 2] as number) + c.z;
    }
  }
  const fin = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const hit = bodyBvh.closestPointToPoint(at(v), target);
    const nl = Math.hypot(
      normals[v * 3] as number,
      normals[v * 3 + 1] as number,
      normals[v * 3 + 2] as number,
    );
    // Too close to the scalp to know which way it faces: a shell card, not a fin.
    if (!hit || hit.distance < FIN_MIN_DISTANCE || nl === 0) continue;
    const along = Math.abs(
      ((normals[v * 3] as number) * (at(v).x - hit.point.x) +
        (normals[v * 3 + 1] as number) * (at(v).y - hit.point.y) +
        (normals[v * 3 + 2] as number) * (at(v).z - hit.point.z)) /
        (nl * hit.distance),
    );
    fin[v] = Math.round(255 * (1 - smoothstep(FIN_ALIGNED_FROM, FIN_ALIGNED_TO, along)));
  }

  // Growth: from the vertices at the scalp; a card (connected piece) that touches none
  // grows from its highest vertex (a free-hanging lock grows from where it hangs).
  const roots = new Set<number>();
  for (let v = 0; v < n; v++) if ((nearBody[v] as number) < ROOT_NEAR) roots.add(v);
  let reach = distanceAlong(adjacency, roots);
  for (let v = 0; v < n; v++) {
    if (Number.isFinite(reach[v] as number)) continue;
    // Highest vertex of this piece.
    const piece = distanceAlong(adjacency, [v]);
    let top = v;
    for (let w = 0; w < n; w++)
      if (
        Number.isFinite(piece[w] as number) &&
        (positions[w * 3 + 1] as number) > (positions[top * 3 + 1] as number)
      )
        top = w;
    roots.add(top);
    reach = distanceAlong(adjacency, roots);
  }
  const growth = Uint16Array.from(reach, (d) => Math.min(65535, Math.round(d * GROWTH_SCALE)));

  // Fade: from the boundary vertices at the scalp that no other card lies over. Cards
  // overlap through the body of a style, and a card's edge there is inside the hair;
  // only an edge with nothing over it is on the hairline.
  const cardOf = connectedPieces(adjacency);
  const pieces = new Map<number, number[]>();
  for (let f = 0; f < faces; f++) {
    const piece = cardOf[faceVerts[f * 4] as number] as number;
    const tris = pieces.get(piece) ?? [];
    const q = [0, 1, 2, 3].map((k) => faceVerts[f * 4 + k] as number);
    tris.push(
      q[0] as number,
      q[1] as number,
      q[2] as number,
      q[0] as number,
      q[2] as number,
      q[3] as number,
    );
    pieces.set(piece, tris);
  }
  const pieceBvh = new Map<number, MeshBVH>();
  for (const [piece, tris] of pieces)
    pieceBvh.set(
      piece,
      new MeshBVH(geometry(positions, Uint32Array.from(tris)), { verbose: false }),
    );
  // Each card's boundary edges, to tell a spot well inside it from one at its rim.
  const rim = new Map<number, [Vector3, Vector3][]>();
  for (const [key, count] of uses)
    if (count === 1) {
      const a = Math.floor(key / n);
      const piece = cardOf[a] as number;
      rim.set(piece, [...(rim.get(piece) ?? []), [at(a), at(key % n)]]);
    }
  const nearRim = (piece: number, p: Vector3) => {
    const line = new Line3();
    const q = new Vector3();
    for (const [a, b] of rim.get(piece) ?? []) {
      line.set(a, b);
      line.closestPointToPoint(p, true, q);
      if (q.distanceTo(p) < COVER_MARGIN) return true;
    }
    return false;
  };
  const coveredByAnother = (v: number) => {
    const p = at(v);
    for (const [piece, bvh] of pieceBvh) {
      if (piece === cardOf[v]) continue;
      const hit = bvh.closestPointToPoint(p, target);
      if (hit && hit.distance < COVERED_BY && !nearRim(piece, hit.point)) return true;
    }
    return false;
  };
  const hairline = [...boundary].filter(
    (v) => (nearBody[v] as number) < HAIRLINE_NEAR && !coveredByAnother(v),
  );
  const along = distanceAlong(adjacency, hairline);
  const fade =
    input.feather === false
      ? new Uint8Array(n).fill(255)
      : Uint8Array.from(along, (d) =>
          Number.isFinite(d) ? Math.round(255 * smoothstep(0, FADE_LENGTH, d)) : 255,
        );

  // Scalp: eligible body vertices near a card.
  const cards = new Uint32Array(faces * 6);
  for (let f = 0; f < faces; f++) {
    const q = [0, 1, 2, 3].map((k) => faceVerts[f * 4 + k] as number);
    cards.set([q[0], q[1], q[2], q[0], q[2], q[3]] as number[], f * 6);
  }
  const cardBvh = new MeshBVH(geometry(positions, cards), { verbose: false });
  const scalpVerts: number[] = [];
  const scalpWeights: number[] = [];
  const p = new Vector3();
  for (let v = 0; v < body.positions.length / 3; v++) {
    if (!input.scalpEligible[v]) continue;
    p.set(
      body.positions[v * 3] as number,
      body.positions[v * 3 + 1] as number,
      body.positions[v * 3 + 2] as number,
    );
    const d = cardBvh.closestPointToPoint(p, target)?.distance ?? Number.POSITIVE_INFINITY;
    const w = Math.round(255 * (1 - smoothstep(SCALP_FULL, SCALP_FULL + SCALP_FALLOFF, d)));
    if (w > 0) {
      scalpVerts.push(v);
      scalpWeights.push(w);
    }
  }
  return {
    growth,
    fade,
    fin,
    scalpVerts: Uint16Array.from(scalpVerts),
    scalpWeights: Uint8Array.from(scalpWeights),
  };
}
