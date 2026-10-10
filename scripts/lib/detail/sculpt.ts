/**
 * A part cut from a CC0 sculpt (`scripts/blender/cut_male.py`), placed on our
 * base and on the figure detail is authored against (docs/research/
 * ADULT-SCULPT-PLAN.md, section 6d, steps 1 and 2).
 *
 * A source's coordinates are those of whatever figure its author fitted it to,
 * not hm08 at rest. The asset's own binding (CC0, by its page) says where it sits
 * on our base: it is evaluated on our rest body, and a per-axis scale and
 * translation is fitted from the source to that, by least squares over the whole
 * asset, so the sculpt's form is kept and only placed. The placed part is then
 * bound to our base by our own regenerated binding (`bindToBody`) and evaluated on
 * the figure. The asset's binding is read only to place it and is never shipped.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { groupFaces, type HumanoidAssets } from "../../../src/format/assetFormat.ts";
import { type Bound, evaluateBinding } from "../../../src/mhclo/bound.ts";
import { parseMhclo } from "../../../src/mhclo/parse.ts";
import { MH_UNIT } from "../compileAsset.ts";
import { type BodyMesh, bindToBody } from "../hairCards/bind.ts";
import type { Vec3 } from "./disc.ts";

/** Where the sources live: outside the published pack's files and anything the site builds from. */
export const SCULPT_SOURCES = path.resolve(import.meta.dirname, "../../../packs/adult-anatomy/source");

/** A part on the figure: its surface, and its cut as an ordered loop of vertices. */
export interface SculptPart {
  /** xyz per vertex, metres, on the figure. */
  positions: Float64Array;
  /** Three vertex indices per triangle. */
  triangles: Uint32Array;
  /** The cut, in order: the part's one boundary loop. */
  boundary: number[];
}

interface Obj {
  positions: number[];
  faces: number[][];
}

/** An OBJ's positions (scaled from MakeHuman's decimetres to metres) and polygons. */
function readObj(file: string): Obj {
  const positions: number[] = [];
  const faces: number[][] = [];
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const w = raw.trim().split(/\s+/);
    if (w[0] === "v") positions.push(Number(w[1]) * MH_UNIT, Number(w[2]) * MH_UNIT, Number(w[3]) * MH_UNIT);
    else if (w[0] === "f") faces.push(w.slice(1).map((c) => Number(c.split("/")[0]) - 1));
  }
  return { positions, faces };
}

/** The ordered boundary loop of a disc's polygons; throws unless there is exactly one. */
export function boundaryLoop(faces: readonly (readonly number[])[]): number[] {
  const count = new Map<string, number>();
  const next = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const f of faces)
    for (let i = 0; i < f.length; i++) {
      const k = key(f[i] as number, f[(i + 1) % f.length] as number);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  for (const f of faces)
    for (let i = 0; i < f.length; i++) {
      const a = f[i] as number;
      const b = f[(i + 1) % f.length] as number;
      if (count.get(key(a, b)) === 1) next.set(a, b);
    }
  const start = next.keys().next().value;
  if (start === undefined) throw new Error("sculpt part: no boundary");
  const loop = [start];
  for (let v = next.get(start) as number; v !== start; v = next.get(v) as number) {
    loop.push(v);
    if (loop.length > next.size) throw new Error("sculpt part: the boundary is not one loop");
  }
  if (loop.length !== next.size) throw new Error("sculpt part: more than one boundary loop");
  return loop;
}

const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** The drawn body of these assets at rest, as a part is bound to it: its triangles and positions. */
export function restBody(assets: HumanoidAssets): BodyMesh {
  const triangles: number[] = [];
  for (const f of groupFaces(assets, "body")) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => assets.faceVerts[f * 4 + k] as number) as [
      number,
      number,
      number,
      number,
    ];
    triangles.push(a, b, c, a, c, d);
  }
  return { positions: assets.positions, triangles: Uint32Array.from(triangles) };
}

/** The source the male parts are cut from, and its parts. */
export const MALE_SOURCE = "man_genital";

/** The shaft and the sac of the male source, placed on the figure whose base positions are `figure`. */
export function maleParts(
  assets: HumanoidAssets,
  figure: Float32Array,
): { phallus: SculptPart; scrotum: SculptPart } {
  const body = restBody(assets);
  return {
    phallus: placeSculpt(MALE_SOURCE, "phallus", body, figure),
    scrotum: placeSculpt(MALE_SOURCE, "scrotum", body, figure),
  };
}

/** The centre of a part's cut. */
export function cutCentre(part: SculptPart): Vec3 {
  const m = part.boundary.length;
  const c = [0, 0, 0];
  for (const v of part.boundary)
    for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (part.positions[v * 3 + k] as number) / m;
  return c as unknown as Vec3;
}

/** The way a part leaves the body: the unit vector from its cut's centre to its own centre. */
export function partAxis(part: SculptPart): Vec3 {
  const n = part.positions.length / 3;
  const c = cutCentre(part);
  const d = [0, 0, 0];
  for (let v = 0; v < n; v++)
    for (let k = 0; k < 3; k++)
      d[k] = (d[k] as number) + ((part.positions[v * 3 + k] as number) - (c[k] as number)) / n;
  const l = Math.hypot(d[0] as number, d[1] as number, d[2] as number);
  return [(d[0] as number) / l, (d[1] as number) / l, (d[2] as number) / l];
}

/** The cut's points, in order. */
export const cutOutline = (part: SculptPart): Vec3[] =>
  part.boundary.map((v) => [
    part.positions[v * 3] as number,
    part.positions[v * 3 + 1] as number,
    part.positions[v * 3 + 2] as number,
  ]);

/**
 * The per-axis scale and translation that takes the source's coordinates to where
 * its own binding places it on our rest body: `[a, b]` per axis, x' = a x + b.
 */
export function sourceFit(asset: string, rest: Float32Array): [number, number][] {
  const dir = path.join(SCULPT_SOURCES, asset);
  const binding = parseMhclo(fs.readFileSync(path.join(dir, `${asset}.mhclo`), "utf8"));
  const obj = readObj(path.join(dir, binding.objFile));
  const n = obj.positions.length / 3;
  const s = binding.scale;
  const bound: Bound = {
    refVerts: binding.refVerts,
    weights: binding.weights,
    offsets: binding.offsets.map((o) => o * MH_UNIT),
    entry: {
      vertexCount: n,
      scale: s
        ? {
            x: [s.x.v1, s.x.v2, s.x.reference * MH_UNIT],
            y: [s.y.v1, s.y.v2, s.y.reference * MH_UNIT],
            z: [s.z.v1, s.z.v2, s.z.reference * MH_UNIT],
          }
        : null,
    },
  };
  const placed = evaluateBinding(bound, rest, new Float32Array(n * 3));
  return [0, 1, 2].map((k) => {
    let mx = 0;
    let my = 0;
    for (let i = 0; i < n; i++) {
      mx += (obj.positions[i * 3 + k] as number) / n;
      my += (placed[i * 3 + k] as number) / n;
    }
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      const dx = (obj.positions[i * 3 + k] as number) - mx;
      sxy += dx * ((placed[i * 3 + k] as number) - my);
      sxx += dx * dx;
    }
    const a = sxy / sxx;
    return [a, my - a * mx] as [number, number];
  });
}

/**
 * Part `part` of source `asset`, placed on the figure whose base positions are
 * `figure`. `body` is our base at rest: the triangles of the drawn body, and the
 * rest positions both the asset's binding and ours are evaluated against.
 */
export function placeSculpt(
  asset: string,
  part: string,
  body: BodyMesh,
  figure: Float32Array,
): SculptPart {
  const dir = path.join(SCULPT_SOURCES, asset);
  const cuts = JSON.parse(fs.readFileSync(path.join(dir, "cuts.json"), "utf8")) as {
    source: string;
    sha256: string;
    parts: Record<string, { disc: boolean }>;
  };
  const source = path.join(dir, cuts.source);
  if (sha256(source) !== cuts.sha256)
    throw new Error(`sculpt ${asset}: ${cuts.source} is not the file its parts were cut from`);
  if (!cuts.parts[part]?.disc) throw new Error(`sculpt ${asset}: part ${part} was not cut as a disc`);
  const obj = readObj(path.join(dir, `${part}.obj`));
  const fit = sourceFit(asset, body.positions);
  const atRest = Float32Array.from(obj.positions, (x, i) => {
    const [a, b] = fit[i % 3] as [number, number];
    return a * x + b;
  });
  const ours = bindToBody(atRest, body);
  const n = atRest.length / 3;
  const onFigure = evaluateBinding(
    { ...ours, entry: { vertexCount: n, scale: null } },
    figure,
    new Float32Array(n * 3),
  );
  const triangles: number[] = [];
  for (const f of obj.faces)
    for (let i = 1; i + 1 < f.length; i++) triangles.push(f[0] as number, f[i] as number, f[i + 1] as number);
  return {
    positions: Float64Array.from(onFigure),
    triangles: Uint32Array.from(triangles),
    boundary: boundaryLoop(obj.faces),
  };
}

/** Rows of vertices a skirt adds between a part's cut and where it lands. */
export const SKIRT_ROWS = 6;
/** Gauss-Seidel sweeps that relax a skirt to its membrane. */
const SKIRT_RELAX = 400;

/**
 * The part with a skirt from its cut to where each cut vertex lands (`landing`,
 * by the vertex's place in the boundary): a sculpt fitted to a body of another
 * shape does not meet ours at its cut. Each cut vertex is carried on a quadratic
 * curve that leaves the cut along the sculpt's own surface (the way from the
 * vertices inside it to the cut, so the part continues smoothly) and ends at its
 * landing. The skirt's last row is the new boundary, in the cut's order.
 */
export function withSkirt(part: SculptPart, landing: (i: number) => Vec3): SculptPart {
  const P = part.positions;
  const at = (v: number): Vec3 => [P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number];
  const onCut = new Set(part.boundary);
  // Each cut vertex's neighbours inside the part.
  const inner = new Map<number, Set<number>>();
  const T = part.triangles;
  for (let t = 0; t < T.length; t += 3)
    for (let c = 0; c < 3; c++) {
      const a = T[t + c] as number;
      if (!onCut.has(a)) continue;
      for (const b of [T[t + ((c + 1) % 3)] as number, T[t + ((c + 2) % 3)] as number]) {
        if (onCut.has(b)) continue;
        let s = inner.get(a);
        if (!s) inner.set(a, (s = new Set()));
        s.add(b);
      }
    }
  const count = P.length / 3;
  const m = part.boundary.length;
  const rows: Vec3[][] = Array.from({ length: SKIRT_ROWS }, () => []);
  // The way out of the part at each cut vertex; one whose neighbours are all on the
  // cut takes the nearest along the cut that has one.
  const ways: (Vec3 | null)[] = part.boundary.map((v) => {
    const c = at(v);
    const ins = [...(inner.get(v) ?? [])].map(at);
    if (!ins.length) return null;
    const out: Vec3 = [
      c[0] - ins.reduce((s, p) => s + p[0], 0) / ins.length,
      c[1] - ins.reduce((s, p) => s + p[1], 0) / ins.length,
      c[2] - ins.reduce((s, p) => s + p[2], 0) / ins.length,
    ];
    const ol = Math.hypot(...out);
    return [out[0] / ol, out[1] / ol, out[2] / ol];
  });
  if (ways.every((w) => !w)) throw new Error("sculpt part: no vertex of its cut has a neighbour inside it");
  const wayAt = (i: number): Vec3 => {
    for (let step = 0; step < m; step++)
      for (const j of [i + step, i - step]) {
        const w = ways[((j % m) + m) % m];
        if (w) return w;
      }
    throw new Error("unreachable");
  };
  part.boundary.forEach((v, i) => {
    const c = at(v);
    const d = wayAt(i);
    const s = landing(i);
    const h = Math.hypot(c[0] - s[0], c[1] - s[1], c[2] - s[2]) / 2;
    const q: Vec3 = [c[0] + d[0] * h, c[1] + d[1] * h, c[2] + d[2] * h];
    for (let r = 0; r < SKIRT_ROWS; r++) {
      // Row 0 is on the skin; the curve reaches the cut (t = 1) at the part's own vertex.
      const t = r / SKIRT_ROWS;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const e = t * t;
      (rows[r] as Vec3[]).push([
        a * s[0] + b * q[0] + e * c[0],
        a * s[1] + b * q[1] + e * c[1],
        a * s[2] + b * q[2] + e * c[2],
      ]);
    }
  });
  // Relax the rows between the landing (row 0) and the cut to a membrane: each is
  // the mean of its four neighbours. A harmonic strip neither overshoots nor folds,
  // which the curves alone do where the cut's sliver faces give its vertices
  // directions that disagree.
  const grid: Vec3[][] = [...rows, part.boundary.map(at)];
  for (let it = 0; it < SKIRT_RELAX; it++)
    for (let r = 1; r < SKIRT_ROWS; r++) {
      const row = grid[r] as Vec3[];
      const below = grid[r - 1] as Vec3[];
      const above = grid[r + 1] as Vec3[];
      for (let i = 0; i < m; i++) {
        const l = row[(i + m - 1) % m] as Vec3;
        const rr = row[(i + 1) % m] as Vec3;
        const b = below[i] as Vec3;
        const a = above[i] as Vec3;
        row[i] = [
          (l[0] + rr[0] + b[0] + a[0]) / 4,
          (l[1] + rr[1] + b[1] + a[1]) / 4,
          (l[2] + rr[2] + b[2] + a[2]) / 4,
        ];
      }
    }
  const positions = new Float64Array((count + SKIRT_ROWS * m) * 3);
  positions.set(P);
  grid.slice(0, SKIRT_ROWS).forEach((row, r) =>
    row.forEach((p, i) => {
      positions.set(p, (count + r * m + i) * 3);
    }),
  );
  const index = (r: number, i: number) =>
    r === SKIRT_ROWS ? (part.boundary[i % m] as number) : count + r * m + (i % m);
  const triangles = Array.from(part.triangles);
  // The cut runs a -> b with the part on one side; the skirt's quads run the other way.
  for (let r = 0; r < SKIRT_ROWS; r++)
    for (let i = 0; i < m; i++) {
      const a1 = index(r + 1, i);
      const b1 = index(r + 1, i + 1);
      const a0 = index(r, i);
      const b0 = index(r, i + 1);
      triangles.push(b1, a1, a0, b1, a0, b0);
    }
  return {
    positions,
    triangles: Uint32Array.from(triangles),
    boundary: Array.from({ length: m }, (_, i) => count + i),
  };
}
