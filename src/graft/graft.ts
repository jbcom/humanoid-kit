/**
 * Building and evaluating a graft (docs/GRAFT.md): the body's surface with the
 * cut's triangles left out, a band of rings from the cut's loop to the part's
 * rim, and the part, rigid but for a falloff band at its rim, refit to the
 * loop on every evaluation.
 *
 * Core code: arrays in, arrays out, no rendering.
 */
import { SKIN_INFLUENCES } from "../format/assetFormat.ts";
import { addInfluences, writeStrongest } from "../rig/influences.ts";
import { rotate, type Similarity, similarityFit } from "./fit.ts";
import {
  arcParams,
  atParam,
  boundaryEdges,
  centroid,
  fairLoop,
  loopLength,
  loopPoints,
  newellNormal,
  orderLoops,
  weldByPosition,
} from "./loops.ts";
import {
  GraftError,
  type GraftOptions,
  type GraftPart,
  type GraftSurface,
  type GraftTopology,
  type Vec3,
} from "./types.ts";

/** The body surface a graft is cut into: one of the model's built surfaces, at rest. */
export interface GraftBody {
  /** Triangles over render vertices, written face by face (`SurfaceMesh.index`), every face included. */
  index: Uint32Array;
  /** Triangles per face (2 × 4^level), or each face's first triangle (`SurfaceMesh.faceTriangles`). */
  trianglesPerFace: number | Uint32Array;
  /** Per face, 1 when it shows (the mounted attachments' mask); all shown when absent. */
  visible?: Uint8Array;
  /** Render vertex → surface vertex: render vertices at one surface vertex are welded. */
  renderToSurface: Uint32Array;
  /** uv per render vertex. */
  uvs: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** Render positions and normals of the body at rest, to orient and parameterise the loop. */
  restPositions: Float32Array;
  restNormals: Float32Array;
}

/** A resolved cut: which faces go, the bone the part follows, and the body's front. */
export interface GraftCutInput {
  /** Per face of the surface (in its face order), 1 when the cut removes it. */
  removed: Uint8Array;
  /** The root bone's index in the skeleton. */
  rootBone: number;
  rootBoneName: string;
  forward: Vec3;
  /** Reported in the topology: what the cut removes besides faces. */
  removedFaces: Uint32Array;
  droppedAttachments: string[];
  removedBones: string[];
  /** The removed bones' indices: inside the part, their weight counts as the root bone's. */
  removedBoneIndices: readonly number[];
}

const DEFAULTS = { samples: 64, rings: 8, gap: 0.3, band: 1.5, maxTurn: 40 } as const;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const at3 = (p: ArrayLike<number>, i: number): Vec3 => [
  p[i * 3] as number,
  p[i * 3 + 1] as number,
  p[i * 3 + 2] as number,
];
/** `acc += v * s`, in place. */
const addTo = (acc: Vec3, v: Vec3, s = 1): void => {
  acc[0] += v[0] * s;
  acc[1] += v[1] * s;
  acc[2] += v[2] * s;
};
const smoothstep = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** RMS distance of points from their centroid. */
function rmsRadius(points: ArrayLike<number>): number {
  const c = centroid(points);
  const n = points.length / 3;
  let s = 0;
  for (let i = 0; i < n; i++) s += dot(sub(at3(points, i), c), sub(at3(points, i), c));
  return Math.sqrt(s / n);
}

/**
 * Per sample of a closed ring, the unit direction along the surface across
 * the ring (the surface normal crossed with the ring's tangent), turned to
 * point along `axis`.
 */
function onwardRing(ring: ArrayLike<number>, normals: ArrayLike<number>, axis: Vec3): Float64Array {
  const n = ring.length / 3;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const tan = sub(at3(ring, (i + 1) % n), at3(ring, (i + n - 1) % n));
    let g = unit(cross(unit(at3(normals, i)), tan));
    if (dot(g, axis) < 0) g = g.map((v) => -v) as Vec3;
    out.set(g, i * 3);
  }
  return out;
}

/** How far past each ring `continuationFit` also matches, in units of the ring's RMS radius. */
const CONTINUATION = 0.3;

/**
 * The similarity carrying the part's rim samples `x` onto the body's loop
 * samples `a` (docs/GRAFT.md, "The fit"), matching each ring's continuation
 * as well as the ring: the points a little way on from the rim into the part
 * (`xOnward`) go to the points as far on from the loop out of the body
 * (`aOnward`). A ring alone fixes the part's tilt only to its own plane, so a
 * neck that leans more than the body's would leave the band a knee; with the
 * continuation the part carries on in the body's direction.
 */
function continuationFit(
  x: ArrayLike<number>,
  xOnward: ArrayLike<number>,
  a: ArrayLike<number>,
  aOnward: ArrayLike<number>,
): Similarity {
  const n = x.length / 3;
  const rx = CONTINUATION * rmsRadius(x);
  const ra = CONTINUATION * rmsRadius(a);
  const from = new Float64Array(n * 6);
  const to = new Float64Array(n * 6);
  from.set(x);
  to.set(a);
  for (let i = 0; i < n; i++) {
    const p = at3(x, i);
    addTo(p, at3(xOnward, i), rx);
    from.set(p, (n + i) * 3);
    const q = at3(a, i);
    addTo(q, at3(aOnward, i), ra);
    to.set(q, (n + i) * 3);
  }
  return similarityFit(from, to);
}

/** Rotates a loop (an array of ids) so it starts at the entry maximising `score`. */
function startAt<T>(loop: T[], score: (x: T) => number): T[] {
  let best = 0;
  for (let i = 1; i < loop.length; i++) if (score(loop[i] as T) > score(loop[best] as T)) best = i;
  return [...loop.slice(best), ...loop.slice(0, best)];
}

/**
 * Triangles zipping two closed rings, `a` (lower) and `b` (upper), each given
 * as vertex ids with ascending parameters in [0, 1): by merging the two
 * parameter sequences, so each triangle advances along one ring. Wound so the
 * band faces outward when both rings wind counter-clockwise about the axis
 * from `a` to `b`.
 */
function zip(
  a: readonly number[],
  pa: ArrayLike<number>,
  b: readonly number[],
  pb: ArrayLike<number>,
  out: number[],
): void {
  let i = 0;
  let j = 0;
  const na = a.length;
  const nb = b.length;
  while (i < na || j < nb) {
    const nextA = i < na ? (i + 1 < na ? (pa[i + 1] as number) : 1) : Number.POSITIVE_INFINITY;
    const nextB = j < nb ? (j + 1 < nb ? (pb[j + 1] as number) : 1) : Number.POSITIVE_INFINITY;
    const ai = a[i % na] as number;
    const bj = b[j % nb] as number;
    if (nextA <= nextB) {
      out.push(ai, a[(i + 1) % na] as number, bj);
      i++;
    } else {
      out.push(ai, b[(j + 1) % nb] as number, bj);
      j++;
    }
  }
}

/** Area-weighted vertex normals of triangles, accumulated into `out` (not normalised). */
function addTriangleNormals(
  index: ArrayLike<number>,
  positions: ArrayLike<number>,
  weld: ArrayLike<number>,
  out: Float64Array,
): void {
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] as number;
    const b = index[t + 1] as number;
    const c = index[t + 2] as number;
    const n = cross(
      sub(at3(positions, b), at3(positions, a)),
      sub(at3(positions, c), at3(positions, a)),
    );
    for (const v of [a, b, c]) {
      const w = weld[v] as number;
      out[w * 3] = (out[w * 3] as number) + n[0];
      out[w * 3 + 1] = (out[w * 3 + 1] as number) + n[1];
      out[w * 3 + 2] = (out[w * 3 + 2] as number) + n[2];
    }
  }
}

/** Merges two vertices' skins (one vertex's places each), `a` weighted 1 - t and `b` weighted t, into vertex `o` of the out arrays. */
function blendSkin(
  ai: ArrayLike<number>,
  aw: ArrayLike<number>,
  bi: ArrayLike<number>,
  bw: ArrayLike<number>,
  t: number,
  outI: Uint16Array,
  outW: Float32Array,
  o: number,
): void {
  const m = new Map<number, number>();
  addInfluences(m, ai, aw, 0, 1 - t);
  addInfluences(m, bi, bw, 0, t);
  writeStrongest(m, outI, outW, o * SKIN_INFLUENCES);
}

/** Rounds of `smoothPartSkin`: enough to settle a jump between two neighbours, too few to blur the skin. */
const SKIN_SMOOTHING = 3;

/**
 * Evens out the part's inherited skin over its own surface: each vertex takes
 * the mean of itself and its neighbours, a few rounds, its rim held. A part
 * vertex whose nearest body was across a fold (the jaw over the throat) no
 * longer differs sharply from its neighbours, which in a pose would tear.
 */
function smoothPartSkin(
  triangles: Uint32Array,
  weld: Uint32Array,
  rim: Set<number>,
  partStart: number,
  skinIndex: Uint16Array,
  skinWeight: Float32Array,
): void {
  const adj = new Map<number, Set<number>>();
  for (let t = 0; t < triangles.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = weld[triangles[t + k] as number] as number;
      const b = weld[triangles[t + ((k + 1) % 3)] as number] as number;
      if (a === b) continue;
      (adj.get(a) ?? adj.set(a, new Set()).get(a))?.add(b);
      (adj.get(b) ?? adj.set(b, new Set()).get(b))?.add(a);
    }
  const I = SKIN_INFLUENCES;
  const skinOf = (v: number) => {
    const m = new Map<number, number>();
    addInfluences(m, skinIndex, skinWeight, partStart + v);
    return m;
  };
  const welded = [...adj.keys()];
  for (let round = 0; round < SKIN_SMOOTHING; round++) {
    const next = new Map<number, Map<number, number>>();
    for (const v of welded) {
      if (rim.has(v)) continue;
      const m = skinOf(v);
      const ns = adj.get(v) as Set<number>;
      for (const u of ns) for (const [b, w] of skinOf(u)) m.set(b, (m.get(b) ?? 0) + w);
      next.set(v, m);
    }
    for (const [v, m] of next) writeStrongest(m, skinIndex, skinWeight, (partStart + v) * I);
  }
  // A vertex a UV seam split takes its welded twin's skin.
  for (let v = 0; v < weld.length; v++) {
    const w = weld[v] as number;
    if (w === v) continue;
    skinIndex.set(
      skinIndex.subarray((partStart + w) * I, (partStart + w) * I + I),
      (partStart + v) * I,
    );
    skinWeight.set(
      skinWeight.subarray((partStart + w) * I, (partStart + w) * I + I),
      (partStart + v) * I,
    );
  }
}

/**
 * The skin of the body the cut removes, at any point near it at rest: the
 * weights of the four removed render vertices nearest, by inverse squared
 * distance, with the removed bones' weight given to the root bone (they are
 * not the part's, and what was theirs moves with the part).
 */
function removedSkin(
  body: GraftBody,
  cut: GraftCutInput,
  start: (f: number) => number,
): (p: Vec3, normal: Vec3, outI: Uint16Array, outW: Float32Array) => void {
  const inside = new Set(cut.removedBoneIndices);
  const verts: number[] = [];
  const seen = new Set<number>();
  for (let f = 0; f < cut.removed.length; f++) {
    if (cut.removed[f] !== 1) continue;
    for (let t = start(f) * 3; t < start(f + 1) * 3; t++) {
      const v = body.index[t] as number;
      if (!seen.has(v)) {
        seen.add(v);
        verts.push(v);
      }
    }
  }
  if (verts.length === 0) throw new GraftError("the cut removes no render vertex");
  // A uniform grid over the removed vertices, a cell a fiftieth of their extent.
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts)
    for (let k = 0; k < 3; k++) {
      const x = body.restPositions[v * 3 + k] as number;
      lo[k] = Math.min(lo[k] as number, x);
      hi[k] = Math.max(hi[k] as number, x);
    }
  const cell = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-9) / 50;
  const cellOf = (p: Vec3) => p.map((x, k) => Math.floor((x - (lo[k] as number)) / cell)) as Vec3;
  const grid = new Map<string, number[]>();
  for (const v of verts) {
    const c = cellOf(at3(body.restPositions, v));
    const id = c.join(",");
    (grid.get(id) ?? grid.set(id, []).get(id))?.push(v);
  }
  return (p, normal, outI, outW) => {
    const c = cellOf(p);
    let near: [number, number][] = [];
    // Widen the search shell by shell until four are found and the nearest
    // cells outside it cannot hold a closer one.
    for (let r = 0; ; r++) {
      for (let x = c[0] - r; x <= c[0] + r; x++)
        for (let y = c[1] - r; y <= c[1] + r; y++)
          for (let z = c[2] - r; z <= c[2] + r; z++) {
            if (Math.max(Math.abs(x - c[0]), Math.abs(y - c[1]), Math.abs(z - c[2])) !== r)
              continue;
            for (const v of grid.get(`${x},${y},${z}`) ?? []) {
              // Facing the other way, it is another surface (the jaw's
              // underside above the throat): its skin is not this point's.
              if (dot(unit(at3(body.restNormals, v)), normal) < 0.3) continue;
              const d = sub(at3(body.restPositions, v), p);
              near.push([dot(d, d), v]);
            }
          }
      near.sort((a, b) => a[0] - b[0]);
      near = near.slice(0, 4);
      if (near.length === 4 && Math.sqrt((near[3] as [number, number])[0]) <= r * cell) break;
      if (r > 60) break;
    }
    const m = new Map<number, number>();
    for (const [d2, v] of near) {
      const w = 1 / (d2 + 1e-12);
      for (let q = 0; q < SKIN_INFLUENCES; q++) {
        let b = body.skinIndex[v * SKIN_INFLUENCES + q] as number;
        const bw = (body.skinWeight[v * SKIN_INFLUENCES + q] as number) * w;
        if (bw <= 0) continue;
        if (inside.has(b)) b = cut.rootBone;
        m.set(b, (m.get(b) ?? 0) + bw);
      }
    }
    if (writeStrongest(m, outI, outW, 0, cut.rootBone) === 0) outW[0] = 1;
  };
}

/** The body side: the cut's loop on the surface, ordered, oriented and parameterised at rest. */
function bodyLoop(body: GraftBody, cut: GraftCutInput) {
  const tri = body.trianglesPerFace;
  const faceCount = cut.removed.length;
  const start = (f: number) => (typeof tri === "number" ? f * tri : (tri[f] as number));
  const r2s = body.renderToSurface;
  // Directed surface edges of kept triangles, and the undirected edges of removed ones.
  const kept = new Map<number, { from: number; to: number; render: number; count: number }>();
  const removedEdges = new Set<number>();
  const key = (a: number, b: number) => (a < b ? a * 0x100000000 + b : b * 0x100000000 + a);
  for (let f = 0; f < faceCount; f++) {
    const gone = cut.removed[f] === 1;
    for (let t = start(f); t < start(f + 1); t++)
      for (let k = 0; k < 3; k++) {
        const ra = body.index[t * 3 + k] as number;
        const a = r2s[ra] as number;
        const b = r2s[body.index[t * 3 + ((k + 1) % 3)] as number] as number;
        const e = key(a, b);
        if (gone) removedEdges.add(e);
        else {
          const u = kept.get(e);
          if (u) u.count++;
          else kept.set(e, { from: a, to: b, render: ra, count: 1 });
        }
      }
  }
  const cutEdges: [number, number][] = [];
  const renderOf = new Map<number, number>();
  for (const [e, u] of kept)
    if (u.count === 1 && removedEdges.has(e)) {
      // The loop runs against the kept triangles' winding, as the band's zipper needs.
      cutEdges.push([u.to, u.from]);
      if (!renderOf.has(u.from)) renderOf.set(u.from, u.render);
    }
  const loops = orderLoops(cutEdges);
  if (loops.length !== 1)
    throw new GraftError(`the cut is bounded by ${loops.length} loops on the surface, not one`);
  let loop = loops[0] as number[];
  // orderLoops picks a direction; follow the directed edges instead.
  const next = new Map(cutEdges);
  if (next.get(loop[0] as number) !== loop[1])
    loop = [loop[0] as number, ...loop.slice(1).reverse()];
  const renderLoop = loop.map((s) => {
    const r = renderOf.get(s);
    if (r === undefined)
      throw new GraftError(`surface vertex ${s} on the cut has no render vertex`);
    return r;
  });
  const pts = loopPoints(renderLoop, body.restPositions);
  const c = centroid(pts);
  // The removed side, from the removed triangles' vertices.
  const away: Vec3 = [0, 0, 0];
  let count = 0;
  for (let f = 0; f < faceCount; f++)
    if (cut.removed[f] === 1)
      for (let t = start(f); t < start(f + 1); t++) {
        addTo(away, at3(body.restPositions, body.index[t * 3] as number));
        count++;
      }
  const axis = unit(sub(away.map((x) => x / count) as Vec3, c));
  if (dot(newellNormal(pts), axis) <= 0)
    throw new GraftError("the body's kept triangles do not face outward round the cut");
  const fwd = unit(sub(cut.forward, axis.map((x) => x * dot(cut.forward, axis)) as Vec3));
  const ordered = startAt(renderLoop, (r) => dot(sub(at3(body.restPositions, r), c), fwd));
  return { loop: ordered, params: arcParams(loopPoints(ordered, body.restPositions)) };
}

/** The part side: welded, trimmed to its seam, with its rim ordered, oriented and parameterised. */
function partRim(part: GraftPart) {
  const positions = Float64Array.from(part.positions);
  const n = positions.length / 3;
  let triangles = Uint32Array.from(part.triangles);
  const weld = weldByPosition(positions);
  const seam = part.seam;
  // The index, in the part as supplied, of each triangle kept.
  let source = Array.from({ length: triangles.length / 3 }, (_, t) => t);
  if (seam && "plane" in seam) {
    const nrm = unit(seam.plane.normal);
    const keep: number[] = [];
    for (let t = 0; t < triangles.length; t += 3) {
      const c: Vec3 = [0, 0, 0];
      for (let k = 0; k < 3; k++) addTo(c, at3(positions, triangles[t + k] as number), 1 / 3);
      if (dot(sub(c, seam.plane.point), nrm) <= 0) keep.push(t);
    }
    const trimmed = new Uint32Array(keep.length * 3);
    for (const [i, t] of keep.entries()) trimmed.set(triangles.subarray(t, t + 3), i * 3);
    triangles = trimmed;
    source = keep.map((t) => t / 3);
  }
  const directed = boundaryEdges(triangles, weld);
  if (directed.length === 0) throw new GraftError("the part has no open boundary to graft at");
  const loops = orderLoops(directed);
  let rim: number[];
  if (seam && "loop" in seam) {
    const want = new Set(seam.loop.map((v) => weld[v] as number));
    const found = loops.find((l) => l.length === want.size && l.every((v) => want.has(v)));
    if (!found) throw new GraftError("the supplied seam is not one of the part's boundary loops");
    rim = found;
  } else {
    rim = loops.reduce((a, b) => (loopLength(b, positions) > loopLength(a, positions) ? b : a));
  }
  // Follow the part's own boundary winding: the band's zipper runs against it.
  const next = new Map(directed);
  if (next.get(rim[0] as number) !== rim[1]) rim = [rim[0] as number, ...rim.slice(1).reverse()];
  const used = new Set<number>();
  for (const v of triangles) used.add(weld[v] as number);
  const pc: Vec3 = [0, 0, 0];
  for (const v of used) addTo(pc, at3(positions, v), 1 / used.size);
  const pts = loopPoints(rim, positions);
  const rc = centroid(pts);
  const axis = unit(sub(pc, rc));
  if (dot(newellNormal(pts), axis) <= 0)
    throw new GraftError("the part's triangles do not face outward round its seam");
  const forward = part.forward ?? [0, 0, 1];
  const fwd = unit(sub(forward, axis.map((x) => x * dot(forward, axis)) as Vec3));
  rim = startAt(rim, (v) => dot(sub(at3(positions, v), rc), fwd));
  return {
    positions,
    triangles,
    source,
    weld,
    rim,
    params: arcParams(loopPoints(rim, positions)),
    axis,
    rimCentre: rc,
    n,
  };
}

/** Distance along the part's edges from its rim (at rest), and each vertex's rim parameter by angle round the rim's axis. */
function rimField(
  positions: Float64Array,
  triangles: Uint32Array,
  weld: Uint32Array,
  rim: readonly number[],
  params: ArrayLike<number>,
  centre: Vec3,
  axis: Vec3,
) {
  const n = positions.length / 3;
  const adj = new Map<number, Map<number, number>>();
  const link = (a: number, b: number) => {
    const d = Math.hypot(...sub(at3(positions, a), at3(positions, b)));
    (adj.get(a) ?? adj.set(a, new Map()).get(a))?.set(b, d);
  };
  for (let t = 0; t < triangles.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = weld[triangles[t + k] as number] as number;
      const b = weld[triangles[t + ((k + 1) % 3)] as number] as number;
      if (a !== b) {
        link(a, b);
        link(b, a);
      }
    }
  const distance = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  // Dijkstra with a binary heap of [distance, vertex].
  const heap: [number, number][] = [];
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] as [number, number])[0] <= e[0]) break;
      heap[i] = heap[p] as [number, number];
      i = p;
    }
    heap[i] = e;
  };
  const pop = (): [number, number] => {
    const top = heap[0] as [number, number];
    const last = heap.pop() as [number, number];
    if (heap.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= heap.length) break;
        const r = l + 1;
        const c =
          r < heap.length && (heap[r] as [number, number])[0] < (heap[l] as [number, number])[0]
            ? r
            : l;
        if ((heap[c] as [number, number])[0] >= last[0]) break;
        heap[i] = heap[c] as [number, number];
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  for (const v of rim) {
    distance[v] = 0;
    push([0, v]);
  }
  while (heap.length) {
    const [d, v] = pop();
    if (d > (distance[v] as number)) continue;
    for (const [w, l] of adj.get(v) ?? []) {
      const nd = d + l;
      if (nd < (distance[w] as number)) {
        distance[w] = nd;
        push([nd, w]);
      }
    }
  }
  // Angle round the axis from the rim's first vertex, counter-clockwise, in [0, 2π).
  const e1 = unit(
    sub(
      sub(at3(positions, rim[0] as number), centre),
      axis.map((x) => x * dot(sub(at3(positions, rim[0] as number), centre), axis)) as Vec3,
    ),
  );
  const e2 = cross(axis, e1);
  const angle = (v: number) => {
    const d = sub(at3(positions, v), centre);
    const a = Math.atan2(dot(d, e2), dot(d, e1));
    return a < 0 ? a + 2 * Math.PI : a;
  };
  const marks = rim
    .map((v, i) => [angle(v), params[i] as number] as const)
    .sort((x, y) => x[0] - y[0]);
  const paramOf = (v: number): number => {
    const a = angle(v);
    const m = marks.length;
    let j = m - 1;
    for (let i = 0; i < m; i++)
      if ((marks[i] as readonly [number, number])[0] > a) {
        j = i - 1;
        break;
      }
    const lo = marks[(j + m) % m] as readonly [number, number];
    const hi = marks[(j + 1) % m] as readonly [number, number];
    const a0 = j < 0 ? lo[0] - 2 * Math.PI : lo[0];
    const a1 = j + 1 >= m ? hi[0] + 2 * Math.PI : hi[0];
    let t0 = lo[1];
    let t1 = hi[1];
    if (t1 < t0) t1 += 1;
    if (j < 0 && t0 > t1) t0 -= 1;
    const f = a1 > a0 ? (a - a0) / (a1 - a0) : 0;
    const t = t0 + (t1 - t0) * f;
    return t - Math.floor(t);
  };
  const param = new Float64Array(n);
  for (let v = 0; v < n; v++) if (Number.isFinite(distance[v] as number)) param[v] = paramOf(v);
  return { distance, param };
}

/** A built graft: its static topology, and its refit on an evaluation of the body. */
export interface Graft {
  topology: GraftTopology;
  /** The merged surface on an evaluation: the body's render `positions` and `normals` as evaluated. */
  evaluate(positions: ArrayLike<number>, normals: ArrayLike<number>): GraftSurface;
}

/** Builds a graft of `part` into `body`, cut by `cut` (docs/GRAFT.md). */
export function buildGraft(
  body: GraftBody,
  cut: GraftCutInput,
  part: GraftPart,
  options: GraftOptions = {},
): Graft {
  const samples = options.samples ?? DEFAULTS.samples;
  const R = options.rings ?? DEFAULTS.rings;
  const gap = options.gap ?? DEFAULTS.gap;
  const bandFraction = options.band ?? DEFAULTS.band;
  const turnLimit = ((options.maxTurn ?? DEFAULTS.maxTurn) * Math.PI) / 180;
  if (!Number.isInteger(samples) || samples < 8)
    throw new GraftError("samples must be an integer of at least 8");
  if (!Number.isInteger(R) || R < 2) throw new GraftError("rings must be an integer of at least 2");
  if (!(gap > 0) || !Number.isFinite(gap)) throw new GraftError("gap must be a positive number");
  if (!(bandFraction >= 0) || !Number.isFinite(bandFraction))
    throw new GraftError("band must be a non-negative number");
  if (!(turnLimit > 0) || !Number.isFinite(turnLimit))
    throw new GraftError("maxTurn must be a positive number");
  const B = bodyLoop(body, cut);
  const P = partRim(part);
  // The band's rings: a sample on every loop vertex, so the band meets the body
  // quad for quad, and `m` evenly between each two, so a ring has at least `samples`.
  const L0 = B.loop.length;
  const m = Math.ceil(samples / L0);
  const N = L0 * m;
  const ringParams = new Float64Array(N);
  for (let j = 0; j < L0; j++) {
    const ta = B.params[j] as number;
    const tb = j + 1 === L0 ? 1 : (B.params[j + 1] as number);
    for (let s = 0; s < m; s++) ringParams[j * m + s] = ta + ((tb - ta) * s) / m;
  }
  const bodyCount = body.renderToSurface.length;
  const bridgeStart = bodyCount;
  const partStart = bridgeStart + (R - 1) * N;
  const vertexCount = partStart + P.n;

  // The extra scale, about the rim's centre in the part's frame.
  const extra: Vec3 =
    options.scale === undefined
      ? [1, 1, 1]
      : typeof options.scale === "number"
        ? [options.scale, options.scale, options.scale]
        : options.scale;
  if (!extra.every((s) => s > 0 && Number.isFinite(s)))
    throw new GraftError("scale must be positive and finite on every axis");
  const restPart = new Float64Array(P.positions.length);
  for (let v = 0; v < P.n; v++) {
    const d = sub(at3(P.positions, v), P.rimCentre);
    restPart.set(
      [
        P.rimCentre[0] + d[0] * extra[0],
        P.rimCentre[1] + d[1] * extra[1],
        P.rimCentre[2] + d[2] * extra[2],
      ],
      v * 3,
    );
  }
  const rimPts = loopPoints(P.rim, restPart);
  // Arc parameters of the scaled rim: a non-uniform scale moves them.
  const rimParams = arcParams(rimPts);
  const rimRadius = rmsRadius(rimPts);
  const field = rimField(restPart, P.triangles, P.weld, P.rim, rimParams, centroid(rimPts), P.axis);
  const bandReach = bandFraction * rimRadius;
  // The part's rest normals, welded, for its surface's continuation at the rim.
  const partNormalsRest = new Float64Array(P.n * 3);
  addTriangleNormals(P.triangles, restPart, P.weld, partNormalsRest);
  for (let v = 0; v < P.n; v++) {
    const w = P.weld[v] as number;
    partNormalsRest.set(unit(at3(partNormalsRest, w)), v * 3);
  }
  const rimNormals = loopPoints(P.rim, partNormalsRest);

  // Topology: the body's kept, shown triangles; the band; the part.
  const tri = body.trianglesPerFace;
  const start = (f: number) => (typeof tri === "number" ? f * tri : (tri[f] as number));
  const index: number[] = [];
  for (let f = 0; f < cut.removed.length; f++) {
    if (cut.removed[f] === 1 || (body.visible && body.visible[f] === 0)) continue;
    for (let t = start(f) * 3; t < start(f + 1) * 3; t++) index.push(body.index[t] as number);
  }
  const bodyTriangles = index.length / 3;
  const ring = (k: number) => Array.from({ length: N }, (_, i) => bridgeStart + (k - 1) * N + i);
  zip(B.loop, B.params, ring(1), ringParams, index);
  for (let k = 1; k + 1 < R; k++) zip(ring(k), ringParams, ring(k + 1), ringParams, index);
  const rimMerged = P.rim.map((v) => partStart + v);
  zip(ring(R - 1), ringParams, rimMerged, rimParams, index);
  const bridgeTriangles = index.length / 3 - bodyTriangles;
  const groups = [
    { name: "body", start: 0, count: bodyTriangles },
    { name: "bridge", start: bodyTriangles, count: bridgeTriangles },
  ];
  const partGroups = part.groups ?? [{ name: "part", start: 0, count: part.triangles.length / 3 }];
  const partTriangleStart = index.length / 3;
  for (let t = 0; t < P.triangles.length; t++) index.push(partStart + (P.triangles[t] as number));
  // A plane seam trims the part. Kept triangles stay in order, so each group
  // becomes the run of kept triangles that came from its range; empty groups drop.
  let at = 0;
  for (const g of partGroups) {
    while (at < P.source.length && (P.source[at] as number) < g.start) at++;
    const from = at;
    while (at < P.source.length && (P.source[at] as number) < g.start + g.count) at++;
    if (at > from) groups.push({ name: g.name, start: partTriangleStart + from, count: at - from });
  }

  const weld = new Uint32Array(vertexCount);
  const firstRender = new Map<number, number>();
  for (let r = 0; r < bodyCount; r++) {
    const s = body.renderToSurface[r] as number;
    const f = firstRender.get(s);
    if (f === undefined) firstRender.set(s, r);
    weld[r] = f ?? r;
  }
  for (let v = bridgeStart; v < partStart; v++) weld[v] = v;
  for (let v = 0; v < P.n; v++) weld[partStart + v] = partStart + (P.weld[v] as number);

  const uvs = new Float32Array(vertexCount * 2);
  if (body.uvs.length === bodyCount * 2) uvs.set(body.uvs);
  if (part.uvs && part.uvs.length === P.n * 2) uvs.set(Float32Array.from(part.uvs), partStart * 2);

  // The rim sampled at the rings' arc parameters: sample i of each corresponds.
  const atRing = (points: ArrayLike<number>, params: ArrayLike<number>) => {
    const out = new Float64Array(N * 3);
    for (let i = 0; i < N; i++) atParam(points, params, ringParams[i] as number, out, i * 3);
    return out;
  };
  const rimSamplesRest = atRing(rimPts, rimParams);
  const rimNormalSamples = atRing(rimNormals, rimParams);
  /** The part's surface leaving its rim, into the part, at each sample (fixed: the part is rigid). */
  const rimOnward = onwardRing(rimSamplesRest, rimNormalSamples, P.axis);

  // Skin (docs/GRAFT.md, "Rig binding"): the body's own; the part inherits the
  // skin of the body it replaces, nearest it at rest; the band blends the loop's
  // into the part's.
  const I = SKIN_INFLUENCES;
  const skinIndex = new Uint16Array(vertexCount * I);
  const skinWeight = new Float32Array(vertexCount * I);
  skinIndex.set(body.skinIndex.subarray(0, bodyCount * I));
  skinWeight.set(body.skinWeight.subarray(0, bodyCount * I));
  const restLoop = loopPoints(B.loop, body.restPositions);
  /** The loop's skin at arc parameter `t`, between the two loop vertices round it. */
  const loopSkin = (t: number, mi: Uint16Array, mw: Float32Array) => {
    let j = 0;
    while (j + 1 < L0 && (B.params[j + 1] as number) <= t) j++;
    const j1 = (j + 1) % L0;
    const tj = B.params[j] as number;
    const tk = j1 === 0 ? 1 : (B.params[j1] as number);
    const va = B.loop[j] as number;
    const vb = B.loop[j1] as number;
    blendSkin(
      body.skinIndex.subarray(va * I, va * I + I),
      body.skinWeight.subarray(va * I, va * I + I),
      body.skinIndex.subarray(vb * I, vb * I + I),
      body.skinWeight.subarray(vb * I, vb * I + I),
      tk > tj ? (t - tj) / (tk - tj) : 0,
      mi,
      mw,
      0,
    );
  };
  // The part placed on the body at rest by the rest loop's fit, so each of its
  // vertices can take the skin of the removed body nearest it.
  const restSamples = atRing(restLoop, B.params);
  fairLoop(restSamples, turnLimit);
  const rimFaired = Float64Array.from(rimSamplesRest);
  fairLoop(rimFaired, turnLimit);
  const restFit = continuationFit(
    rimFaired,
    rimOnward,
    restSamples,
    onwardRing(
      restSamples,
      atRing(loopPoints(B.loop, body.restNormals), B.params),
      unit(newellNormal(restSamples)),
    ),
  );
  const atRest = (p: Vec3): Vec3 => {
    const r = rotate(restFit.rotation, p);
    return [
      restFit.scale * r[0] + restFit.translation[0],
      restFit.scale * r[1] + restFit.translation[1],
      restFit.scale * r[2] + restFit.translation[2],
    ];
  };
  const inherit = removedSkin(body, cut, start);
  const mi = new Uint16Array(I);
  const mw = new Float32Array(I);
  const ri = new Uint16Array(I);
  const rw = new Float32Array(I);
  for (let k = 1; k < R; k++)
    for (let i = 0; i < N; i++) {
      loopSkin(ringParams[i] as number, mi, mw);
      inherit(
        atRest(at3(rimSamplesRest, i)),
        rotate(restFit.rotation, unit(at3(rimNormalSamples, i))),
        ri,
        rw,
      );
      blendSkin(
        mi,
        mw,
        ri,
        rw,
        smoothstep(k / R),
        skinIndex,
        skinWeight,
        bridgeStart + (k - 1) * N + i,
      );
    }
  for (let v = 0; v < P.n; v++) {
    const w = P.weld[v] as number;
    inherit(atRest(at3(restPart, w)), rotate(restFit.rotation, at3(partNormalsRest, w)), ri, rw);
    skinIndex.set(ri, (partStart + v) * I);
    skinWeight.set(rw, (partStart + v) * I);
  }
  smoothPartSkin(P.triangles, P.weld, new Set(P.rim), partStart, skinIndex, skinWeight);
  const topology: GraftTopology = {
    index: Uint32Array.from(index),
    groups,
    vertexCount,
    bodyVertexCount: bodyCount,
    partStart,
    weld,
    uvs,
    skinIndex,
    skinWeight,
    loop: Uint32Array.from(B.loop),
    rim: Uint32Array.from(rimMerged),
    removedFaces: cut.removedFaces,
    droppedAttachments: cut.droppedAttachments,
    removedBones: cut.removedBones,
    rootBone: cut.rootBoneName,
  };

  const graftIndex = topology.index.subarray(bodyTriangles * 3);
  const suppliedNormals = part.normals && part.normals.length === P.n * 3 ? part.normals : null;

  function evaluate(positions: ArrayLike<number>, normals: ArrayLike<number>): GraftSurface {
    const out = new Float32Array(vertexCount * 3);
    out.set(Float32Array.from({ length: bodyCount * 3 }, (_, i) => positions[i] as number));
    // 1–2. The body's loop, sampled and faired; its axis and size.
    const loopPts = loopPoints(B.loop, positions);
    // The loop as it is, where the band leaves the body; faired, where the part arrives.
    const raw = atRing(loopPts, B.params);
    const a = Float64Array.from(raw);
    const bodyTurn = fairLoop(a, turnLimit);
    const axis = unit(newellNormal(a));
    const radius = rmsRadius(a);
    // 3. The similarity, from the part's faired rim samples to the body's.
    const x = Float64Array.from(rimSamplesRest);
    const partTurn = fairLoop(x, turnLimit);
    // 4. The gap: each sample carried on along the body's own surface, away
    // from the body (its continuation across the loop), so the band runs
    // straight on from the body instead of bending to the axis and back.
    const bodyNormalSamples = atRing(loopPoints(B.loop, normals), B.params);
    const onward = onwardRing(raw, bodyNormalSamples, axis);
    const fit: Similarity = continuationFit(x, rimOnward, a, onward);
    const lift: Vec3 = [0, 0, 0];
    for (let i = 0; i < N; i++) addTo(lift, at3(onward, i), (gap * radius) / N);
    const t: Vec3 = [
      fit.translation[0] + lift[0],
      fit.translation[1] + lift[1],
      fit.translation[2] + lift[2],
    ];
    const place = (p: Vec3): Vec3 => {
      const r = rotate(fit.rotation, p);
      return [fit.scale * r[0] + t[0], fit.scale * r[1] + t[1], fit.scale * r[2] + t[2]];
    };
    const target = new Float64Array(N * 3);
    for (let i = 0; i < N; i++) {
      const p = at3(a, i);
      addTo(p, at3(onward, i), gap * radius);
      target.set(p, i * 3);
    }
    // 5. The part placed, its rim blended onto the target by the falloff band.
    const placed = new Float64Array(P.n * 3);
    for (let v = 0; v < P.n; v++) placed.set(place(at3(restPart, v)), v * 3);
    const residual = new Float64Array(P.rim.length * 3);
    const tmp = new Float64Array(3);
    P.rim.forEach((v, j) => {
      atParam(target, ringParams, rimParams[j] as number, tmp);
      for (let k = 0; k < 3; k++)
        residual[j * 3 + k] = (tmp[k] as number) - (placed[v * 3 + k] as number);
    });
    // The lean: per sample, how the body's onward direction differs from the
    // placed part's. Added in the band as `lean · s·d · (1 − d/reach)²`, it turns
    // the part's surface at its rim to leave along the body's continuation and
    // fades out within the band, so a neck that leans otherwise than the
    // body's bends into it instead of meeting it at a knee.
    const lean = new Float64Array(N * 3);
    for (let i = 0; i < N; i++)
      lean.set(sub(at3(onward, i), rotate(fit.rotation, at3(rimOnward, i))), i * 3);
    const blend = new Float64Array(3);
    const bend = new Float64Array(3);
    for (let v = 0; v < P.n; v++) {
      const w = P.weld[v] as number;
      const d = field.distance[w] as number;
      if (!(d < bandReach)) continue;
      const weight = d === 0 ? 1 : smoothstep(1 - d / bandReach);
      const bendWeight = fit.scale * d * (1 - d / bandReach) ** 2;
      atParam(residual, rimParams, field.param[w] as number, blend);
      atParam(lean, ringParams, field.param[w] as number, bend);
      for (let k = 0; k < 3; k++)
        placed[v * 3 + k] =
          (placed[v * 3 + k] as number) +
          weight * (blend[k] as number) +
          bendWeight * (bend[k] as number);
    }
    // The rim exactly on the target, whatever the blend's interpolation.
    P.rim.forEach((v, j) => {
      atParam(target, ringParams, rimParams[j] as number, tmp);
      placed.set(tmp, v * 3);
    });
    for (let v = 0; v < P.n; v++) {
      const w = P.weld[v] as number;
      for (let k = 0; k < 3; k++) out[(partStart + v) * 3 + k] = placed[w * 3 + k] as number;
    }
    // 6. The band: Hermite curves leaving the body and arriving at the part,
    // whose rim the lean has turned to leave along the body's continuation too.
    for (let i = 0; i < N; i++) {
      const p0 = at3(raw, i);
      const p1 = at3(target, i);
      const g0 = at3(onward, i);
      const g1 = g0;
      const L = Math.hypot(...sub(p1, p0));
      for (let k = 1; k < R; k++) {
        const s = k / R;
        const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
        const h10 = s ** 3 - 2 * s ** 2 + s;
        const h01 = -2 * s ** 3 + 3 * s ** 2;
        const h11 = s ** 3 - s ** 2;
        const h: Vec3 = [0, 0, 0];
        addTo(h, p0, h00);
        addTo(h, g0, h10 * L);
        addTo(h, p1, h01);
        addTo(h, g1, h11 * L);
        out.set(h, (bridgeStart + (k - 1) * N + i) * 3);
      }
    }
    // 7. Normals: the body's own; the band's and part's from the merged triangles.
    const outN = new Float32Array(vertexCount * 3);
    outN.set(Float32Array.from({ length: bodyCount * 3 }, (_, i) => normals[i] as number));
    const acc = new Float64Array(vertexCount * 3);
    addTriangleNormals(graftIndex, out, weld, acc);
    for (let v = bridgeStart; v < vertexCount; v++) {
      let n = unit(at3(acc, weld[v] as number));
      if (suppliedNormals && v >= partStart) {
        const p = v - partStart;
        const d = field.distance[P.weld[p] as number] as number;
        const w = d < bandReach ? (d === 0 ? 1 : smoothstep(1 - d / bandReach)) : 0;
        const given = rotate(fit.rotation, unit(at3(suppliedNormals, p)));
        const mixed: Vec3 = [0, 0, 0];
        addTo(mixed, given, 1 - w);
        addTo(mixed, n, w);
        n = unit(mixed);
      }
      outN.set(n, v * 3);
    }
    return {
      positions: out,
      normals: outN,
      fit: {
        scale: fit.scale,
        rotation: fit.rotation,
        translation: t,
        loopRadius: radius,
        turn: (Math.max(bodyTurn, partTurn) * 180) / Math.PI,
      },
    };
  }
  return { topology, evaluate };
}
