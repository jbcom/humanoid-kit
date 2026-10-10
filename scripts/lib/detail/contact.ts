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
/** Sweeps that spread a push to the vertices round it. */
const SPREAD = 40;

export class Skin {
  private readonly bvh: MeshBVH;
  private readonly positions: Float32Array;
  private readonly index: Uint32Array;

  /** The lattice's polygons, but for `without` (polygon ids: the reservoirs' caps). */
  constructor(lattice: Pick<AdultDetailLattice, "latticePositions" | "polygons">, without: ReadonlySet<number>) {
    const poly = lattice.polygons;
    const triangles: number[] = [];
    for (let i = 0; i + 1 < poly.start.length; i++) {
      if (without.has(poly.id[i] as number)) continue;
      const s = poly.start[i] as number;
      const e = poly.start[i + 1] as number;
      for (let c = s + 1; c + 1 < e; c++)
        triangles.push(poly.vertices[s] as number, poly.vertices[c] as number, poly.vertices[c + 1] as number);
    }
    this.positions = Float32Array.from(lattice.latticePositions);
    this.index = Uint32Array.from(triangles);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    geometry.setIndex(new BufferAttribute(this.index, 1));
    this.bvh = new MeshBVH(geometry, { verbose: false });
  }

  /** How far a point is outside the skin (negative inside), with the nearest point and the outward normal there. */
  depth(p: Vec3): { depth: number; point: Vec3; normal: Vec3 } {
    const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
    this.bvh.closestPointToPoint(new Vector3(p[0], p[1], p[2]), hit);
    const f = hit.faceIndex;
    const at = (k: number): Vec3 => {
      const v = this.index[f * 3 + k] as number;
      return [
        this.positions[v * 3] as number,
        this.positions[v * 3 + 1] as number,
        this.positions[v * 3 + 2] as number,
      ];
    };
    const [a, b, c] = [at(0), at(1), at(2)];
    const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const nl = Math.hypot(...n) || 1;
    const normal: Vec3 = [n[0] / nl, n[1] / nl, n[2] / nl];
    const q: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
    const depth = (p[0] - q[0]) * normal[0] + (p[1] - q[1]) * normal[1] + (p[2] - q[2]) * normal[2];
    return { depth, point: q, normal };
  }

  /**
   * The shape resting on the skin: every vertex that lies inside it, or nearer than
   * the clearance, is moved out along the skin's normal to the clearance, and its
   * neighbours with it, so the shape flattens against the skin as soft tissue does
   * rather than folding round a few moved vertices. The loop stays where it is.
   */
  rest(root: ReservoirRoot, shape: RootShape): RootShape {
    const count = shape.length;
    // The push each vertex needs, along the skin's normal.
    const need: { amount: number; normal: Vec3 }[] = shape.map((p) => {
      const d = this.depth(p);
      // Only skin the vertex is just under: deep inside means another part of the body.
      const near = Math.hypot(p[0] - d.point[0], p[1] - d.point[1], p[2] - d.point[2]) <= REACH;
      return { amount: near ? Math.max(0, CLEARANCE - d.depth) : 0, normal: d.normal };
    });
    if (need.every((x) => x.amount === 0)) return shape;
    const neighbours = shapeNeighbours(root);
    const move = need.map((x) => [x.normal[0] * x.amount, x.normal[1] * x.amount, x.normal[2] * x.amount]);
    for (let it = 0; it < SPREAD; it++) {
      const next = move.map((m, i) => {
        const around = neighbours[i] as number[];
        const mean = [0, 0, 0];
        for (const j of around) {
          if (j < 0) continue; // the loop: no move
          for (let k = 0; k < 3; k++) mean[k] = (mean[k] as number) + ((move[j] as number[])[k] as number) / around.length;
        }
        const out = around.length ? m.map((x, k) => (x + (mean[k] as number)) / 2) : m;
        // Never less than the vertex's own need along its normal.
        const { amount, normal } = need[i] as { amount: number; normal: Vec3 };
        const along = (out[0] as number) * normal[0] + (out[1] as number) * normal[1] + (out[2] as number) * normal[2];
        if (along < amount) for (let k = 0; k < 3; k++) out[k] = (out[k] as number) + normal[k as 0 | 1 | 2] * (amount - along);
        return out;
      });
      for (let i = 0; i < count; i++) move[i] = next[i] as number[];
    }
    return shape.map((p, i) => {
      const m = move[i] as number[];
      return [p[0] + (m[0] as number), p[1] + (m[1] as number), p[2] + (m[2] as number)] as Vec3;
    });
  }
}

/**
 * Each vertex of a reservoir's shape (`RootShape` order) with its neighbours: round
 * its ring and to the rings either side, and across the cap's polygons. The loop is
 * not in the shape, so a first ring's vertex has one ring of neighbours fewer and the
 * displacement fades toward the loop.
 */
function shapeNeighbours(root: ReservoirRoot): number[][] {
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
