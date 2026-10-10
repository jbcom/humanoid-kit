/**
 * Reservoirs: collapsed strips on a refined surface, the material that detail
 * targets extrude into a shaft, a scrotum or a fold (docs/research/ADULT-SCULPT-PLAN.md,
 * section 6b).
 *
 * A reservoir is a closed loop of lattice vertices round a disc of faces (the
 * cap). On the surface in use it adds, between the loop and the cap, `rings`
 * rings of vertices that are copies of the loop's vertices at that level (the
 * same stencil row, so the same position, skin weights and shading normal), the
 * strips of quads between consecutive rings, and re-attaches the cap to the last
 * ring. At rest every ring coincides with the loop, so the surface is exactly
 * the surface without the reservoir and the strips have zero area; pulling the
 * cap and rings outward turns them into the wall of a tube.
 *
 * The copies are made at the final level, from the final quads, so the result
 * is exact at every subdivision level. Original vertices keep their ids through
 * Catmull–Clark (`catmullClarkPolygons`), so the loop's vertices are found in
 * the final surface by id, and the vertices between them (edge points) are the
 * rest of the cap's boundary, found from the quads.
 */
import type { Stencil } from "../subdiv/catmullClark.ts";

/**
 * Where a reservoir's skin lies in UV space, on an island of its own: the strips
 * (the tube's wall) as a grid, chain position along `across` and ring along
 * `along`, and the cap as a disc. Without one the strips are collapsed in UV, as
 * they are in space, and the cap keeps the UVs of the skin it replaced, so the
 * skin layers could not tell the tube from the skin around its root.
 */
export interface ReservoirIsland {
  /** UV of the loop (ring 0) at chain position 0. */
  origin: readonly [number, number];
  /** UV step from chain position 0 all the way round to the same place (the seam). */
  across: readonly [number, number];
  /** UV step from the loop to the last ring. */
  along: readonly [number, number];
  /** The cap's disc: its edge is the last ring, its centre the tip. */
  cap: { centre: readonly [number, number]; radius: number };
}

/** A reservoir as the adult pack names it (`AdultReservoirSpec`). */
export interface Reservoir {
  /** The loop's vertices of the refinement mesh, in order round the cap. */
  loop: readonly number[];
  /** The refinement mesh's polygons that make the cap. */
  cap: readonly number[];
  /** Collapsed rings between the loop and the cap. */
  rings: number;
  /** Where its skin lies in UV space; absent, the UVs of the surface it was cut from. */
  island?: ReservoirIsland;
}

/** Where an island's UVs are among the surface's (`SurfaceReservoir.island`). */
export interface SurfaceIsland {
  /** UV index of the grid's first point (ring 0, chain position 0); the grid is row by row, rings first. */
  stripBase: number;
  /** Points per row: chain elements and one more, for the seam. */
  columns: number;
  /** Rows: rings and one more, for the loop. */
  rows: number;
  /** UV indices of the cap's corners: `capBase` up to `capBase + capCount`. */
  capBase: number;
  capCount: number;
}

/** A reservoir on a built surface: where its copies are and how a lattice-level detail reaches them. */
export interface SurfaceReservoir {
  /** The loop's vertices of the refinement mesh, as in the spec. */
  loop: Uint32Array;
  rings: number;
  /** Index of ring 1, loop position 0, among the detail's vertices (after the region's). */
  base: number;
  /** Vertices of the loop at the surface's level (the loop's and the edge points between). */
  chain: number;
  /** Final surface vertex of ring `j` (1 to `rings`), chain element `t`: `copies[(j - 1) * chain + t]`. */
  copies: Uint32Array;
  /** The loop at the surface's level, in order: the chain's final surface vertices (the skin the rings copy). */
  loopVertices: Uint32Array;
  /** The cap's own final surface vertices, inside the loop, ascending: what a detail draws the tip from. */
  capVertices: Uint32Array;
  /** Per chain element, the loop position at or before it. */
  slot: Uint32Array;
  /** Per chain element, the fraction of the way from that loop position to the next. */
  fraction: Float32Array;
  /** Where the island's UVs are, when the reservoir has one. */
  island?: SurfaceIsland;
}

export interface ReservoirInput {
  /** Quads of the final surface, four vertices each, with UV indices alongside. */
  faces: Uint32Array;
  faceUvs: Uint32Array;
  /** The UV coordinates `faceUvs` index, two per entry. */
  uvs: Float32Array;
  vertexCount: number;
  /** Control vertices → final surface positions. */
  stencil: Stencil;
  /** Per quad, the refinement polygon it descends from. */
  lineage: Uint32Array;
  /** Per quad, the control face (by place among those built from) that owns its triangles. */
  owner: Uint32Array;
  /** Vertices of the refinement mesh: the ids below it are the lattice's own. */
  latticeVertices: number;
  /** Where the detail's reservoir vertices begin (the region's size). */
  detailBase: number;
}

export interface ReservoirOutput {
  faces: Uint32Array;
  faceUvs: Uint32Array;
  /** The input's UV coordinates, then each island's. */
  uvs: Float32Array;
  vertexCount: number;
  stencil: Stencil;
  owner: Uint32Array;
  reservoirs: SurfaceReservoir[];
  /** For each copy, in id order from the input's vertex count, the vertex it copies. */
  copyOf: Uint32Array;
  /** Total detail vertices: the region's and every reservoir's rings. */
  detailCount: number;
}

/** A stencil with extra rows, each a copy of an existing row. */
function withCopiedRows(stencil: Stencil, rows: readonly number[]): Stencil {
  const n = stencil.offsets.length - 1;
  let extra = 0;
  for (const r of rows)
    extra += (stencil.offsets[r + 1] as number) - (stencil.offsets[r] as number);
  const offsets = new Uint32Array(n + rows.length + 1);
  offsets.set(stencil.offsets);
  const src = new Uint32Array(stencil.src.length + extra);
  const weights = new Float32Array(stencil.weights.length + extra);
  src.set(stencil.src);
  weights.set(stencil.weights);
  let at = stencil.src.length;
  rows.forEach((r, i) => {
    const from = stencil.offsets[r] as number;
    const to = stencil.offsets[r + 1] as number;
    src.set(stencil.src.subarray(from, to), at);
    weights.set(stencil.weights.subarray(from, to), at);
    at += to - from;
    offsets[n + i + 1] = at;
  });
  return { inputCount: stencil.inputCount, offsets, src, weights };
}

/** The directed boundary of a set of quads, as one cycle of vertices with the quad that owns each edge. */
function boundaryCycle(
  faces: Uint32Array,
  quads: readonly number[],
  start: number,
  what: string,
): { vertices: number[]; quads: number[] } {
  const used = new Map<string, { from: number; to: number; quad: number; count: number }>();
  for (const q of quads)
    for (let k = 0; k < 4; k++) {
      const a = faces[q * 4 + k] as number;
      const b = faces[q * 4 + ((k + 1) % 4)] as number;
      // A triangle drawn as a quad repeats a corner: that edge is a point.
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const seen = used.get(key);
      if (seen) seen.count++;
      else used.set(key, { from: a, to: b, quad: q, count: 1 });
    }
  const next = new Map<number, { to: number; quad: number }>();
  for (const e of used.values()) {
    if (e.count !== 1) continue;
    if (next.has(e.from))
      throw new RangeError(`${what}: the cap's boundary pinches at vertex ${e.from}`);
    next.set(e.from, { to: e.to, quad: e.quad });
  }
  if (!next.has(start))
    throw new RangeError(`${what}: loop vertex ${start} is not on the cap's boundary`);
  const vertices: number[] = [];
  const owners: number[] = [];
  let at = start;
  do {
    const step = next.get(at);
    if (!step) throw new RangeError(`${what}: the cap's boundary is not a closed loop`);
    vertices.push(at);
    owners.push(step.quad);
    at = step.to;
    if (vertices.length > next.size)
      throw new RangeError(`${what}: the cap's boundary is not a single loop`);
  } while (at !== start);
  if (vertices.length !== next.size)
    throw new RangeError(`${what}: the cap's boundary is more than one loop`);
  return { vertices, quads: owners };
}

/**
 * The UVs of a reservoir's island (`ReservoirIsland`): the wall's grid, and the cap's
 * corners mapped by their polar place in the disc of skin the cap replaces onto the
 * island's disc. The cap's corners are the UVs the cap's faces had; the new ones are
 * numbered from `first`, the grid's row by row and then the cap's.
 */
function layOutIsland(
  input: ReservoirInput,
  spec: Reservoir,
  m: number,
  boundaryUv: readonly number[],
  quads: readonly number[],
  first: number,
): { grid: Uint32Array; capMap: Map<number, number>; coordinates: number[]; info: SurfaceIsland } {
  const island = spec.island as ReservoirIsland;
  const coordinates: number[] = [];
  const columns = m + 1;
  const rows = spec.rings + 1;
  const grid = new Uint32Array(columns * rows);
  for (let j = 0; j < rows; j++)
    for (let t = 0; t < columns; t++) {
      grid[j * columns + t] = first + coordinates.length / 2;
      coordinates.push(
        island.origin[0] + (island.across[0] * t) / m + (island.along[0] * j) / spec.rings,
        island.origin[1] + (island.across[1] * t) / m + (island.along[1] * j) / spec.rings,
      );
    }
  // The skin's disc in UV, by the angle of each boundary point round its centre.
  const at = (uv: number) =>
    [input.uvs[uv * 2] as number, input.uvs[uv * 2 + 1] as number] as const;
  const points = boundaryUv.map(at);
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const ring = points
    .map((p) => ({
      angle: Math.atan2(p[1] - cy, p[0] - cx),
      radius: Math.hypot(p[0] - cx, p[1] - cy),
    }))
    .sort((a, b) => a.angle - b.angle);
  const radiusAt = (angle: number) => {
    let hi = ring.findIndex((p) => p.angle >= angle);
    if (hi < 0) hi = 0;
    const lo = (hi + ring.length - 1) % ring.length;
    const a = ring[lo] as { angle: number; radius: number };
    const b = ring[hi] as { angle: number; radius: number };
    let span = b.angle - a.angle;
    let off = angle - a.angle;
    if (span <= 0) span += 2 * Math.PI;
    if (off < 0) off += 2 * Math.PI;
    return a.radius + (b.radius - a.radius) * (span > 0 ? Math.min(1, off / span) : 0);
  };
  const capMap = new Map<number, number>();
  const capBase = first + coordinates.length / 2;
  for (const q of quads)
    for (let k = 0; k < 4; k++) {
      const uv = input.faceUvs[q * 4 + k] as number;
      if (capMap.has(uv)) continue;
      const [x, y] = at(uv);
      const angle = Math.atan2(y - cy, x - cx);
      const sigma = Math.min(1, Math.hypot(x - cx, y - cy) / radiusAt(angle));
      capMap.set(uv, first + coordinates.length / 2);
      coordinates.push(
        island.cap.centre[0] + sigma * island.cap.radius * Math.cos(angle),
        island.cap.centre[1] + sigma * island.cap.radius * Math.sin(angle),
      );
    }
  return {
    grid,
    capMap,
    coordinates,
    info: { stripBase: first, columns, rows, capBase, capCount: capMap.size },
  };
}

/**
 * Adds the reservoirs to a built surface's quads (see the file header). The caps
 * must be disjoint and their loops share no vertex.
 */
export function applyReservoirs(
  input: ReservoirInput,
  specs: readonly Reservoir[],
): ReservoirOutput {
  const { faces, faceUvs, lineage, owner } = input;
  const quadCount = faces.length / 4;
  const capOf = new Int32Array(quadCount).fill(-1);
  const reps: number[] = [];
  const reservoirs: SurfaceReservoir[] = [];
  /** Per reservoir, per chain element, the cap-side UV index and the owning quad. */
  const chains: { vertices: number[]; uv: number[]; quads: number[] }[] = [];
  /** UV coordinates the islands add, and per reservoir its grid's and cap's UV indices. */
  const extraUv: number[] = [];
  const uvBase = input.uvs.length / 2;
  const grids: (Uint32Array | null)[] = [];
  const capUvs: (Map<number, number> | null)[] = [];
  let detailCount = input.detailBase;
  const loopVertices = new Set<number>();

  specs.forEach((spec, s) => {
    const what = `reservoir ${s}`;
    if (!Number.isInteger(spec.rings) || spec.rings < 1)
      throw new RangeError(`${what}: needs at least one ring`);
    if (spec.loop.length < 3) throw new RangeError(`${what}: a loop needs at least 3 vertices`);
    const cap = new Set(spec.cap);
    const quads: number[] = [];
    for (let q = 0; q < quadCount; q++)
      if (cap.has(lineage[q] as number)) {
        if ((capOf[q] as number) !== -1)
          throw new RangeError(`${what}: its cap overlaps another's`);
        capOf[q] = s;
        quads.push(q);
      }
    if (!quads.length) throw new RangeError(`${what}: its cap has no faces`);
    const cycle = boundaryCycle(faces, quads, spec.loop[0] as number, what);
    // The vertices of the cycle that are the refinement's own are the loop, in order.
    const own = cycle.vertices.filter((v) => v < input.latticeVertices);
    if (own.length !== spec.loop.length || own.some((v, i) => v !== spec.loop[i]))
      throw new RangeError(`${what}: its loop is not the cap's boundary, in order`);
    for (const v of cycle.vertices) {
      if (loopVertices.has(v))
        throw new RangeError(`${what}: its loop shares vertex ${v} with another`);
      loopVertices.add(v);
    }
    const uv = cycle.quads.map((q, t) => {
      const k = [0, 1, 2, 3].find((c) => faces[q * 4 + c] === cycle.vertices[t]) as number;
      return faceUvs[q * 4 + k] as number;
    });
    chains.push({ vertices: cycle.vertices, uv, quads: cycle.quads });
    const m = cycle.vertices.length;
    const island = spec.island
      ? layOutIsland(input, spec, m, uv, quads, uvBase + extraUv.length / 2)
      : null;
    grids.push(island?.grid ?? null);
    capUvs.push(island?.capMap ?? null);
    if (island) for (const x of island.coordinates) extraUv.push(x);
    const base = detailCount;
    detailCount += spec.loop.length * spec.rings;
    const copies = new Uint32Array(m * spec.rings);
    for (let j = 0; j < spec.rings; j++)
      for (let t = 0; t < m; t++) {
        copies[j * m + t] = input.vertexCount + reps.length;
        reps.push(cycle.vertices[t] as number);
      }
    // Where each chain element sits among the loop's vertices.
    const slot = new Uint32Array(m);
    const fraction = new Float32Array(m);
    const at = cycle.vertices.map((v) => (v < input.latticeVertices ? 1 : 0));
    const owns: number[] = [];
    at.forEach((o, t) => {
      if (o) owns.push(t);
    });
    owns.forEach((t0, i) => {
      const t1 = i + 1 < owns.length ? (owns[i + 1] as number) : m;
      for (let t = t0; t < t1; t++) {
        slot[t] = i;
        fraction[t] = (t - t0) / (t1 - t0);
      }
    });
    const onChain = new Set(cycle.vertices);
    const inside = new Set<number>();
    for (const q of quads)
      for (let k = 0; k < 4; k++) {
        const v = faces[q * 4 + k] as number;
        if (!onChain.has(v)) inside.add(v);
      }
    reservoirs.push({
      loop: Uint32Array.from(spec.loop),
      rings: spec.rings,
      base,
      chain: m,
      copies,
      loopVertices: Uint32Array.from(cycle.vertices),
      capVertices: Uint32Array.from([...inside].sort((a, b) => a - b)),
      slot,
      fraction,
      ...(island && { island: island.info }),
    });
  });

  // Rebuild the quads: caps re-attached to their last ring, the strips added, all in owner order.
  const outFaces: number[] = [];
  const outUvs: number[] = [];
  const outOwner: number[] = [];
  const lastRing = new Map<number, number>();
  specs.forEach((_, s) => {
    const r = reservoirs[s] as SurfaceReservoir;
    const chain = chains[s] as (typeof chains)[number];
    chain.vertices.forEach((v, t) => {
      lastRing.set(v, r.copies[(r.rings - 1) * r.chain + t] as number);
    });
  });
  for (let q = 0; q < quadCount; q++) {
    const s = capOf[q] as number;
    const island = s === -1 ? null : (capUvs[s] ?? null);
    for (let k = 0; k < 4; k++) {
      const v = faces[q * 4 + k] as number;
      outFaces.push(s === -1 ? v : (lastRing.get(v) ?? v));
      const uv = faceUvs[q * 4 + k] as number;
      // A cap on an island of its own lies on the island's disc, not on the skin it was cut from.
      outUvs.push(island ? (island.get(uv) as number) : uv);
    }
    outOwner.push(owner[q] as number);
  }
  specs.forEach((_, s) => {
    const r = reservoirs[s] as SurfaceReservoir;
    const chain = chains[s] as (typeof chains)[number];
    const m = r.chain;
    const ring = (j: number, t: number) =>
      j === 0 ? (chain.vertices[t % m] as number) : (r.copies[(j - 1) * m + (t % m)] as number);
    const grid = grids[s] ?? null;
    for (let t = 0; t < m; t++)
      for (let j = 1; j <= r.rings; j++) {
        // Written against the cap's direction, so each edge is used once each way.
        outFaces.push(ring(j, t + 1), ring(j, t), ring(j - 1, t), ring(j - 1, t + 1));
        if (grid) {
          // On an island the wall is a grid in UV: the seam is the last column.
          const at = (row: number, column: number) => grid[row * (m + 1) + column] as number;
          outUvs.push(at(j, t + 1), at(j, t), at(j - 1, t), at(j - 1, t + 1));
        } else {
          const u0 = chain.uv[t] as number;
          const u1 = chain.uv[(t + 1) % m] as number;
          outUvs.push(u1, u0, u0, u1);
        }
        outOwner.push(owner[chain.quads[t] as number] as number);
      }
  });
  // Stable by owner: a control face's triangles are consecutive (the clothing mask relies on it).
  const order = Array.from({ length: outOwner.length }, (_, i) => i).sort(
    (a, b) => (outOwner[a] as number) - (outOwner[b] as number) || a - b,
  );
  const sortedFaces = new Uint32Array(outFaces.length);
  const sortedUvs = new Uint32Array(outUvs.length);
  const sortedOwner = new Uint32Array(outOwner.length);
  order.forEach((from, to) => {
    for (let k = 0; k < 4; k++) {
      sortedFaces[to * 4 + k] = outFaces[from * 4 + k] as number;
      sortedUvs[to * 4 + k] = outUvs[from * 4 + k] as number;
    }
    sortedOwner[to] = outOwner[from] as number;
  });
  const uvs = new Float32Array(input.uvs.length + extraUv.length);
  uvs.set(input.uvs);
  uvs.set(extraUv, input.uvs.length);
  return {
    faces: sortedFaces,
    faceUvs: sortedUvs,
    uvs,
    vertexCount: input.vertexCount + reps.length,
    stencil: withCopiedRows(input.stencil, reps),
    owner: sortedOwner,
    reservoirs,
    copyOf: Uint32Array.from(reps),
    detailCount,
  };
}
