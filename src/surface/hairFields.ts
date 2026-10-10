/**
 * Per-style data the packer measures from a hair style's cards against the body
 * at rest, for the three things alpha cards cannot do alone:
 *
 * - **growth**: how far along its card each vertex is from where the hair roots,
 *   in 0.1 mm steps. Its screen-space gradient is the strand's direction, which
 *   the Kajiya-Kay highlight needs (`src/render/hairMaterial.ts`) and which the
 *   cards' own geometry has no other way to say.
 * - **fade**: 0 where a card lies at the scalp with no other card over it (a
 *   hairline is wherever the painted hair ends there), rising to 1 over
 *   `FADE_LENGTH` along the card. Where it is low the renderer thins the hair
 *   strand by strand toward the painted edge (the card's mesh reaches past the
 *   hair painted on it, so the mesh's own boundary is not the visible hairline),
 *   so a hairline thins into the scalp instead of ending on a cut edge.
 * - **fin**: 1 on a card that stands out of the scalp instead of lying along it, 0
 *   on a card that does. Seen edge-on a fin is a hairline-thin dark sliver, so
 *   the renderer dissolves it as it turns from the eye; a card of a style's
 *   shell is seen at a grazing angle across a whole head and must not be.
 * - **scalp**: the body vertices the style grows from and how densely: 1 where a
 *   card sits on the scalp, falling to 0 over `SCALP_FALLOFF` beyond it. The skin
 *   is darkened and tinted by the hair's colour there (stubble), so the thinned
 *   hairline shows scalp rather than bare skin.
 *
 * All three depend only on the packs, so they are measured once, here.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Line3,
  Ray,
  Sphere,
  Triangle,
  Vector3,
} from "three";
import { MeshBVH } from "three-mesh-bvh";

/** Growth is stored as unsigned 16-bit steps of 1 / `GROWTH_SCALE` metre (6.5 m of hair at most). */
export const GROWTH_SCALE = 10_000;

/** A card vertex this near the scalp (metres) is a root. */
export const ROOT_NEAR = 0.015;

/**
 * A card vertex this near the scalp (metres) is on a hairline... (a card's mesh reaches
 * well past the hair painted on it, so the visible hairline is the painted edge somewhere
 * inside the mesh, not the mesh's own boundary: hair near the scalp is what marks it)
 */
export const HAIRLINE_NEAR = 0.015;

/**
 * ...unless another card passes this near it (metres), with its own edge no nearer
 * than `COVER_MARGIN` to the spot: then the edge is inside the hair.
 */
export const COVERED_BY = 0.006;

/** How far inside the covering card's own edge (metres) a spot must be for the card to cover it. */
export const COVER_MARGIN = 0.004;

/**
 * ...and a card edge is a hairline only if bare skin (a body triangle with a corner the
 * hair does not cover) lies this near it (metres). Cards that meet edge to edge at a
 * part or a crown leave edges no other card lies over, but the skin around them is all
 * under hair: thinned, they opened skin-coloured gaps there.
 */
export const BARE_NEAR = 0.01;

/** Metres along the card, from a hairline, over which hair thins in. */
export const FADE_LENGTH = 0.018;

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
  /**
   * Whether cards that stand out of the scalp are fins (default true). A tube of hair (a braid,
   * a twist, a loc) faces every way round its axis, and is solid from any side: dissolving the
   * parts of it that face away would hollow it out.
   */
  fins?: boolean;
  /**
   * The vertices the hair grows from, when the author knows them (a rope's first ring). Absent, the
   * roots are the vertices within `ROOT_NEAR` of the scalp, which for hair that lies on the scalp
   * throughout (bantu knots) is every vertex, and growth then says nothing of strand direction.
   */
  roots?: readonly number[];
  /**
   * The cards' texture cut-out: where it is clear there is no hair, so no scalp
   * tint (a card's mesh extends past the hair painted on it, and the skin beyond the
   * visible hairline must stay bare). `faceUvs` (four per quad) index `uvs`; `alpha`
   * is the cut-out, row-major, top row first.
   */
  cutout?: {
    faceUvs: Uint32Array;
    uvs: Float32Array;
    width: number;
    height: number;
    alpha: Uint8Array;
  };
}

/** `HairFields.uvScale` is stored in 1/`UV_SCALE_STEPS` of a texture unit per metre. */
export const UV_SCALE_STEPS = 16;

export interface HairFields {
  /** Per card vertex, distance along the card from its root in 1 / `GROWTH_SCALE` metre. */
  growth: Uint16Array;
  /**
   * Per card vertex, how many texture units its card spans per metre, in
   * 1/`UV_SCALE_STEPS` (0 without a `cutout`, which carries the UVs). The renderer
   * divides it out to find strands a few millimetres wide wherever the card's island
   * sits in the atlas.
   */
  uvScale: Uint16Array;
  /** Per card vertex, 0 (cut away) to 255 (all there). */
  fade: Uint8Array;
  /** Per card vertex, 0 (lies along the scalp) to 255 (stands out of it). */
  fin: Uint8Array;
  /** Body control vertices the style grows from... */
  scalpVerts: Uint16Array;
  /** ...and each one's hair density, 1 to 255 (never 0: a vertex without hair is not listed). */
  scalpWeights: Uint8Array;
}

/** A ray looking for hair over a body vertex starts this far (metres) under the skin, so it finds a card lying on it. */
const COVER_BELOW = 0.002;
const AXIS = new Vector3();

/** The scalp density above which the skin under a card vertex is covered by hair, not a hairline's bare edge. */
const HAIR_COVERED = 0.25;

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

const TRI_A = new Vector3();
const TRI_B = new Vector3();
const TRI_C = new Vector3();
const BARY = new Vector3();

/**
 * 1 where the card's texture is opaque at a hit's closest point on the cards, 0
 * where it is clear (a smoothstep between a quarter and three quarters).
 */
function hairUnder(
  hit: { point: Vector3; faceIndex: number },
  cutout: NonNullable<HairFieldsInput["cutout"]>,
  faceVerts: Uint32Array,
  positions: Float32Array,
): number {
  const f = hit.faceIndex >> 1;
  // Triangle 2f is the quad's corners (0, 1, 2); 2f + 1 is (0, 2, 3).
  const corners = hit.faceIndex % 2 === 0 ? [0, 1, 2] : [0, 2, 3];
  const vert = (k: number) => faceVerts[f * 4 + (corners[k] as number)] as number;
  const set = (t: Vector3, v: number) =>
    t.set(
      positions[v * 3] as number,
      positions[v * 3 + 1] as number,
      positions[v * 3 + 2] as number,
    );
  set(TRI_A, vert(0));
  set(TRI_B, vert(1));
  set(TRI_C, vert(2));
  Triangle.getBarycoord(hit.point, TRI_A, TRI_B, TRI_C, BARY);
  const uv = (k: number, axis: number) =>
    cutout.uvs[(cutout.faceUvs[f * 4 + (corners[k] as number)] as number) * 2 + axis] as number;
  const u = BARY.x * uv(0, 0) + BARY.y * uv(1, 0) + BARY.z * uv(2, 0);
  const v = BARY.x * uv(0, 1) + BARY.y * uv(1, 1) + BARY.z * uv(2, 1);
  const col = Math.min(cutout.width - 1, Math.max(0, Math.floor(u * cutout.width)));
  const row = Math.min(cutout.height - 1, Math.max(0, Math.floor((1 - v) * cutout.height)));
  const alpha = (cutout.alpha[row * cutout.width + col] as number) / 255;
  return smoothstep(0.25, 0.75, alpha);
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
  for (let v = 0; v < n && input.fins !== false; v++) {
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
  if (input.roots) for (const v of input.roots) roots.add(v);
  else for (let v = 0; v < n; v++) if ((nearBody[v] as number) < ROOT_NEAR) roots.add(v);
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

  // Scalp density: each eligible body vertex's share of hair, 1 within SCALP_FULL of a card's
  // opaque hair and falling to 0 over SCALP_FALLOFF. The most of every card near it counts (a
  // card's mesh may be over the transparent texels of one beside it), so a seam between two cards
  // is not bare skin.
  const cards = new Uint32Array(faces * 6);
  for (let f = 0; f < faces; f++) {
    const q = [0, 1, 2, 3].map((k) => faceVerts[f * 4 + k] as number);
    cards.set([q[0], q[1], q[2], q[0], q[2], q[3]] as number[], f * 6);
  }
  const cardBvh = new MeshBVH(geometry(positions, cards), { verbose: false });
  const bodyCount = body.positions.length / 3;
  const bodyDensity = new Float64Array(bodyCount);
  // Each body vertex's outward normal: its triangles' area-weighted normals.
  const bodyNormals = new Float64Array(bodyCount * 3);
  {
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let t = 0; t < body.triangles.length; t += 3) {
      const i = [0, 1, 2].map((k) => body.triangles[t + k] as number);
      const load = (target: Vector3, vertex: number) =>
        target.set(
          body.positions[vertex * 3] as number,
          body.positions[vertex * 3 + 1] as number,
          body.positions[vertex * 3 + 2] as number,
        );
      load(a, i[0] as number);
      load(b, i[1] as number);
      load(c, i[2] as number);
      b.sub(a);
      c.sub(a);
      b.cross(c);
      for (const vertex of i) {
        bodyNormals[vertex * 3] = (bodyNormals[vertex * 3] as number) + b.x;
        bodyNormals[vertex * 3 + 1] = (bodyNormals[vertex * 3 + 1] as number) + b.y;
        bodyNormals[vertex * 3 + 2] = (bodyNormals[vertex * 3 + 2] as number) + b.z;
      }
    }
    for (let v = 0; v < bodyCount; v++) {
      const len = Math.hypot(
        bodyNormals[v * 3] as number,
        bodyNormals[v * 3 + 1] as number,
        bodyNormals[v * 3 + 2] as number,
      );
      if (len > 0)
        for (let k = 0; k < 3; k++)
          bodyNormals[v * 3 + k] = (bodyNormals[v * 3 + k] as number) / len;
    }
  }
  const ray = new Ray();
  const p = new Vector3();
  const near = new Vector3();
  const spread = SCALP_FULL + SCALP_FALLOFF;
  const sphere = new Sphere(p, spread);
  for (let v = 0; v < bodyCount; v++) {
    if (!input.scalpEligible[v]) continue;
    p.set(
      body.positions[v * 3] as number,
      body.positions[v * 3 + 1] as number,
      body.positions[v * 3 + 2] as number,
    );
    sphere.center.copy(p);
    let density = 0;
    cardBvh.shapecast({
      intersectsBounds: (box) => sphere.intersectsBox(box),
      intersectsTriangle: (tri, index) => {
        tri.closestPointToPoint(p, near);
        const d = near.distanceTo(p);
        let share = 1 - smoothstep(SCALP_FULL, spread, d);
        if (share <= density) return false;
        if (input.cutout)
          share *= hairUnder({ point: near, faceIndex: index }, input.cutout, faceVerts, positions);
        density = Math.max(density, share);
        return false;
      },
    });
    // And hair standing over the vertex, along its normal, counts: a card above the skin that
    // covers it is hair, though the card's closest point to it may be a clear texel.
    if (density < 1 && input.cutout) {
      const n3 = bodyNormals.subarray(v * 3, v * 3 + 3);
      if (n3[0] !== 0 || n3[1] !== 0 || n3[2] !== 0) {
        ray.origin.copy(p).addScaledVector(AXIS.fromArray(n3), -COVER_BELOW);
        ray.direction.copy(AXIS);
        for (const hit of cardBvh.raycast(ray, DoubleSide, 0, COVER_BELOW + SCALP_DEPTH)) {
          if (typeof hit.faceIndex !== "number") continue;
          density = Math.max(
            density,
            hairUnder(
              { point: hit.point, faceIndex: hit.faceIndex },
              input.cutout,
              faceVerts,
              positions,
            ),
          );
        }
      }
    }
    bodyDensity[v] = density;
  }
  // How bare the skin under a card vertex is: the density at the nearest point of the body, 1
  // under hair and 0 on a face, a neck or a temple the hair stops short of.
  const bodyTri = new Vector3();
  const skinUnder = (v: number): number => {
    const hit = bodyBvh.closestPointToPoint(at(v), target);
    if (!hit) return 1;
    const corner = (k: number) => body.triangles[hit.faceIndex * 3 + k] as number;
    const place = (t: Vector3, i: number) =>
      t.set(
        body.positions[i * 3] as number,
        body.positions[i * 3 + 1] as number,
        body.positions[i * 3 + 2] as number,
      );
    place(TRI_A, corner(0));
    place(TRI_B, corner(1));
    place(TRI_C, corner(2));
    Triangle.getBarycoord(hit.point, TRI_A, TRI_B, TRI_C, bodyTri);
    return (
      bodyTri.x * (bodyDensity[corner(0)] as number) +
      bodyTri.y * (bodyDensity[corner(1)] as number) +
      bodyTri.z * (bodyDensity[corner(2)] as number)
    );
  };

  // Fade: from the vertices at the scalp that no other card lies over. Cards overlap
  // through the body of a style, and a card there is inside the hair; only one with
  // nothing over it can end on a hairline. (Not only boundary vertices: the visible
  // hairline is where the painted hair ends, which is inside the card's mesh.)
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
  // Bare skin: the body triangles with a corner the hair does not cover.
  const bare: number[] = [];
  for (let t = 0; t < body.triangles.length; t += 3)
    if (
      [0, 1, 2].some((k) => (bodyDensity[body.triangles[t + k] as number] as number) < HAIR_COVERED)
    )
      bare.push(
        body.triangles[t] as number,
        body.triangles[t + 1] as number,
        body.triangles[t + 2] as number,
      );
  const bareBvh =
    bare.length > 0
      ? new MeshBVH(geometry(body.positions, Uint32Array.from(bare)), { verbose: false })
      : null;
  const bordersBare = (v: number) =>
    (bareBvh?.closestPointToPoint(at(v), target)?.distance ?? Number.POSITIVE_INFINITY) < BARE_NEAR;
  const hairline: number[] = [];
  for (let v = 0; v < n; v++) {
    if ((nearBody[v] as number) >= HAIRLINE_NEAR) continue;
    // Any vertex above skin the hair has not reached (the visible hairline is inside the mesh,
    // where the painted hair ends), or a boundary vertex that no other card lies over and that
    // borders bare skin (not one where cards meet at a part or a crown).
    if (skinUnder(v) < HAIR_COVERED || (boundary.has(v) && !coveredByAnother(v) && bordersBare(v)))
      hairline.push(v);
  }
  const along = distanceAlong(adjacency, hairline);
  const fade =
    input.feather === false
      ? new Uint8Array(n).fill(255)
      : Uint8Array.from(along, (d) =>
          Number.isFinite(d) ? Math.round(255 * smoothstep(0, FADE_LENGTH, d)) : 255,
        );

  // UV scale: per face, the UV length of its edges over their length in metres; per vertex, the mean.
  const uvScale = new Uint16Array(n);
  if (input.cutout) {
    const { faceUvs, uvs } = input.cutout;
    const sum = new Float64Array(n);
    const count = new Uint16Array(n);
    for (let f = 0; f < faces; f++) {
      let world = 0;
      let uv = 0;
      for (let k = 0; k < 4; k++) {
        const a = faceVerts[f * 4 + k] as number;
        const b = faceVerts[f * 4 + ((k + 1) % 4)] as number;
        world += at(a).distanceTo(at(b));
        const ua = faceUvs[f * 4 + k] as number;
        const ub = faceUvs[f * 4 + ((k + 1) % 4)] as number;
        uv += Math.hypot(
          (uvs[ua * 2] as number) - (uvs[ub * 2] as number),
          (uvs[ua * 2 + 1] as number) - (uvs[ub * 2 + 1] as number),
        );
      }
      if (world <= 0) continue;
      for (let k = 0; k < 4; k++) {
        const v = faceVerts[f * 4 + k] as number;
        sum[v] = (sum[v] as number) + uv / world;
        count[v] = (count[v] as number) + 1;
      }
    }
    for (let v = 0; v < n; v++)
      if ((count[v] as number) > 0)
        uvScale[v] = Math.min(
          65535,
          Math.round(((sum[v] as number) / (count[v] as number)) * UV_SCALE_STEPS),
        );
  }

  const scalpVerts: number[] = [];
  const scalpWeights: number[] = [];
  for (let v = 0; v < bodyDensity.length; v++) {
    const w = Math.round(255 * (bodyDensity[v] as number));
    if (w > 0) {
      scalpVerts.push(v);
      scalpWeights.push(w);
    }
  }
  return {
    growth,
    uvScale,
    fade,
    fin,
    scalpVerts: Uint16Array.from(scalpVerts),
    scalpWeights: Uint8Array.from(scalpWeights),
  };
}
