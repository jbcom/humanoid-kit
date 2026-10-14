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
 * How far a render vertex follows its canal's closed opening
 * (`ReservoirSkinning.closure.follows`) from which it is one of the opening's lips: the
 * loop itself, which follows it whole.
 */
export const LIP = 0.999;

/**
 * Shades a closed canal's lips as the crease they meet in (#77), in place on `normals`
 * (a body surface's, unit, xyz per render vertex). Closed, the two lips meet on one
 * line, but each lip vertex has its normal from its own side's faces alone, which face
 * across the slit: along it the normals alternated side to side, as much as 175 degrees
 * apart, a beaded rope of glints. Each lip's normal is instead the mean of its own and
 * those of the lips round it on both sides, by a Gaussian of their distance as the
 * closure places them (its width the loop's mean spacing along one side, so the
 * lips across the slit and the next ones along it count, the far end not), as far
 * as the canal is closed (`shares`, by canal, `closureShare`).
 */
export function closedLipNormals(
  closure: { canal: Int16Array; follows: Float32Array },
  shares: readonly number[],
  positions: Float32Array,
  normals: Float32Array,
): void {
  const lips = new Map<number, number[]>();
  closure.canal.forEach((c, v) => {
    if (c < 0 || !((shares[c] ?? 0) > 0) || (closure.follows[v] as number) < LIP) return;
    lips.set(c, [...(lips.get(c) ?? []), v]);
  });
  const at = (v: number): Vec3 => [
    positions[v * 3] as number,
    positions[v * 3 + 1] as number,
    positions[v * 3 + 2] as number,
  ];
  for (const [c, vs] of lips) {
    if (vs.length < 2) continue;
    let far = 0;
    for (const v of vs)
      for (const u of vs) {
        const a = at(v);
        const b = at(u);
        far = Math.max(far, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    // Each side of a slit `far` long has half the loop's vertices along it.
    const width = far / (vs.length / 2);
    if (!(width > 0)) continue;
    const share = shares[c] as number;
    const mixed = vs.map((v) => {
      const a = at(v);
      const n = [0, 0, 0];
      for (const u of vs) {
        const b = at(u);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / width;
        const w = Math.exp(-d * d);
        for (let k = 0; k < 3; k++) n[k] = (n[k] as number) + w * (normals[u * 3 + k] as number);
      }
      const own: Vec3 = [
        normals[v * 3] as number,
        normals[v * 3 + 1] as number,
        normals[v * 3 + 2] as number,
      ];
      const m = norm(n as unknown as Vec3);
      return norm([
        own[0] + share * (m[0] - own[0]),
        own[1] + share * (m[1] - own[1]),
        own[2] + share * (m[2] - own[2]),
      ]);
    });
    vs.forEach((v, i) => {
      normals.set(mixed[i] as Vec3, v * 3);
    });
  }
}

/**
 * How fast a closed canal's crease shade falls off from its lips across the closure's
 * zone (`closedLipShade`): the power of how far each vertex follows the closed opening.
 * The zone is a few millimetres round (`CanalForm.closure.zone`); at 4 the shade is a
 * sixteenth by halfway across it, so it stays a line. CHOICE, judged on renders.
 */
export const CLOSED_LIP_SHADE_POWER = 4;

/**
 * The share of its light a closed canal's lips lose where they meet, and its walls
 * lose inside it (`closedLipShade`). The lips touch, so little light reaches the line
 * between them; the walls are inside the body, lit only through the opening. CHOICE,
 * judged on renders (#77): at 0.6 the lips' line is dark without a black rim; walls
 * that lost as much still showed a pale slot where a pose parts the opening.
 */
export const CANAL_DARK = { lips: 0.6, walls: 0.92 } as const;

/**
 * The light a closed canal keeps out (#77): per render vertex, into `out`, the share
 * of its light it loses. On the lips and the skin round them, `CANAL_DARK.lips` times
 * `share` of the canal times how far it follows the closed opening
 * (`ReservoirSkinning.closure.follows`) to `CLOSED_LIP_SHADE_POWER`: a real closed slit
 * is a thin dark line, which the surface alone cannot show (its lips meet on one line
 * with one normal, `closedLipNormals`, and the body's occlusion is baked once for every
 * figure, with no canal closed), so each figure's occlusion takes this in
 * (`creasedOcclusion`). On the canal's own walls (`walls`, each render vertex's canal
 * reservoir or -1, `AdultSurfaceTopology.canals.of`), `CANAL_DARK.walls` times `share`:
 * baked with the canal collapsed on the skin, they were lit as open skin, a pale strip
 * down the slit at rest and a pale slot where a pose parts it. A canal not drawn
 * (`shares` 0) loses none: its loop is skin.
 */
export function closedLipShade(
  closure: { canal: Int16Array; follows: Float32Array },
  walls: Int16Array,
  shares: readonly number[],
  out: Float32Array,
): Float32Array {
  out.fill(0);
  closure.canal.forEach((c, v) => {
    if (c < 0) return;
    const share = shares[c] ?? 0;
    if (!(share > 0)) return;
    out[v] = CANAL_DARK.lips * share * (closure.follows[v] as number) ** CLOSED_LIP_SHADE_POWER;
  });
  walls.forEach((c, v) => {
    if (c < 0) return;
    out[v] = Math.max(out[v] as number, CANAL_DARK.walls * (shares[c] ?? 0));
  });
  return out;
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
