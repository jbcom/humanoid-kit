/**
 * How far to sink the skin that shows at a garment's edge under the cloth over
 * it (docs/ARCHITECTURE.md, "Clothing", "Skin at a garment's edge").
 *
 * MakeHuman hides only the body faces a garment covers whole and keeps the ring
 * of faces round the edge, so no gap opens between cloth and skin. That ring sits
 * a centimetre or two under the cloth, and a joint moves cloth and skin
 * differently by that much: at the shoulder top, where four bones of very
 * different motion meet, the skin comes through the yoke in a raised-arm pose.
 * Sinking each ring vertex by its own clearance puts it under the cloth in every
 * pose, and moves nothing the cloth does not already cover.
 */

/** A garment's rest geometry: positions, and its faces as quads or as triangles. */
export interface TuckCloth {
  positions: Float32Array;
  /** Quads, four vertex indices each; three each with `triangles`. */
  faces: Uint32Array;
  /** The faces are triangles: a drawn surface's index, not the control mesh's quads. */
  triangles?: boolean;
}

export interface TuckInput {
  /** Rest positions of the body's vertices, xyz. */
  positions: Float32Array;
  /** Unit normals, same layout. */
  normals: Float32Array;
  /** The vertices to consider: the visible ones near the cloth's edge. */
  candidates: ArrayLike<number>;
  cloth: readonly TuckCloth[];
  /** Cloth further than this (metres) over the skin does not sink it. */
  cap: number;
}

const CELL = 0.03;
/** The share of a cloth vertex's binding weight that must be under outer cloth for it to be covered. */
const COVERED_SHARE = 0.5;

/**
 * Per vertex, the distance (metres, at most `cap`) to the nearest cloth along
 * its normal, taking the outermost garment's; zero for a vertex that is not a
 * candidate, has no cloth over it within `cap`, or only cloth behind it.
 */
export function tuckDepths(input: TuckInput): Float32Array {
  const { positions, normals, candidates, cloth, cap } = input;
  const out = new Float32Array(positions.length / 3);
  for (const garment of cloth) {
    const grid = triangleGrid(garment);
    for (let i = 0; i < candidates.length; i++) {
      const v = candidates[i] as number;
      const t = firstHit(grid, garment, origin(positions, v), direction(normals, v, 1), cap);
      if (t !== null && t > (out[v] as number)) out[v] = t;
    }
  }
  return out;
}

export interface ClothTuckInput {
  /** Rest positions of the inner garment's vertices, xyz. */
  positions: Float32Array;
  /** Its unit outward normals, same layout. */
  normals: Float32Array;
  /** The garments over it, at rest. */
  outer: readonly TuckCloth[];
  /** Cloth further than this (metres) inside the outer cloth is not pulled back. */
  cap: number;
  /** How far under the outer cloth (metres) the inner cloth is left. */
  gap: number;
}

/**
 * Per vertex of a garment worn under others, how far to sink it along its
 * normal (metres) to lie `gap` under every garment over it (docs/ARCHITECTURE.md,
 * "A garment under another is sunk under it"): by how far it pokes out of an
 * outer cloth plus the gap, or what it lacks of the gap under one. Only outer
 * cloth facing the way the vertex does counts, so the far wall of a boot shaft
 * the vertex is inside never pulls it across. Zero for a vertex already clear.
 */
export function clothTuck(input: ClothTuckInput): Float32Array {
  const { positions, normals, outer, cap, gap } = input;
  const count = positions.length / 3;
  const out = new Float32Array(count);
  for (const garment of outer) {
    const grid = triangleGrid(garment);
    for (let v = 0; v < count; v++) {
      const o = origin(positions, v);
      const n = direction(normals, v, 1);
      // Outer cloth below the vertex: the vertex pokes out of it.
      const below = firstHit(grid, garment, o, direction(normals, v, -1), cap, n);
      if (below !== null) out[v] = Math.max(out[v] as number, below + gap);
      // Outer cloth above it, closer than the gap.
      const above = firstHit(grid, garment, o, n, gap, n);
      if (above !== null) out[v] = Math.max(out[v] as number, gap - above);
    }
  }
  return out;
}

export interface CoveredInput {
  /** Rest positions and unit normals of the body's vertices, xyz. */
  skin: { positions: Float32Array; normals: Float32Array };
  /** The inner garment's binding: three body vertices and weights per vertex. */
  binding: { refVerts: Uint32Array; weights: Float32Array };
  /** Rest positions of the inner garment's vertices (sunk by `clothTuck`), xyz. */
  positions: Float32Array;
  /** The garments over it, at rest. */
  outer: readonly TuckCloth[];
  /** Outer cloth further off the skin than this (metres) covers nothing. */
  cap: number;
  /**
   * How far past the outer cloth (metres) a vertex may still be covered: as far
   * as cloth is pulled back from (`ClothTuckInput.cap`), since what pokes out of
   * a boot shaft is the boot's to show, not the jeans'.
   */
  beyond: number;
}

/**
 * Per vertex of a garment worn under others, 1 where it lies behind a garment
 * over it, so a face all of whose corners do can never show (docs/ARCHITECTURE.md,
 * "A garment under another is sunk under it"). Worked out from the skin, which
 * is inside everything: each body vertex the cloth vertex is bound to must meet
 * outer cloth along its normal within `cap`, and the cloth vertex must be no
 * further off the skin than that cloth (blended by the binding's weights), plus
 * `beyond`. From the cloth vertex alone, a boot's lining facing the jeans inside
 * it and the other boot facing the jeans beside it look the same.
 */
export function coveredBy(input: CoveredInput): Uint8Array {
  const { skin, binding, positions, outer, cap, beyond } = input;
  const count = positions.length / 3;
  const out = new Uint8Array(count);
  // Distance from each referenced body vertex out to the nearest outer cloth;
  // negative for cloth just inside the skin, as a snug shaft over skin it
  // deletes is, used only where none is outside it.
  const under = new Map<number, number>();
  const inside = new Map<number, number>();
  for (const b of binding.refVerts) under.set(b, Number.POSITIVE_INFINITY);
  for (const garment of outer) {
    const grid = triangleGrid(garment);
    for (const b of under.keys()) {
      const o = origin(skin.positions, b);
      const t = firstHit(grid, garment, o, direction(skin.normals, b, 1), cap);
      if (t !== null && t < (under.get(b) as number)) under.set(b, t);
      const s = firstHit(grid, garment, o, direction(skin.normals, b, -1), cap);
      if (s !== null && s < (inside.get(b) ?? Number.POSITIVE_INFINITY)) inside.set(b, s);
    }
  }
  for (const [b, s] of inside) if (!Number.isFinite(under.get(b) as number)) under.set(b, -s);
  for (let v = 0; v < count; v++) {
    // Over the body vertices under outer cloth only, weighted by the binding.
    let held = 0;
    let total = 0;
    let reach = 0;
    const s = [0, 0, 0];
    const n = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
      const b = binding.refVerts[v * 3 + j] as number;
      const w = Math.abs(binding.weights[v * 3 + j] as number);
      total += w;
      const t = under.get(b) ?? Number.POSITIVE_INFINITY;
      if (w === 0 || !Number.isFinite(t)) continue;
      held += w;
      reach += w * t;
      for (let a = 0; a < 3; a++) {
        s[a] = (s[a] as number) + w * (skin.positions[b * 3 + a] as number);
        n[a] = (n[a] as number) + w * (skin.normals[b * 3 + a] as number);
      }
    }
    // Most of the binding must be under outer cloth: one of three body vertices
    // at a seam of the boot does not uncover the jeans there.
    if (held === 0 || held < total * COVERED_SHARE) continue;
    const length = Math.hypot(n[0] as number, n[1] as number, n[2] as number);
    if (length === 0) continue;
    let off = 0;
    for (let a = 0; a < 3; a++)
      off +=
        ((positions[v * 3 + a] as number) - (s[a] as number) / held) * ((n[a] as number) / length);
    if (off <= reach / held + beyond) out[v] = 1;
  }
  return out;
}

/** How much deeper than the gap hair goes under a hat, per metre it was past it (`underHat`). */
const SQUASH = 0.5;

export interface UnderHatInput {
  /** A point inside the skull, xyz: the middle of the head bone. */
  centre: readonly [number, number, number];
  /** Rest positions of the hair's vertices, xyz. */
  positions: Float32Array;
  /** The hats worn, at rest. */
  hats: readonly TuckCloth[];
  /** How far under the hat (metres) the hair is left. */
  gap: number;
}

/**
 * Per hair vertex, how far to draw it toward the middle of the head (metres)
 * to lie at least `gap` under the hats over it (docs/ARCHITECTURE.md, "Hair
 * under a hat"): by how far it is past the first hat met on the way out to it
 * from there, plus the gap, plus half as far again (`SQUASH`). A crown and its band enclose the skull, so that line
 * meets the hat exactly where the hair would come through it. Hair the line
 * reaches before any hat (below the band, out of a hood's face) keeps its
 * place, whatever binds it: scalp hair on the skin and long hair on the hair
 * helper alike. Zero for a vertex already under the hat.
 */
export function underHat(input: UnderHatInput): Float32Array {
  const { centre, positions, hats, gap } = input;
  const count = positions.length / 3;
  const out = new Float32Array(count);
  for (const hat of hats) {
    const grid = triangleGrid(hat);
    // Hair nearer the middle than any of the hat (less a cell, for a triangle's
    // inside nearer than its corners) cannot be past it: most of a style.
    let near = Number.POSITIVE_INFINITY;
    for (let i = 0; i < hat.positions.length; i += 3)
      near = Math.min(
        near,
        Math.hypot(
          (hat.positions[i] as number) - centre[0],
          (hat.positions[i + 1] as number) - centre[1],
          (hat.positions[i + 2] as number) - centre[2],
        ),
      );
    const reach = near - CELL - gap;
    for (let v = 0; v < count; v++) {
      const d: Vec3 = [
        (positions[v * 3] as number) - centre[0],
        (positions[v * 3 + 1] as number) - centre[1],
        (positions[v * 3 + 2] as number) - centre[2],
      ];
      const length = Math.hypot(d[0], d[1], d[2]);
      if (length === 0 || length < reach) continue;
      const t = firstHit(
        grid,
        hat,
        [centre[0], centre[1], centre[2]],
        [d[0] / length, d[1] / length, d[2] / length],
        length + gap,
      );
      if (t === null) continue;
      // Hair from further out goes deeper, by half as far again: a card's
      // straight edge between two pressed ends would otherwise cut through
      // the felt across a crown's pinch, where the hat folds in between them.
      const depth = length - Math.max(0, t - gap) + Math.max(0, length - t) * SQUASH;
      if (depth > (out[v] as number)) out[v] = depth;
    }
  }
  return out;
}

type Vec3 = [number, number, number];

const origin = (p: Float32Array, v: number): Vec3 => [
  p[v * 3] as number,
  p[v * 3 + 1] as number,
  p[v * 3 + 2] as number,
];

const direction = (n: Float32Array, v: number, sign: 1 | -1): Vec3 => [
  sign * (n[v * 3] as number),
  sign * (n[v * 3 + 1] as number),
  sign * (n[v * 3 + 2] as number),
];

/**
 * A garment's triangles by the 3 cm cells their bounds touch, and a stamp per
 * triangle so a ray tests each once without allocating.
 */
interface Grid {
  cells: Map<number, number[]>;
  stamp: Uint32Array;
  epoch: number;
}

/** Cells span ±1024 × 3 cm (±30 m) on each axis, keyed as one integer. */
const SPAN = 2048;
const key = (x: number, y: number, z: number) =>
  ((x + SPAN / 2) * SPAN + (y + SPAN / 2)) * SPAN + (z + SPAN / 2);

/** Each garment's grid, built on first use: an outfit casts many rays at one garment. */
const grids = new WeakMap<TuckCloth, Grid>();

/** Triangle `t` of a garment: of its quads, (0,1,2) for even and (0,2,3) for odd. */
function corners(g: TuckCloth, t: number): [number, number, number] {
  if (g.triangles)
    return [g.faces[t * 3] as number, g.faces[t * 3 + 1] as number, g.faces[t * 3 + 2] as number];
  const q = (t >> 1) * 4;
  return t & 1
    ? [g.faces[q] as number, g.faces[q + 2] as number, g.faces[q + 3] as number]
    : [g.faces[q] as number, g.faces[q + 1] as number, g.faces[q + 2] as number];
}

function triangleGrid(g: TuckCloth): Grid {
  const known = grids.get(g);
  if (known) return known;
  const cells = new Map<number, number[]>();
  const count = g.triangles ? g.faces.length / 3 : (g.faces.length / 4) * 2;
  for (let t = 0; t < count; t++) {
    const c = corners(g, t);
    const lo = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const hi = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const v of c)
      for (let a = 0; a < 3; a++) {
        const p = g.positions[v * 3 + a] as number;
        lo[a] = Math.min(lo[a] as number, p);
        hi[a] = Math.max(hi[a] as number, p);
      }
    for (
      let x = Math.floor((lo[0] as number) / CELL);
      x <= Math.floor((hi[0] as number) / CELL);
      x++
    )
      for (
        let y = Math.floor((lo[1] as number) / CELL);
        y <= Math.floor((hi[1] as number) / CELL);
        y++
      )
        for (
          let z = Math.floor((lo[2] as number) / CELL);
          z <= Math.floor((hi[2] as number) / CELL);
          z++
        ) {
          const k = key(x, y, z);
          const list = cells.get(k);
          if (list) list.push(t);
          else cells.set(k, [t]);
        }
  }
  const grid = { cells, stamp: new Uint32Array(count), epoch: 0 };
  grids.set(g, grid);
  return grid;
}

/**
 * The smallest t in (0, cap] at which the ray from `o` along unit `d` meets the
 * garment, or null; with `facing`, only triangles whose normal points the way
 * `facing` does count.
 */
function firstHit(
  grid: Grid,
  g: TuckCloth,
  o: Vec3,
  d: Vec3,
  cap: number,
  facing?: Vec3,
): number | null {
  let best: number | null = null;
  // A new stamp for this ray; on wrap-around, clear the old ones.
  grid.epoch = (grid.epoch + 1) >>> 0;
  if (grid.epoch === 0) {
    grid.stamp.fill(0);
    grid.epoch = 1;
  }
  // Every cell the segment [0, cap] passes through, in order (Amanatides–Woo):
  // stepping by a fixed length would skip a cell a slanted ray only cuts across.
  const cell = [0, 1, 2].map((a) => Math.floor((o[a] as number) / CELL)) as Vec3;
  const step = [0, 1, 2].map((a) => Math.sign(d[a] as number)) as Vec3;
  const next = [0, 1, 2].map((a) => {
    const da = d[a] as number;
    if (da === 0) return Number.POSITIVE_INFINITY;
    const edge = ((cell[a] as number) + (da > 0 ? 1 : 0)) * CELL;
    return (edge - (o[a] as number)) / da;
  }) as Vec3;
  const delta = [0, 1, 2].map((a) =>
    (d[a] as number) === 0 ? Number.POSITIVE_INFINITY : CELL / Math.abs(d[a] as number),
  ) as Vec3;
  let t = 0;
  while (t <= cap) {
    for (const tri of grid.cells.get(key(cell[0], cell[1], cell[2])) ?? []) {
      if (grid.stamp[tri] === grid.epoch) continue;
      grid.stamp[tri] = grid.epoch;
      const [a, b, c] = corners(g, tri);
      if (facing && !faces(g.positions, a, b, c, facing)) continue;
      const hit = rayTriangle(o, d, g.positions, a, b, c);
      if (hit !== null && hit > 0 && hit <= cap && (best === null || hit < best)) best = hit;
    }
    // A hit nearer than where the ray leaves this cell is the first.
    const axis = next[0] <= next[1] ? (next[0] <= next[2] ? 0 : 2) : next[1] <= next[2] ? 1 : 2;
    t = next[axis];
    if (best !== null && best <= t) break;
    cell[axis] += step[axis];
    next[axis] += delta[axis];
  }
  return best;
}

/** Whether triangle abc's normal (counter-clockwise winding) points the way `f` does. */
function faces(P: Float32Array, a: number, b: number, c: number, f: Vec3): boolean {
  const e1x = (P[b * 3] as number) - (P[a * 3] as number);
  const e1y = (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number);
  const e1z = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
  const e2x = (P[c * 3] as number) - (P[a * 3] as number);
  const e2y = (P[c * 3 + 1] as number) - (P[a * 3 + 1] as number);
  const e2z = (P[c * 3 + 2] as number) - (P[a * 3 + 2] as number);
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  return nx * f[0] + ny * f[1] + nz * f[2] > 0;
}

/** Möller–Trumbore: the distance along `d` from `o` to triangle abc, or null. */
function rayTriangle(
  o: readonly [number, number, number],
  d: readonly [number, number, number],
  P: Float32Array,
  a: number,
  b: number,
  c: number,
): number | null {
  const ax = P[a * 3] as number;
  const ay = P[a * 3 + 1] as number;
  const az = P[a * 3 + 2] as number;
  const e1x = (P[b * 3] as number) - ax;
  const e1y = (P[b * 3 + 1] as number) - ay;
  const e1z = (P[b * 3 + 2] as number) - az;
  const e2x = (P[c * 3] as number) - ax;
  const e2y = (P[c * 3 + 1] as number) - ay;
  const e2z = (P[c * 3 + 2] as number) - az;
  const px = d[1] * e2z - d[2] * e2y;
  const py = d[2] * e2x - d[0] * e2z;
  const pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  const tx = o[0] - ax;
  const ty = o[1] - ay;
  const tz = o[2] - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const w = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (w < 0 || u + w > 1) return null;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}
