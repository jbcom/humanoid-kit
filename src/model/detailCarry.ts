/**
 * An organ carried by its loop (docs/ARCHITECTURE.md, "Reservoir skinning"): the
 * detail a reservoir draws is authored on one figure (`AdultDetailSpec.authoredOn`),
 * as displacements of the lattice vertices under it. Added to another figure's own
 * skin there, the organ took on that skin's shape: a body morph moves the skin
 * inside a reservoir's loop by up to 5 mm more than it moves the loop (the sac's,
 * from the default figure to a heavy man), and the sculpt's notch between the sac's
 * lobes deepened from 11% of its width to 17% on a man. An organ is not the skin it
 * was drawn from, and moves with where it is rooted: a vertex pushed out of the
 * skin is placed where the authoring figure's skin plus its displacement put it,
 * carried rigidly from that figure's loop to this one's (`rigidFit`), in proportion
 * to how far it is pushed (`CARRIED_FROM` to `CARRIED_FULLY`). A vertex nothing pushes stays on this
 * figure's skin, so a reservoir with no organ is the skin exactly.
 */
import type { SurfaceDetail, SurfaceLattice } from "../build/surfaceMesh.ts";
import type { Stencil } from "../subdiv/catmullClark.ts";

/**
 * How far out of the skin (metres) a vertex is pushed before its position starts
 * to be its organ's, carried from the authoring figure, and how far when it is
 * entirely so. CHOICE, measured on the smoke tier: carried from the skin up (0 to
 * 5 mm) the root's first millimetres jumped between the figure's skin and the
 * carried organ and the men's rows inverted 66 to 116 more triangles; from 5 to
 * 20 mm their inverted counts are as before, and the sac's notch is held on every
 * body (11.5 to 12.1% of its width against the authoring figure's 11.8).
 */
export const CARRIED_FROM = 0.005;
/** See `CARRIED_FROM`. */
export const CARRIED_FULLY = 0.02;

/** One reservoir's vertices as the carriage reads them, in lattice and detail numbering. */
export interface ReservoirCarriage {
  /** The loop's lattice vertices, in order: what the fit is taken on. */
  loop: Uint32Array;
  /** The detail indices an organ drawn from this reservoir moves: its rings', then its cap's interior. */
  members: Uint32Array;
  /** Per member, the lattice vertex it lies on at rest (a ring copy on its loop vertex, a cap vertex on itself). */
  restOn: Uint32Array;
}

/** Each reservoir's carriage, from the lattice and the specs it was built from (`loop` and `cap` of each). */
export function reservoirCarriages(
  lattice: SurfaceLattice,
  specs: readonly { loop: readonly number[]; cap: readonly number[] }[],
): ReservoirCarriage[] {
  const regionIndex = new Map<number, number>();
  lattice.region.forEach((v, i) => {
    regionIndex.set(v, i);
  });
  const poly = lattice.polygons;
  return lattice.reservoirs.map((r, s) => {
    const spec = specs[s];
    if (!spec) throw new Error(`reservoir ${s} has no spec`);
    const n = r.loop.length;
    const members: number[] = [];
    const restOn: number[] = [];
    for (let j = 0; j < r.rings; j++)
      for (let i = 0; i < n; i++) {
        members.push(r.base + j * n + i);
        restOn.push(r.loop[i] as number);
      }
    const inLoop = new Set(spec.loop);
    const cap = new Set(spec.cap);
    const interior = new Set<number>();
    for (let p = 0; p + 1 < poly.start.length; p++) {
      if (!cap.has(poly.id[p] as number)) continue;
      for (let c = poly.start[p] as number; c < (poly.start[p + 1] as number); c++) {
        const v = poly.vertices[c] as number;
        if (!inLoop.has(v)) interior.add(v);
      }
    }
    for (const v of [...interior].sort((a, b) => a - b)) {
      const index = regionIndex.get(v);
      if (index === undefined)
        throw new Error(`reservoir ${s}: cap vertex ${v} is not in the region`);
      members.push(index);
      restOn.push(v);
    }
    return {
      loop: Uint32Array.from(r.loop),
      members: Uint32Array.from(members),
      restOn: Uint32Array.from(restOn),
    };
  });
}

/** The lattice positions of `vertices` from control positions `control`, by the lattice's stencil rows (xyz per vertex). */
export function latticePositions(
  stencil: Stencil,
  control: ArrayLike<number>,
  vertices: ArrayLike<number>,
): Float64Array {
  const out = new Float64Array(vertices.length * 3);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i] as number;
    for (let e = stencil.offsets[v] as number; e < (stencil.offsets[v + 1] as number); e++) {
      const s = stencil.src[e] as number;
      const w = stencil.weights[e] as number;
      for (let k = 0; k < 3; k++)
        out[i * 3 + k] = (out[i * 3 + k] as number) + w * (control[s * 3 + k] as number);
    }
  }
  return out;
}

/** A rigid motion: `apply(p)` is `R p + t`. */
export interface RigidMotion {
  rotation: Float64Array;
  translation: Float64Array;
}

/**
 * The rigid motion (no scale: the organ keeps its measured size) taking points `from`
 * onto `to` in least squares, xyz per point: Horn's quaternion method, its largest
 * eigenvector found by power iteration on the shifted 4x4 matrix.
 */
export function rigidFit(from: ArrayLike<number>, to: ArrayLike<number>): RigidMotion {
  const n = from.length / 3;
  const ca = [0, 0, 0];
  const cb = [0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      ca[k] = (ca[k] as number) + (from[i * 3 + k] as number) / n;
      cb[k] = (cb[k] as number) + (to[i * 3 + k] as number) / n;
    }
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++)
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        S[r * 3 + c] =
          (S[r * 3 + c] as number) +
          ((from[i * 3 + r] as number) - (ca[r] as number)) *
            ((to[i * 3 + c] as number) - (cb[c] as number));
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const shift = 4 * Math.max(1e-30, ...N.flat().map(Math.abs));
  let q = [1, 0, 0, 0];
  for (let it = 0; it < 200; it++) {
    const next = N.map(
      (row, r) => row.reduce((s, x, c) => s + x * (q[c] as number), 0) + shift * (q[r] as number),
    );
    const l = Math.hypot(...next);
    q = next.map((x) => x / l);
  }
  const [w, x, y, z] = q as [number, number, number, number];
  const rotation = Float64Array.from([
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ]);
  const translation = Float64Array.from([0, 1, 2], (r) => {
    let rc = 0;
    for (let c = 0; c < 3; c++) rc += (rotation[r * 3 + c] as number) * (ca[c] as number);
    return (cb[r] as number) - rc;
  });
  return { rotation, translation };
}

/** Smoothstep of `t` clamped to 0..1. */
const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * `detail` (summed per index) with each reservoir member's displacement carried:
 * the figure's skin under it is `figure`'s, the authoring figure's `authored`, both
 * by lattice vertex; a member pushed `d = |delta|` takes, in proportion
 * smoothly from `CARRIED_FROM` to `CARRIED_FULLY`, the authored skin plus its delta moved by
 * the rigid fit of the authored loop onto this figure's. Indices outside every
 * reservoir keep their delta.
 */
export function carriedDetail(
  detail: SurfaceDetail,
  carriages: readonly ReservoirCarriage[],
  authored: (latticeVertex: number) => readonly [number, number, number],
  figure: (latticeVertex: number) => readonly [number, number, number],
): SurfaceDetail {
  const sum = new Map<number, [number, number, number]>();
  for (let i = 0; i < detail.indices.length; i++) {
    const index = detail.indices[i] as number;
    const d = sum.get(index) ?? [0, 0, 0];
    d[0] += detail.xyz[i * 3] as number;
    d[1] += detail.xyz[i * 3 + 1] as number;
    d[2] += detail.xyz[i * 3 + 2] as number;
    sum.set(index, d);
  }
  for (const c of carriages) {
    const members = Array.from(c.members, (m, j) => [m, c.restOn[j] as number] as const).filter(
      ([m]) => sum.has(m),
    );
    if (!members.length) continue;
    // Fitted on the loop alone: fitted on the cap's skin too, the men's rows were no better.
    const from = new Float64Array(c.loop.length * 3);
    const to = new Float64Array(c.loop.length * 3);
    c.loop.forEach((v, i) => {
      from.set(authored(v), i * 3);
      to.set(figure(v), i * 3);
    });
    const { rotation: R, translation: t } = rigidFit(from, to);
    for (const [m, v] of members) {
      const d = sum.get(m) as [number, number, number];
      const e = smooth((Math.hypot(...d) - CARRIED_FROM) / (CARRIED_FULLY - CARRIED_FROM));
      if (e <= 0) continue;
      const a = authored(v);
      const f = figure(v);
      const p = [a[0] + d[0], a[1] + d[1], a[2] + d[2]] as const;
      const carried = [0, 1, 2].map(
        (k) =>
          (R[k * 3] as number) * p[0] +
          (R[k * 3 + 1] as number) * p[1] +
          (R[k * 3 + 2] as number) * p[2] +
          (t[k] as number) -
          (f[k] as number),
      ) as [number, number, number];
      sum.set(m, [
        (1 - e) * d[0] + e * carried[0],
        (1 - e) * d[1] + e * carried[1],
        (1 - e) * d[2] + e * carried[2],
      ]);
    }
  }
  const indices = [...sum.keys()];
  const xyz = new Float32Array(indices.length * 3);
  indices.forEach((index, i) => {
    xyz.set(sum.get(index) as [number, number, number], i * 3);
  });
  return { indices, xyz };
}
