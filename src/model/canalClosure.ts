/**
 * A canal's opening closed at the skin (coordinator ruling, 2026-10-10;
 * docs/ARCHITECTURE.md, "A canal's closure"): the introitus a slit between the
 * minora, the anus a puckered short slit with radial folds, both closed at rest, with no cup and
 * no rim. A skin target authored on one figure cannot do it: every other body's loop
 * has its own shape, and the same displacement left the introitus 1.3 mm open on a
 * woman and the anus 0.8 mm on a man. So the closure is evaluated on each figure: its
 * own loop, as the skin's targets leave it, is moved onto the closed shape
 * (`closedLoop`), and the skin round it follows by fixed harmonic weights the pack
 * computes (`CanalClosureSpec.zone`).
 */
import type { CanalClosureSpec } from "../format/assetFormat.ts";

type Vec3 = readonly [number, number, number];

const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The frame of a canal along direction `d`: `across` the figure, and `front` square
 * to both, facing the figure's front (+z).
 */
export function frameAlong(d: Vec3): { across: Vec3; front: Vec3 } {
  const across = norm(cross(d, cross([1, 0, 0], d)));
  const f = norm(cross(across, d));
  const sign = f[2] >= 0 ? 1 : -1;
  return { across, front: [f[0] * sign, f[1] * sign, f[2] * sign] };
}

type LoopPart = { a: number; f: number; n: number };

/** The skin's centreline depth at `f`, halfway between the loop's two sides. */
function centrelineDepth(parts: readonly LoopPart[], f: number): number {
  let left: { a: number; n: number } | undefined;
  let right: { a: number; n: number } | undefined;
  const keep = (a: number, n: number) => {
    if (!left || a < left.a) left = { a, n };
    if (!right || a > right.a) right = { a, n };
  };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as LoopPart;
    const q = parts[(i + 1) % parts.length] as LoopPart;
    if (f < Math.min(p.f, q.f) - 1e-12 || f > Math.max(p.f, q.f) + 1e-12) continue;
    if (Math.abs(q.f - p.f) < 1e-12) {
      keep(p.a, p.n);
      keep(q.a, q.n);
    } else {
      const t = Math.min(1, Math.max(0, (f - p.f) / (q.f - p.f)));
      keep(p.a + t * (q.a - p.a), p.n + t * (q.n - p.n));
    }
  }
  if (!left || !right) throw new Error("the canal loop has no skin sides at its slit coordinate");
  return (left.n + right.n) / 2;
}

/**
 * The loop `loop` closed at the skin whose outward normal is `normal`, round the loop's
 * centre, into a slit front to back: across closed to `gap`, and front to back `length`
 * long, or as long as the loop when it is absent. Both sides meet on the skin's
 * centreline, whose depth is shortened with its place front to back. Keeping each
 * side's own depth closed only the across coordinate, leaving a gap along the normal.
 * (A loop closed to a point instead had no normal there: the strips fanned from it
 * turned against their vertices' normals, 54 of them round the anus.)
 */
export function closedLoop(
  loop: readonly Vec3[],
  normal: Vec3,
  gap: number,
  length?: number,
): Vec3[] {
  const centre: Vec3 = [0, 1, 2].map(
    (k) => loop.reduce((s, p) => s + (p[k] as number), 0) / loop.length,
  ) as unknown as Vec3;
  const d: Vec3 = [-normal[0], -normal[1], -normal[2]];
  const { across, front } = frameAlong(d);
  const parts = loop.map((p) => {
    const o: Vec3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    return { a: dot(o, across), f: dot(o, front), n: dot(o, d) };
  });
  const wide = Math.max(...parts.map((q) => Math.abs(q.a)));
  const long = Math.max(...parts.map((q) => Math.abs(q.f)));
  const k = wide > 0 ? gap / 2 / wide : 0;
  const kf = length === undefined || long === 0 ? 1 : Math.min(1, length / 2 / long);
  const kn = kf;
  return parts.map(({ a, f }) => {
    const n = centrelineDepth(parts, f);
    return [0, 1, 2].map(
      (i) =>
        (centre[i] as number) +
        k * a * (across[i] as number) +
        kf * f * (front[i] as number) +
        kn * n * (d[i] as number),
    ) as unknown as Vec3;
  });
}

/**
 * How much of its closure a canal takes at its target's weight `w`: all of it from
 * `CLOSED_FROM` up, so a canal is closed at the skin at every size it is drawn at,
 * and smoothly none at 0, where the reservoir is the skin. CHOICE.
 */
export const CLOSED_FROM = 0.1;

/** The share of a canal's closure at its target's weight (`CLOSED_FROM`). */
export function closureShare(w: number): number {
  const t = Math.min(1, Math.max(0, w / CLOSED_FROM));
  return t * t * (3 - 2 * t);
}

/**
 * The skin displacement that closes one canal on a figure, by region (detail)
 * index: its loop (`loopNow`, the loop's vertices as the skin's targets leave them,
 * in the spec's order) onto `closedLoop` of itself, the zone by its weights on the
 * loop's displacements, and the folds; all times `share` (`closureShare`).
 */
export function closureDisplacement(
  spec: CanalClosureSpec,
  loopNow: readonly Vec3[],
  share: number,
): { indices: number[]; xyz: number[] } {
  const closed = closedLoop(loopNow, spec.normal, spec.gap, spec.length);
  const g = loopNow.map((p, i) => {
    const q = closed[i] as Vec3;
    return [(q[0] - p[0]) * share, (q[1] - p[1]) * share, (q[2] - p[2]) * share] as const;
  });
  const indices: number[] = [];
  const xyz: number[] = [];
  spec.loopRegion.forEach((v, i) => {
    indices.push(v);
    xyz.push(...(g[i] as readonly [number, number, number]));
  });
  spec.zone.forEach((v, z) => {
    const d = [0, 0, 0];
    for (let e = spec.zoneStart[z] as number; e < (spec.zoneStart[z + 1] as number); e++) {
      const i = spec.zoneLoop[e] as number;
      const w = spec.zoneWeight[e] as number;
      const gi = g[i] as readonly [number, number, number];
      d[0] = (d[0] as number) + w * gi[0];
      d[1] = (d[1] as number) + w * gi[1];
      d[2] = (d[2] as number) + w * gi[2];
    }
    indices.push(v);
    xyz.push(d[0] as number, d[1] as number, d[2] as number);
  });
  if (spec.folds)
    spec.folds.indices.forEach((v, i) => {
      indices.push(v);
      xyz.push(
        (spec.folds?.xyz[i * 3] as number) * share,
        (spec.folds?.xyz[i * 3 + 1] as number) * share,
        (spec.folds?.xyz[i * 3 + 2] as number) * share,
      );
    });
  return { indices, xyz };
}
