/**
 * Resolving a cut on the control mesh (docs/GRAFT.md, "The cut-loop
 * registry"): the quad faces it removes, and the one closed edge loop that
 * bounds them.
 */
import { orderLoops } from "./loops.ts";
import { GraftError, type GraftPlane, type Vec3 } from "./types.ts";

export interface ControlMesh {
  /** Four vertex ids per quad face. */
  faceVerts: ArrayLike<number>;
  /** The faces the body is built from (the `body` group). */
  faces: ArrayLike<number>;
  /** Rest positions, xyz per vertex. */
  positions: ArrayLike<number>;
}

export interface ResolvedCut {
  /** Per entry of `faces`, 1 when the cut removes it. */
  removed: Uint8Array;
  /** The bounding loop, as control vertex ids, unoriented. */
  loop: number[];
}

const key = (a: number, b: number): number => (a < b ? a * 0x100000000 + b : b * 0x100000000 + a);

/** Per edge, the entries of `faces` (positions in that list) that use it. */
function edgeFaces(mesh: ControlMesh): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let i = 0; i < mesh.faces.length; i++) {
    const f = mesh.faces[i] as number;
    for (let k = 0; k < 4; k++) {
      const e = key(
        mesh.faceVerts[f * 4 + k] as number,
        mesh.faceVerts[f * 4 + ((k + 1) % 4)] as number,
      );
      (out.get(e) ?? out.set(e, []).get(e))?.push(i);
    }
  }
  return out;
}

function faceCentre(mesh: ControlMesh, f: number): Vec3 {
  const c: Vec3 = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const v = mesh.faceVerts[f * 4 + k] as number;
    for (let j = 0; j < 3; j++) c[j] = (c[j] as number) + (mesh.positions[v * 3 + j] as number) / 4;
  }
  return c;
}

/** Each entry's neighbours through shared edges. */
function neighbours(mesh: ControlMesh, edges: Map<number, number[]>): number[][] {
  const out: number[][] = Array.from({ length: mesh.faces.length }, () => []);
  for (const fs of edges.values())
    for (const a of fs) for (const b of fs) if (a !== b) (out[a] as number[]).push(b);
  return out;
}

/** The removed region's boundary loop; throws unless it is one simple closed loop. */
function boundary(edges: Map<number, number[]>, removed: Uint8Array): number[] {
  const loopEdges: [number, number][] = [];
  for (const [e, fs] of edges) {
    let r = 0;
    for (const f of fs) r += removed[f] as number;
    if (r > 0 && r < fs.length) loopEdges.push([Math.floor(e / 0x100000000), e % 0x100000000]);
  }
  if (loopEdges.length === 0) throw new GraftError("the cut removes nothing, or everything");
  const loops = orderLoops(loopEdges);
  if (loops.length !== 1)
    throw new GraftError(`the cut is bounded by ${loops.length} loops, not one`);
  return loops[0] as number[];
}

/**
 * Fills in any kept face cut off from the largest kept region (an island the
 * plane leaves inside the removed side), so the cut has one boundary.
 */
function fillIslands(adj: number[][], removed: Uint8Array): void {
  const label = new Int32Array(removed.length).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < removed.length; s++) {
    if (removed[s] || label[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    label[s] = id;
    while (stack.length) {
      const f = stack.pop() as number;
      size++;
      for (const g of adj[f] as number[])
        if (!removed[g] && label[g] === -1) {
          label[g] = id;
          stack.push(g);
        }
    }
    sizes.push(size);
  }
  const largest = sizes.indexOf(Math.max(...sizes));
  for (let f = 0; f < removed.length; f++) if (!removed[f] && label[f] !== largest) removed[f] = 1;
}

/**
 * A plane cut: the faces whose centre is on the side the normal points to,
 * reached from the one nearest `seed` through shared edges, with kept islands
 * filled in.
 */
export function resolvePlaneCut(mesh: ControlMesh, plane: GraftPlane, seed: Vec3): ResolvedCut {
  const l = Math.hypot(...plane.normal) || 1;
  const n = plane.normal.map((x) => x / l) as Vec3;
  const above = (f: number): boolean => {
    const c = faceCentre(mesh, f);
    return (
      (c[0] - plane.point[0]) * n[0] +
        (c[1] - plane.point[1]) * n[1] +
        (c[2] - plane.point[2]) * n[2] >
      0
    );
  };
  let start = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < mesh.faces.length; i++) {
    const f = mesh.faces[i] as number;
    if (!above(f)) continue;
    const c = faceCentre(mesh, f);
    const d = Math.hypot(c[0] - seed[0], c[1] - seed[1], c[2] - seed[2]);
    if (d < best) {
      best = d;
      start = i;
    }
  }
  if (start < 0) throw new GraftError("no body face is on the side the cut removes");
  const edges = edgeFaces(mesh);
  const adj = neighbours(mesh, edges);
  const removed = new Uint8Array(mesh.faces.length);
  removed[start] = 1;
  const stack = [start];
  while (stack.length) {
    const i = stack.pop() as number;
    for (const j of adj[i] as number[])
      if (!removed[j] && above(mesh.faces[j] as number)) {
        removed[j] = 1;
        stack.push(j);
      }
  }
  fillIslands(adj, removed);
  const stair = boundary(edges, removed);
  return snapToEdgeLoop(mesh, edges, adj, n, plane.point, start, removed, stair);
}

/**
 * The edge loop of the quad mesh through `a`→`b`: at each vertex of valence 4,
 * the edge that shares no face with the one arriving. Null when it meets a
 * vertex of another valence or does not close.
 */
function edgeLoop(
  edges: Map<number, number[]>,
  around: Map<number, number[]>,
  a: number,
  b: number,
): number[] | null {
  const loop = [a];
  let prev = a;
  let at = b;
  for (let step = 0; step < 2000; step++) {
    if (at === a) return loop;
    loop.push(at);
    const ring = around.get(at) ?? [];
    if (ring.length !== 4) return null;
    const arriving = new Set(edges.get(key(prev, at)) ?? []);
    const next = ring.filter(
      (c) => c !== prev && !(edges.get(key(at, c)) ?? []).some((f) => arriving.has(f)),
    );
    if (next.length !== 1) return null;
    prev = at;
    at = next[0] as number;
  }
  return null;
}

/**
 * A plane picks whole faces, so its boundary steps where the plane crosses the
 * mesh's rows, and a band from a stepped loop pinches at every step. Where an
 * edge loop of the mesh runs round the same place, the cut takes that instead:
 * of the closed edge loops through the stepped boundary's edges, the one that
 * keeps nearest the plane (by its farthest vertex), provided it bounds the
 * seed's side alone and removes much the same faces. Else the stepped cut stands.
 */
function snapToEdgeLoop(
  mesh: ControlMesh,
  edges: Map<number, number[]>,
  adj: number[][],
  n: Vec3,
  point: Vec3,
  start: number,
  stepped: Uint8Array,
  stair: number[],
): ResolvedCut {
  const around = new Map<number, number[]>();
  for (const e of edges.keys()) {
    const a = Math.floor(e / 0x100000000);
    const b = e % 0x100000000;
    (around.get(a) ?? around.set(a, []).get(a))?.push(b);
    (around.get(b) ?? around.set(b, []).get(b))?.push(a);
  }
  const distance = (v: number) =>
    Math.abs(
      ((mesh.positions[v * 3] as number) - point[0]) * n[0] +
        ((mesh.positions[v * 3 + 1] as number) - point[1]) * n[1] +
        ((mesh.positions[v * 3 + 2] as number) - point[2]) * n[2],
    );
  let steppedCount = 0;
  for (const r of stepped) steppedCount += r;
  const tried = new Set<number>();
  let best: ResolvedCut | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < stair.length; i++) {
    const a = stair[i] as number;
    const b = stair[(i + 1) % stair.length] as number;
    if (tried.has(key(a, b))) continue;
    const loop = edgeLoop(edges, around, a, b);
    if (!loop) continue;
    for (let j = 0; j < loop.length; j++)
      tried.add(key(loop[j] as number, loop[(j + 1) % loop.length] as number));
    const score = Math.max(...loop.map(distance));
    if (score >= bestScore) continue;
    // The seed's side of the loop: faces reached without crossing it.
    const wall = new Set<number>();
    for (let j = 0; j < loop.length; j++)
      wall.add(key(loop[j] as number, loop[(j + 1) % loop.length] as number));
    const removed = new Uint8Array(mesh.faces.length);
    removed[start] = 1;
    const stack = [start];
    let count = 1;
    while (stack.length) {
      const f = stack.pop() as number;
      const fv = mesh.faces[f] as number;
      for (let k = 0; k < 4; k++) {
        const e = key(
          mesh.faceVerts[fv * 4 + k] as number,
          mesh.faceVerts[fv * 4 + ((k + 1) % 4)] as number,
        );
        if (wall.has(e)) continue;
        for (const g of edges.get(e) ?? [])
          if (!removed[g]) {
            removed[g] = 1;
            count++;
            stack.push(g);
          }
      }
    }
    if (Math.abs(count - steppedCount) > 0.25 * steppedCount) continue;
    fillIslands(adj, removed);
    let bounded: number[];
    try {
      bounded = boundary(edges, removed);
    } catch {
      continue;
    }
    if (bounded.length !== loop.length) continue;
    best = { removed, loop: bounded };
    bestScore = score;
  }
  return best ?? { removed: stepped, loop: stair };
}

/** A supplied cut: these control faces are removed (each must be one of `mesh.faces`). */
export function resolveFaceCut(mesh: ControlMesh, faces: readonly number[]): ResolvedCut {
  const at = new Map<number, number>();
  for (let i = 0; i < mesh.faces.length; i++) at.set(mesh.faces[i] as number, i);
  const removed = new Uint8Array(mesh.faces.length);
  for (const f of faces) {
    const i = at.get(f);
    if (i === undefined) throw new GraftError(`face ${f} is not a body face`);
    removed[i] = 1;
  }
  const edges = edgeFaces(mesh);
  return { removed, loop: boundary(edges, removed) };
}
