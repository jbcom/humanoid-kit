/**
 * The vulva's outer form, transferred onto the skin of the adult surface's region
 * (docs/research/ADULT-SCULPT-PLAN.md, section 6f): the labia majora and minora, the
 * cleft between them and the shallow vestibule, from bogdan666's CC0
 * `adult_female_2020` proxy (`packs/adult-anatomy/source/PROVENANCE.md`).
 *
 * The labia are the skin's own folds, so they are a displacement of the region's
 * vertices, not a reservoir drawn out of it. The cut (`scripts/blender/cut_sculpt.py`)
 * is the vulva with a margin of plain skin round it, one sheet; the transfer takes
 * the disc of it round the vulva (`VULVA_SHEET`).
 *
 * Placing it. The proxy is a whole body of another shape than ours, and a similarity
 * fitted over all of it leaves the crotch 3 cm out; fitted over the cut's own
 * neighbourhood, against where the proxy's binding puts each vertex on our rest
 * body, it leaves 5 mm (the median). The fitted sheet is then carried to the figure
 * whole, by the rigid motion our binding gives its edge, as a sculpted part is
 * (`placeSculpt`).
 *
 * Transferring it. Each region vertex takes the point of the sheet seen from outside
 * along its normal: the first the line from a little outside the skin inward meets.
 * That is the surface as it shows, the majora's outer faces, the minora between them
 * and the cleft's floor where it is open, and the region's normals are the smooth
 * base's, so neighbouring lines run alike and land on neighbouring points. Where the
 * sheet ends, its edge lies on plain skin a few millimetres from ours, as the two
 * bodies differ; that difference, carried inward harmonically from the rim of what
 * the lines reach, is taken off, so the displacement is the vulva's own form, and it
 * fades in over a few rings of vertices from there.
 *
 * Rejected, each tried and rendered (docs/research/ADULT-SCULPT-PLAN.md, 6f):
 * - the nearest point of the sheet along the normal either way, as a displacement
 *   map is baked from a cage inside and out: lines either side of the midline took
 *   whichever wall or fold was nearer, and the labia came out in streaks;
 * - the nearest point of the sheet: lines over the cleft gathered on its rims, and
 *   the patch came out faceted;
 * - both discs mapped onto the unit disc (stretch-minimised mean-value maps) and
 *   matched there: a bijection, but the folds' hidden faces took as many vertices as
 *   their area, and what shows was left blurred;
 * - the vulva's form against the sheet filled in under it biharmonically, at the
 *   fill's nearest point: the graph Laplacian's fill of the densely meshed vulva
 *   from its sparse margin buckled into flaps 8 cm deep.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { AdultReservoirSpec, HumanoidAssets } from "../../../src/format/assetFormat.ts";
import { evaluateBinding } from "../../../src/mhclo/bound.ts";
import type { AdultDetailLattice } from "../../../src/model/humanoidModel.ts";
import { MH_UNIT } from "../compileAsset.ts";
import { bindToBody } from "../hairCards/bind.ts";
import type { Vec3 } from "./disc.ts";
import {
  boundaryLoop,
  boundSource,
  readObj,
  restBody,
  SCULPT_SOURCES,
  type SculptPart,
  sourceCuts,
} from "./sculpt.ts";
import { applySimilarity, fitRigid, fitSimilarity } from "./similarity.ts";

/** The source the vulva is cut from. */
export const VULVA_SOURCE = "adult_female_2020_v_01";

/** The vulva's virtual modifier: how much of it there is, none (0) to the sculpt's (1). */
export const VULVA_SIZE = "genitals/vulva-size";

/** Its one key: the whole form at the modifier's 1. */
export const VULVA_TARGET = "genitals/vulva-k1";

/**
 * The sheet the transfer takes, in the source's own units before `readObj`'s scaling
 * (y up, +z forward): an ellipse across the crotch, seen from below, round the majora,
 * the minora and the vestibule (they span x -0.20 to 0.20, z -0.17 to 1.00 and y -0.82
 * to -0.45) with a margin of plain skin, above the cleft's floor, below which the
 * inner thighs' skin hangs. What it encloses comes with it.
 */
const VULVA_SHEET = { x: 0.21, z: [-0.22, 1.06], floor: -0.86 } as const;

/** How far outside the skin a sight line starts, and how far past it it looks, metres (`seenFrom`). */
const SIGHT = 0.025;

/** Over how many rings of vertices the form fades in from the rim of what the lines reach. */
const FADE_RINGS = 5;

/**
 * How deep under our skin the form may reach, metres. The sheet's vestibule is a pit
 * 17 mm deep and narrower than two of our vertices' spacing; a vertex on the midline
 * that looked straight into it was drawn down 17 mm while its neighbours 2 mm aside
 * stayed on the minora, a needle. The cleft between the labia is 4 to 6 mm deep; the
 * vestibule's depth and the canal behind it are the vaginal reservoir's to draw.
 */
const DEPTH = 0.006;

const point3 = (p: ArrayLike<number>, i: number): Vec3 => [
  p[i * 3] as number,
  p[i * 3 + 1] as number,
  p[i * 3 + 2] as number,
];

/**
 * The vulva's sheet from its source (`VULVA_SHEET`), placed on the figure whose base
 * positions are `figure`: a similarity fitted from the source to where its binding
 * puts it on our rest body, over the source's vertices inside the cut's box, then
 * carried rigidly with its edge. Its boundary is its edge, in order.
 */
export function placeVulva(assets: HumanoidAssets, figure: Float32Array): SculptPart {
  const cuts = sourceCuts(VULVA_SOURCE);
  if (!cuts.parts.vulva?.disc) throw new Error(`sculpt ${VULVA_SOURCE}: no vulva cut as a disc`);
  const body = restBody(assets);
  const cut = readObj(`${SCULPT_SOURCES}/${VULVA_SOURCE}/vulva.obj`);
  const sheet = sheetOf(cut.positions, cut.faces);
  const { obj, placed } = boundSource(VULVA_SOURCE, body.positions);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < cut.positions.length; v++) {
    const k = v % 3;
    lo[k] = Math.min(lo[k] as number, cut.positions[v] as number);
    hi[k] = Math.max(hi[k] as number, cut.positions[v] as number);
  }
  const from: Vec3[] = [];
  const to: Vec3[] = [];
  for (let v = 0; v < obj.positions.length / 3; v++) {
    const p = point3(obj.positions, v);
    if (p.some((x, k) => x < (lo[k] as number) || x > (hi[k] as number))) continue;
    from.push(p);
    to.push(point3(placed, v));
  }
  const fit = fitSimilarity(from, to);
  const n = sheet.vertices.length;
  const atRest = new Float32Array(n * 3);
  sheet.vertices.forEach((v, i) => {
    atRest.set(applySimilarity(fit, point3(cut.positions, v)), i * 3);
  });
  const boundary = boundaryLoop(
    Array.from({ length: sheet.triangles.length / 3 }, (_, t) => [
      sheet.triangles[t * 3] as number,
      sheet.triangles[t * 3 + 1] as number,
      sheet.triangles[t * 3 + 2] as number,
    ]),
  );
  // Carried to the figure whole, by the rigid motion that best takes its edge where our
  // binding takes it. Carried vertex by vertex instead, the figure's thighs, nearer each
  // other than at rest, took the perineum's two sides past each other and twisted it.
  const m = boundary.length;
  const edgeAtRest = new Float32Array(m * 3);
  boundary.forEach((v, i) => {
    edgeAtRest.set(atRest.subarray(v * 3, v * 3 + 3), i * 3);
  });
  const edgeOnFigure = evaluateBinding(
    { ...bindToBody(edgeAtRest, body), entry: { vertexCount: m, scale: null } },
    figure,
    new Float32Array(m * 3),
  );
  const carry = fitRigid(
    boundary.map((_, i) => point3(edgeAtRest, i)),
    boundary.map((_, i) => point3(edgeOnFigure, i)),
  );
  const positions = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) positions.set(applySimilarity(carry, point3(atRest, v)), v * 3);
  return { positions, triangles: sheet.triangles, boundary };
}

/**
 * The sheet of the cut (`VULVA_SHEET`): its vertices (indices of the cut's) and its
 * triangles in its own numbering. Throws unless it is one disc.
 */
function sheetOf(
  positions: readonly number[],
  faces: readonly (readonly number[])[],
): { vertices: number[]; triangles: Uint32Array } {
  const n = positions.length / 3;
  const [z0, z1] = VULVA_SHEET.z;
  const inside = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    // `readObj` scaled the source's units by MH_UNIT.
    const x = (positions[v * 3] as number) / MH_UNIT / VULVA_SHEET.x;
    const z = ((positions[v * 3 + 2] as number) / MH_UNIT - (z0 + z1) / 2) / ((z1 - z0) / 2);
    if (x * x + z * z < 1 && (positions[v * 3 + 1] as number) / MH_UNIT > VULVA_SHEET.floor)
      inside[v] = 1;
  }
  const triangles: number[] = [];
  for (const f of faces)
    for (let i = 1; i + 1 < f.length; i++)
      triangles.push(f[0] as number, f[i] as number, f[i + 1] as number);
  const nb = neighbours(n, triangles);
  // What the sheet encloses comes with it: the outside is what reaches the cut's edge.
  const outside = new Uint8Array(n);
  const stack = boundaryLoop(faces).filter((v) => !inside[v]);
  for (const v of stack) outside[v] = 1;
  while (stack.length) {
    const v = stack.pop() as number;
    for (const w of nb[v] as number[])
      if (!inside[w] && !outside[w]) {
        outside[w] = 1;
        stack.push(w);
      }
  }
  // A triangle is the sheet's when all its corners are, and the sheet is the largest piece.
  const kept = new Uint8Array(n);
  for (let v = 0; v < n; v++) kept[v] = outside[v] ? 0 : 1;
  const piece = largest(kept, nb);
  const local: number[] = [];
  for (let t = 0; t < triangles.length; t += 3)
    if ([0, 1, 2].every((c) => piece[triangles[t + c] as number]))
      local.push(triangles[t] as number, triangles[t + 1] as number, triangles[t + 2] as number);
  const vertices = [...new Set(local)].sort((a, b) => a - b);
  const index = new Map(vertices.map((v, i) => [v, i] as const));
  const renumbered = Uint32Array.from(local, (v) => index.get(v) as number);
  const edges = new Set<string>();
  for (let t = 0; t < renumbered.length; t += 3)
    for (let c = 0; c < 3; c++) {
      const a = renumbered[t + c] as number;
      const b = renumbered[t + ((c + 1) % 3)] as number;
      edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  const chi = vertices.length - edges.size + renumbered.length / 3;
  if (chi !== 1) throw new Error(`vulva: the sheet is not one disc (Euler characteristic ${chi})`);
  return { vertices, triangles: renumbered };
}

/** A detail target: region (and ring) indices of the lattice and a displacement for each. */
export interface VulvaTarget {
  name: string;
  indices: number[];
  xyz: number[];
}

/**
 * The vulva's form as a displacement of the lattice's region, on the figure the
 * lattice was evaluated on; the reservoirs' rings take their loop vertex's, so a
 * collapsed reservoir moves with the skin it lies in.
 */
export function vulvaTarget(
  lattice: AdultDetailLattice,
  reservoirs: readonly AdultReservoirSpec[],
  sheet: SculptPart,
): VulvaTarget {
  const n = lattice.regionCount;
  const regionOf = new Map<number, number>();
  lattice.regionIds.forEach((id, i) => {
    regionOf.set(id, i);
  });
  const nb = regionNeighbours(lattice, regionOf);
  const seen = seenFrom(sheet);
  // What each vertex's sight line meets, and whether that is inside the sheet (off the
  // triangles at its edge).
  const hit = new Float64Array(n * 3);
  const met = new Uint8Array(n);
  const inside = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    const h = seen(point3(lattice.positions, v), point3(lattice.normals, v));
    if (!h) continue;
    hit.set(h.point, v * 3);
    met[v] = 1;
    if (h.inside) inside[v] = 1;
  }
  // The reach: the largest piece of vertices whose lines meet the sheet inside its edge,
  // with whatever it encloses (a line that grazed a fold and missed) taken in.
  const zone = enclosed(largest(inside, nb), nb);
  const near = nearestOn(sheet);
  const raw = new Float64Array(n * 3);
  const rim = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    if (!zone[v]) continue;
    const p = point3(lattice.positions, v);
    const q = met[v] ? point3(hit, v) : near(p);
    for (let k = 0; k < 3; k++) raw[v * 3 + k] = (q[k] as number) - (p[k] as number);
    // No deeper than `DEPTH` under the skin, along its normal.
    const nv = point3(lattice.normals, v);
    const under = -[0, 1, 2].reduce(
      (s, k) => s + (raw[v * 3 + k] as number) * nv[k as 0 | 1 | 2],
      0,
    );
    if (under > DEPTH)
      for (let k = 0; k < 3; k++)
        raw[v * 3 + k] = (raw[v * 3 + k] as number) + (under - DEPTH) * nv[k as 0 | 1 | 2];
    if ((nb[v] as number[]).some((w) => !zone[w])) rim[v] = 1;
  }
  // The bodies' difference at the rim, carried inward harmonically, is not the vulva's.
  const body = harmonic(nb, zone, rim, raw);
  const ring = ringsFrom(zone, rim, nb);
  const out = new Map<number, Vec3>();
  for (let v = 0; v < n; v++) {
    if (!zone[v] || rim[v]) continue;
    const t = Math.min(1, (ring[v] as number) / FADE_RINGS);
    const fade = t * t * (3 - 2 * t);
    const d: Vec3 = [
      fade * ((raw[v * 3] as number) - (body[v * 3] as number)),
      fade * ((raw[v * 3 + 1] as number) - (body[v * 3 + 1] as number)),
      fade * ((raw[v * 3 + 2] as number) - (body[v * 3 + 2] as number)),
    ];
    if (Math.hypot(d[0], d[1], d[2]) > 1e-6) out.set(v, d);
  }
  // A ring vertex lies on its loop vertex at rest and takes its displacement.
  for (const r of lattice.reservoirs) {
    const loop = reservoirs.find((s) => s.id === r.id)?.loop;
    if (!loop) throw new Error(`vulva: the pack has no reservoir ${r.id}`);
    for (let j = 0; j < r.rings; j++)
      loop.forEach((id, i) => {
        const d = out.get(regionOf.get(id) as number);
        if (d) out.set(r.base + j * r.loop + i, d);
      });
  }
  const indices = [...out.keys()].sort((a, b) => a - b);
  return {
    name: VULVA_TARGET,
    indices,
    xyz: indices.flatMap((i) => out.get(i) as unknown as number[]),
  };
}

/** A part's triangles in a bounding-volume hierarchy. */
function bvhOf(part: SculptPart): MeshBVH {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(Float32Array.from(part.positions), 3));
  geometry.setIndex(new BufferAttribute(part.triangles, 1));
  return new MeshBVH(geometry, { verbose: false });
}

/** The nearest point of a part's surface to a point. */
function nearestOn(part: SculptPart): (p: Vec3) => Vec3 {
  const bvh = bvhOf(part);
  const target = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const at = new Vector3();
  return (p) => {
    at.set(p[0], p[1], p[2]);
    const hit = bvh.closestPointToPoint(at, target);
    if (!hit) throw new Error("vulva: the sheet has no triangles");
    return [hit.point.x, hit.point.y, hit.point.z];
  };
}

/**
 * The point of a part's surface seen from outside along a vertex's normal: the first
 * the line from `SIGHT` outside the vertex inward meets, no further than `SIGHT` past
 * it; and whether that is inside the part, on a triangle with no corner on its edge.
 */
function seenFrom(part: SculptPart): (p: Vec3, n: Vec3) => { point: Vec3; inside: boolean } | null {
  const bvh = bvhOf(part);
  const onEdge = new Set(part.boundary);
  const T = part.triangles;
  const ray = new Ray();
  return (p, n) => {
    ray.origin.set(p[0] + n[0] * SIGHT, p[1] + n[1] * SIGHT, p[2] + n[2] * SIGHT);
    ray.direction.set(-n[0], -n[1], -n[2]);
    const hit = bvh.raycastFirst(ray, DoubleSide, 0, 2 * SIGHT);
    if (!hit || hit.faceIndex == null) return null;
    const face = hit.faceIndex;
    return {
      point: [hit.point.x, hit.point.y, hit.point.z],
      inside: [0, 1, 2].every((c) => !onEdge.has(T[face * 3 + c] as number)),
    };
  };
}

/** Each region vertex's neighbours along the lattice's polygons' edges, by region index. */
function regionNeighbours(
  lattice: AdultDetailLattice,
  regionOf: ReadonlyMap<number, number>,
): number[][] {
  const sets = Array.from({ length: lattice.regionCount }, () => new Set<number>());
  const { start, vertices } = lattice.polygons;
  for (let p = 0; p + 1 < start.length; p++) {
    const s = start[p] as number;
    const e = start[p + 1] as number;
    for (let c = s; c < e; c++) {
      const a = regionOf.get(vertices[c] as number);
      const b = regionOf.get(vertices[c + 1 < e ? c + 1 : s] as number);
      if (a === undefined || b === undefined) continue;
      (sets[a] as Set<number>).add(b);
      (sets[b] as Set<number>).add(a);
    }
  }
  return sets.map((s) => [...s]);
}

/** Each vertex's neighbours along the triangles' edges. */
function neighbours(count: number, triangles: ArrayLike<number>): number[][] {
  const sets = Array.from({ length: count }, () => new Set<number>());
  for (let t = 0; t < triangles.length; t += 3)
    for (let c = 0; c < 3; c++) {
      const a = triangles[t + c] as number;
      const b = triangles[t + ((c + 1) % 3)] as number;
      (sets[a] as Set<number>).add(b);
      (sets[b] as Set<number>).add(a);
    }
  return sets.map((s) => [...s]);
}

/** The connected pieces of the marked vertices, largest first. */
function pieces(marked: Uint8Array, nb: readonly number[][]): number[][] {
  const seen = new Uint8Array(marked.length);
  const out: number[][] = [];
  for (let s = 0; s < marked.length; s++) {
    if (!marked[s] || seen[s]) continue;
    const piece: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const v = stack.pop() as number;
      piece.push(v);
      for (const w of nb[v] as number[])
        if (marked[w] && !seen[w]) {
          seen[w] = 1;
          stack.push(w);
        }
    }
    out.push(piece);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** The largest connected piece of the marked vertices, one byte each. */
function largest(marked: Uint8Array, nb: readonly number[][]): Uint8Array {
  const out = new Uint8Array(marked.length);
  for (const v of pieces(marked, nb)[0] ?? []) out[v] = 1;
  return out;
}

/** The marked vertices with every piece of the rest they enclose (all but the largest) taken in. */
function enclosed(marked: Uint8Array, nb: readonly number[][]): Uint8Array {
  const out = Uint8Array.from(marked);
  const rest = Uint8Array.from(marked, (m) => (m ? 0 : 1));
  for (const hole of pieces(rest, nb).slice(1)) for (const v of hole) out[v] = 1;
  return out;
}

/** Rings of neighbours from the rim into the zone: 0 on the rim. */
function ringsFrom(zone: Uint8Array, rim: Uint8Array, nb: readonly number[][]): Int32Array {
  const rings = new Int32Array(zone.length).fill(-1);
  let front: number[] = [];
  for (let v = 0; v < zone.length; v++)
    if (rim[v]) {
      rings[v] = 0;
      front.push(v);
    }
  for (let r = 1; front.length; r++) {
    const next: number[] = [];
    for (const v of front)
      for (const w of nb[v] as number[])
        if (zone[w] && rings[w] === -1) {
          rings[w] = r;
          next.push(w);
        }
    front = next;
  }
  return rings;
}

/**
 * The harmonic field over the zone (each vertex inside it the mean of its neighbours)
 * equal to `values` on the `fixed` ones, three coordinates per vertex: conjugate
 * gradients on the graph Laplacian, which is symmetric and positive definite with
 * those held. A vertex inside the zone has every neighbour in it. Throws unless it
 * converges.
 */
function harmonic(
  nb: readonly number[][],
  zone: Uint8Array,
  fixed: Uint8Array,
  values: Float64Array,
): Float64Array {
  const inner: number[] = [];
  for (let v = 0; v < nb.length; v++) if (zone[v] && !fixed[v]) inner.push(v);
  const row = new Map(inner.map((v, i) => [v, i] as const));
  const m = inner.length;
  const out = Float64Array.from(values);
  const multiply = (x: Float64Array, y: Float64Array) => {
    for (let i = 0; i < m; i++) {
      const list = nb[inner[i] as number] as number[];
      let s = list.length * (x[i] as number);
      for (const w of list) {
        const j = row.get(w);
        if (j !== undefined) s -= x[j] as number;
      }
      y[i] = s;
    }
  };
  for (let k = 0; k < 3; k++) {
    const b = new Float64Array(m);
    inner.forEach((v, i) => {
      for (const w of nb[v] as number[])
        if (fixed[w]) b[i] = (b[i] as number) + (values[w * 3 + k] as number);
    });
    const x = new Float64Array(m);
    const r = Float64Array.from(b);
    const d = Float64Array.from(r);
    const q = new Float64Array(m);
    const bb = b.reduce((s, a) => s + a * a, 0);
    let rr = bb;
    for (let it = 0; it < 10 * m + 100 && rr > 1e-24 * bb; it++) {
      multiply(d, q);
      let dq = 0;
      for (let i = 0; i < m; i++) dq += (d[i] as number) * (q[i] as number);
      const a = rr / dq;
      for (let i = 0; i < m; i++) {
        x[i] = (x[i] as number) + a * (d[i] as number);
        r[i] = (r[i] as number) - a * (q[i] as number);
      }
      const next = r.reduce((s, c) => s + c * c, 0);
      const beta = next / rr;
      rr = next;
      for (let i = 0; i < m; i++) d[i] = (r[i] as number) + beta * (d[i] as number);
    }
    if (bb > 0 && rr > 1e-24 * bb) throw new Error("vulva: the harmonic field did not converge");
    inner.forEach((v, i) => {
      out[v * 3 + k] = x[i] as number;
    });
  }
  return out;
}
