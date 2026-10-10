/**
 * The skin a drawn shape rests on (docs/research/ADULT-SCULPT-PLAN.md, section
 * 6d): the adult surface's lattice round the reservoirs, without their caps,
 * which the shapes replace. Sized and posed, a sculpted form can press into the
 * skin beside its root (a sac widened to hold its testes, against the groin); a
 * vertex that lies inside the skin is moved out to it, as soft tissue rests on
 * skin rather than passing through it.
 */
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { AdultDetailLattice } from "../../../src/model/humanoidModel.ts";
import type { Vec3 } from "./disc.ts";
import type { ReservoirRoot, RootShape } from "./root.ts";

/** How far outside the skin a pushed vertex is left, metres. */
const CLEARANCE = 0.001;
/** How far from the skin's nearest point a vertex may be and still be pushed out to it, metres. */
const REACH = 0.02;
/** How near a loop vertex skin is the root's own, which a shape is not pushed off (`rest`), metres. */
const ROOT_SKIN = 0.004;
/** Sweeps that spread a push to the vertices round it. */
const SPREAD = 40;

/** How near an edge or corner of its triangle, by barycentric weight, a nearest point is on it (`Surface.depth`). */
const ON_FEATURE = 1e-5;

/**
 * A lattice's polygons as triangles, for the point of them nearest a point and which
 * side of them the point is on.
 *
 * The side is told by the angle-weighted pseudo-normal of the feature the nearest
 * point is on (Bærentzen and Aanæs, "Signed distance computation using the angle
 * weighted pseudonormal", 2005): its triangle's normal inside it, the sum of its two
 * triangles' normals on an edge, and the sum of its triangles' normals, each weighted
 * by its angle there, at a corner. Told by the nearest triangle's own normal, a point
 * whose nearest point is on a crease (between a thigh and the groin) is on the wrong
 * side of one of the two triangles as often as not: a sac's lobe hanging clear between
 * the thighs was put 13 mm inside one and pushed out of it into a spike.
 */
class Surface {
  private readonly bvh: MeshBVH;
  private readonly positions: Float32Array;
  private readonly index: Uint32Array;
  /** Per triangle (of `index`, as the BVH left it), its unit normal. */
  private readonly faceNormals: Float32Array;
  /** Per vertex, the angle-weighted sum of its triangles' normals. */
  private readonly cornerNormals: Float32Array;
  /** Per edge (`edgeKey`), the sum of its triangles' normals. */
  private readonly edgeNormals = new Map<string, Vec3>();

  /** The lattice's polygons, but for `without` (polygon ids). */
  constructor(
    lattice: Pick<AdultDetailLattice, "latticePositions" | "polygons">,
    without: ReadonlySet<number>,
  ) {
    const poly = lattice.polygons;
    const triangles: number[] = [];
    for (let i = 0; i + 1 < poly.start.length; i++) {
      if (without.has(poly.id[i] as number)) continue;
      const s = poly.start[i] as number;
      const e = poly.start[i + 1] as number;
      for (let c = s + 1; c + 1 < e; c++)
        triangles.push(
          poly.vertices[s] as number,
          poly.vertices[c] as number,
          poly.vertices[c + 1] as number,
        );
    }
    this.positions = Float32Array.from(lattice.latticePositions);
    // The BVH reorders the index it is given, and `depth` reads its faces from the same array.
    this.index = Uint32Array.from(triangles);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    geometry.setIndex(new BufferAttribute(this.index, 1));
    this.bvh = new MeshBVH(geometry, { verbose: false });
    const tris = this.index.length / 3;
    this.faceNormals = new Float32Array(tris * 3);
    this.cornerNormals = new Float32Array(this.positions.length);
    for (let t = 0; t < tris; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => this.corner(t, k)) as [Vec3, Vec3, Vec3];
      const n = cross3(sub3(b, a), sub3(c, a));
      const l = Math.hypot(...n);
      if (!(l > 0)) continue;
      const unit: Vec3 = [n[0] / l, n[1] / l, n[2] / l];
      this.faceNormals.set(unit, t * 3);
      const corners = [a, b, c];
      for (let k = 0; k < 3; k++) {
        const v = this.index[t * 3 + k] as number;
        const p = corners[k] as Vec3;
        const angle = angleBetween(
          sub3(corners[(k + 1) % 3] as Vec3, p),
          sub3(corners[(k + 2) % 3] as Vec3, p),
        );
        for (let i = 0; i < 3; i++)
          this.cornerNormals[v * 3 + i] =
            (this.cornerNormals[v * 3 + i] as number) + angle * (unit[i] as number);
        const w = this.index[t * 3 + ((k + 1) % 3)] as number;
        const key = edgeKey(v, w);
        const e = this.edgeNormals.get(key) ?? [0, 0, 0];
        this.edgeNormals.set(key, [e[0] + unit[0], e[1] + unit[1], e[2] + unit[2]]);
      }
    }
  }

  /** Corner `k` of triangle `t`. */
  private corner(t: number, k: number): Vec3 {
    const v = this.index[t * 3 + k] as number;
    return [
      this.positions[v * 3] as number,
      this.positions[v * 3 + 1] as number,
      this.positions[v * 3 + 2] as number,
    ];
  }

  /**
   * How far a point is outside the surface (negative inside), with the nearest point
   * and the outward normal there (the pseudo-normal of the feature it is on).
   */
  depth(p: Vec3): { depth: number; point: Vec3; normal: Vec3 } {
    const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
    this.bvh.closestPointToPoint(new Vector3(p[0], p[1], p[2]), hit);
    const t = hit.faceIndex;
    const q: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
    const [a, b, c] = [0, 1, 2].map((k) => this.corner(t, k)) as [Vec3, Vec3, Vec3];
    // The nearest point's weights on the triangle's corners: a weight near 0 puts it on
    // the opposite edge, two near 0 at a corner.
    const area = (x: Vec3, y: Vec3, z: Vec3) => Math.hypot(...cross3(sub3(y, x), sub3(z, x)));
    const whole = area(a, b, c);
    const weights =
      whole > 0 ? [area(q, b, c) / whole, area(a, q, c) / whole, area(a, b, q) / whole] : [1, 0, 0];
    const off = weights.map((x) => (x as number) < ON_FEATURE);
    const corners = [0, 1, 2].map((k) => this.index[t * 3 + k] as number);
    let pseudo: Vec3;
    const zeros = off.filter(Boolean).length;
    if (zeros >= 2) {
      const v = corners[off.indexOf(false)] as number;
      pseudo = [0, 1, 2].map((i) => this.cornerNormals[v * 3 + i] as number) as unknown as Vec3;
    } else if (zeros === 1) {
      const k = off.indexOf(true);
      pseudo = this.edgeNormals.get(
        edgeKey(corners[(k + 1) % 3] as number, corners[(k + 2) % 3] as number),
      ) as Vec3;
    } else pseudo = [0, 1, 2].map((i) => this.faceNormals[t * 3 + i] as number) as unknown as Vec3;
    const l = Math.hypot(...pseudo) || 1;
    const normal: Vec3 = [pseudo[0] / l, pseudo[1] / l, pseudo[2] / l];
    const d = sub3(p, q);
    const depth =
      Math.sign(d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]) * Math.hypot(...d);
    return { depth, point: q, normal };
  }
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const angleBetween = (a: Vec3, b: Vec3) =>
  Math.atan2(Math.hypot(...cross3(a, b)), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export class Skin {
  /** The skin a shape rests on: the lattice without the reservoirs' caps, which the shapes replace. */
  private readonly round: Surface;
  /** The body's surface at rest, caps and all. */
  private readonly whole: Surface;

  /** The lattice's polygons, but for `without` (polygon ids: the reservoirs' caps). */
  constructor(
    lattice: Pick<AdultDetailLattice, "latticePositions" | "polygons">,
    without: ReadonlySet<number>,
  ) {
    this.round = new Surface(lattice, without);
    this.whole = new Surface(lattice, new Set());
  }

  /** How far a point is outside the skin (negative inside), with the nearest point and the outward normal there. */
  depth(p: Vec3): { depth: number; point: Vec3; normal: Vec3 } {
    return this.round.depth(p);
  }

  /**
   * How far a point is outside the body's surface at rest, the caps included (negative
   * inside), with the nearest point and the outward normal there: where a sculpt comes
   * out of the skin (`transfer.ts`, `skirtOnto`). The
   * skin without the caps has a hole under every reservoir, and a point over a hole is
   * measured against the hole's rim, tilted away from it.
   */
  surfaceDepth(p: Vec3): { depth: number; point: Vec3; normal: Vec3 } {
    return this.whole.depth(p);
  }

  /**
   * The shape resting on the skin: every vertex that lies inside it, or nearer than
   * the clearance, is moved out along the skin's normal to the clearance, and its
   * neighbours with it, so the shape flattens against the skin as soft tissue does
   * rather than folding round a few moved vertices. The loop and the first ring stay
   * where they are: the first ring is the skin line a sculpt is attached at
   * (`transfer.ts`, `skinLine`), on the skin by its making, and pushed to the clearance
   * it would stand a millimetre off the skin round it, a step all round the root.
   *
   * Skin at the root (within `ROOT_SKIN` of a loop or first-ring vertex) is its own, where the
   * shape comes out of it and lies on it by its making: a vertex nearest it is not
   * pushed. Pushed, the first bands beside the pinned first ring stood up and turned
   * over (18 quads of the erect shaft's second band).
   */
  rest(root: ReservoirRoot, shape: RootShape): RootShape {
    const count = shape.length;
    const n = root.loop.length;
    const c = root.cap.length;
    const onSkin = (v: number) => v >= c && v < c + n;
    // The root's own skin runs from the loop to the first ring, which a narrowed root
    // draws in over it (`form.ts`, `Pose.rootFollows`).
    const rim = [...root.loop, ...shape.slice(c, c + n)];
    const atRoot = (q: Vec3) =>
      rim.some((l) => Math.hypot(q[0] - l[0], q[1] - l[1], q[2] - l[2]) <= ROOT_SKIN);
    // The push each vertex needs, along the skin's normal.
    const need: { amount: number; normal: Vec3 }[] = shape.map((p, v) => {
      if (onSkin(v)) return { amount: 0, normal: root.normal };
      const d = this.depth(p);
      // Only skin the vertex is just under: deep inside means another part of the body.
      const near = Math.hypot(p[0] - d.point[0], p[1] - d.point[1], p[2] - d.point[2]) <= REACH;
      const amount = near ? Math.max(0, CLEARANCE - d.depth) : 0;
      return { amount: amount > 0 && !atRoot(d.point) ? amount : 0, normal: d.normal };
    });
    if (need.every((x) => x.amount === 0)) return shape;
    const neighbours = shapeNeighbours(root);
    let move = new Float64Array(count * 3);
    need.forEach((x, i) => {
      for (let k = 0; k < 3; k++) move[i * 3 + k] = (x.normal[k] as number) * x.amount;
    });
    let next = new Float64Array(count * 3);
    for (let it = 0; it < SPREAD; it++) {
      for (let i = 0; i < count; i++) {
        if (onSkin(i)) {
          for (let k = 0; k < 3; k++) next[i * 3 + k] = move[i * 3 + k] as number;
          continue;
        }
        const around = neighbours[i] as number[];
        const mean = [0, 0, 0];
        for (const j of around) {
          if (j < 0) continue; // the loop: no move
          for (let k = 0; k < 3; k++)
            mean[k] = (mean[k] as number) + (move[j * 3 + k] as number) / around.length;
        }
        for (let k = 0; k < 3; k++) {
          const m = move[i * 3 + k] as number;
          next[i * 3 + k] = around.length ? (m + (mean[k] as number)) / 2 : m;
        }
        // Never less than the vertex's own need along its normal.
        const { amount, normal } = need[i] as { amount: number; normal: Vec3 };
        const along =
          (next[i * 3] as number) * normal[0] +
          (next[i * 3 + 1] as number) * normal[1] +
          (next[i * 3 + 2] as number) * normal[2];
        if (along < amount)
          for (let k = 0; k < 3; k++)
            next[i * 3 + k] =
              (next[i * 3 + k] as number) + (normal[k] as number) * (amount - along);
      }
      [move, next] = [next, move];
    }
    return shape.map(
      (p, i) =>
        [
          p[0] + (move[i * 3] as number),
          p[1] + (move[i * 3 + 1] as number),
          p[2] + (move[i * 3 + 2] as number),
        ] as Vec3,
    );
  }
}

/** Each reservoir's shape neighbours (`shapeNeighbours`), built once per root. */
const neighbourCache = new WeakMap<ReservoirRoot, number[][]>();

/**
 * Each vertex of a reservoir's shape (`RootShape` order) with its neighbours: round
 * its ring and to the rings either side, and across the cap's polygons. The loop is
 * not in the shape, so a first ring's vertex has one ring of neighbours fewer and the
 * displacement fades toward the loop.
 */
function shapeNeighbours(root: ReservoirRoot): number[][] {
  const known = neighbourCache.get(root);
  if (known) return known;
  const built = buildNeighbours(root);
  neighbourCache.set(root, built);
  return built;
}

function buildNeighbours(root: ReservoirRoot): number[][] {
  const n = root.loop.length;
  const c = root.cap.length;
  const R = root.rings;
  const out: Set<number>[] = Array.from({ length: c + R * n }, () => new Set());
  const ring = (k: number, i: number) => c + (k - 1) * n + (((i % n) + n) % n);
  for (let k = 1; k <= R; k++)
    for (let i = 0; i < n; i++) {
      const v = ring(k, i);
      (out[v] as Set<number>).add(ring(k, i - 1)).add(ring(k, i + 1));
      // A first ring's vertex leans on the loop, which never moves: -1 stands for it.
      (out[v] as Set<number>).add(k > 1 ? ring(k - 1, i) : -1);
      if (k < R) (out[v] as Set<number>).add(ring(k + 1, i));
    }
  // The cap's polygons; a loop corner stands for the last ring's vertex there.
  const index = (corner: { loop: number } | { cap: number }) =>
    "loop" in corner ? ring(R, corner.loop) : corner.cap;
  for (const poly of root.capPolygons)
    for (let k = 0; k < poly.length; k++) {
      const a = index(poly[k] as { loop: number } | { cap: number });
      const b = index(poly[(k + 1) % poly.length] as { loop: number } | { cap: number });
      (out[a] as Set<number>).add(b);
      (out[b] as Set<number>).add(a);
    }
  return out.map((s) => [...s]);
}

/** The skin round a lattice's reservoirs: its polygons but for every reservoir's cap. */
export function skinOf(
  lattice: Pick<AdultDetailLattice, "latticePositions" | "polygons">,
  caps: readonly (readonly number[])[],
): Skin {
  return new Skin(lattice, new Set(caps.flat()));
}
