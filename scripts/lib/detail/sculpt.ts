/**
 * A part cut from a CC0 sculpt (`scripts/blender/cut_male.py`), placed on our
 * base and on the figure detail is authored against (docs/research/
 * ADULT-SCULPT-PLAN.md, section 6d, steps 1 and 2).
 *
 * A source's coordinates are those of whatever figure its author fitted it to,
 * not hm08 at rest. The asset's own binding (CC0, by its page) says where it sits
 * on our base: it is evaluated on our rest body, and a per-axis scale and
 * translation is fitted from the source to that, by least squares over the whole
 * asset, so the sculpt's form is kept and only placed. The placed parts' cuts are
 * then bound to our base by our own regenerated binding (`bindToBody`) and
 * evaluated on the figure, and the parts of one sculpt are carried there together
 * by the rigid motion (a turn and a move) that best takes their cuts along.
 * The asset's binding is read only to place it and is never shipped.
 *
 * Only the cut is bound. A part hangs clear of the body, and binding each of its
 * vertices to the skin nearest it ties the front of a sac to the groin, its sides to
 * the thighs and its back to the perineum; on a figure whose thighs and groin moved
 * apart from rest, those pieces went with them and tore the sac into strips.
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
import { applySimilarity, fitRigid } from "./similarity.ts";

/** Where the sources live: outside the published pack's files and anything the site builds from. */
export const SCULPT_SOURCES = path.resolve(
  import.meta.dirname,
  "../../../packs/adult-anatomy/source",
);

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

/**
 * An OBJ's positions (scaled from MakeHuman's decimetres to metres) and polygons. A
 * source authored in metres comes out ten times small here, which its fit undoes:
 * the fit's per-axis scale is taken against where its binding puts it on our body.
 */
function readObj(file: string): Obj {
  const positions: number[] = [];
  const faces: number[][] = [];
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const w = raw.trim().split(/\s+/);
    if (w[0] === "v")
      positions.push(Number(w[1]) * MH_UNIT, Number(w[2]) * MH_UNIT, Number(w[3]) * MH_UNIT);
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

/**
 * The sources the male parts are cut from: the flaccid shaft and the sac from one
 * sculpt, the erect shaft from another (docs/research/ADULT-SCULPT-PLAN.md, 6e).
 */
export const MALE_SOURCES = {
  flaccid: "adult_male_genitalia_breast_fix",
  erect: "Male_Gen-Heal1",
} as const;

/** The male parts, placed on the figure whose base positions are `figure`. */
export interface MaleParts {
  /** The shaft, glans and corona as they hang, and as they rise erect. */
  phallus: { flaccid: SculptPart; erect: SculptPart };
  scrotum: SculptPart;
}

/**
 * The male sources' parts, placed on the figure whose base positions are `figure`.
 * Each sculpt is placed where its own author's figure had it, and two authors put
 * the root in different places (Heal1's erect root sits about 4 cm higher and 3 cm
 * further forward than the flaccid one's). One organ has one root, so the erect
 * shaft is moved, without turning or reshaping it, until its cut is centred on the
 * flaccid shaft's.
 */
export function maleParts(assets: HumanoidAssets, figure: Float32Array): MaleParts {
  const body = restBody(assets);
  const [flaccid, scrotum] = placeSculpt(
    MALE_SOURCES.flaccid,
    ["phallus", "scrotum"],
    body,
    figure,
  ) as [SculptPart, SculptPart];
  const [erect] = placeSculpt(MALE_SOURCES.erect, ["phallus"], body, figure) as [SculptPart];
  return { phallus: { flaccid, erect: movedTo(erect, cutCentre(flaccid)) }, scrotum };
}

/** The part moved, without turning, so its cut is centred on `centre`. */
export function movedTo(part: SculptPart, centre: Vec3): SculptPart {
  const c = cutCentre(part);
  const d = [centre[0] - c[0], centre[1] - c[1], centre[2] - c[2]];
  return {
    ...part,
    positions: Float64Array.from(part.positions, (x, i) => x + (d[i % 3] as number)),
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
  // A clothes piece's binding is a .mhclo, a whole-body proxy's a .proxy: one format.
  const file = [".mhclo", ".proxy"]
    .map((ext) => path.join(dir, `${asset}${ext}`))
    .find((f) => fs.existsSync(f));
  if (!file) throw new Error(`sculpt ${asset}: no .mhclo or .proxy binding`);
  const binding = parseMhclo(fs.readFileSync(file, "utf8"));
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
 * Parts `names` of source `asset`, placed together on the figure whose base positions
 * are `figure`, in the order named. `body` is our base at rest: the triangles of the
 * drawn body, and the rest positions both the asset's binding and ours are evaluated
 * against.
 */
export function placeSculpt(
  asset: string,
  names: readonly string[],
  body: BodyMesh,
  figure: Float32Array,
): SculptPart[] {
  const dir = path.join(SCULPT_SOURCES, asset);
  const cuts = JSON.parse(fs.readFileSync(path.join(dir, "cuts.json"), "utf8")) as {
    source: string;
    sha256: string;
    parts: Record<string, { disc: boolean }>;
  };
  const source = path.join(dir, cuts.source);
  if (sha256(source) !== cuts.sha256)
    throw new Error(`sculpt ${asset}: ${cuts.source} is not the file its parts were cut from`);
  const fit = sourceFit(asset, body.positions);
  const point = (p: ArrayLike<number>, v: number): Vec3 => [
    p[v * 3] as number,
    p[v * 3 + 1] as number,
    p[v * 3 + 2] as number,
  ];
  const parts = names.map((name) => {
    if (!cuts.parts[name]?.disc)
      throw new Error(`sculpt ${asset}: part ${name} was not cut as a disc`);
    const obj = readObj(path.join(dir, `${name}.obj`));
    const atRest = Float32Array.from(obj.positions, (x, i) => {
      const [a, b] = fit[i % 3] as [number, number];
      return a * x + b;
    });
    return { obj, atRest, boundary: boundaryLoop(obj.faces) };
  });
  // Each cut is bound to our base, offsets and all, and carried to the figure, and the
  // parts follow together by the one rigid motion that best carries all their cuts
  // there: they are one sculpt, and a sac placed by its own cut and a shaft by its own
  // came apart, the sac's neck 3 mm further from the shaft's root than its author put
  // it. The motion keeps the sculpt's size, which is the keys' to set (`phallus.ts`,
  // `scrotum.ts`, sized from the sculpt's own measures): the figure's skin stretches
  // unevenly under the two cuts (the shaft's ring by 37 %, the sac's by 1 %), and one
  // scale fitted to both, 1.15, swelled the sac into the groin's creases, where its
  // flanks folded. Binding a cut without its offsets, onto the
  // skin, does not seat it better: the fit leaves the sac's cut 6 to 16 mm off our skin
  // in the groin's corner, and the nearest skin to a ring sunk there is a distorted ring,
  // which turned the sac by 20 degrees and the erect shaft by 13 more than the figure
  // does. What is left under the skin is mended at the root (`transfer.ts`, `seatedOn`).
  const from: Vec3[] = [];
  const to: Vec3[] = [];
  for (const { atRest, boundary } of parts) {
    const cutAtRest = Float32Array.from(boundary.flatMap((v) => point(atRest, v)));
    const m = boundary.length;
    const cutOnFigure = evaluateBinding(
      { ...bindToBody(cutAtRest, body), entry: { vertexCount: m, scale: null } },
      figure,
      new Float32Array(m * 3),
    );
    boundary.forEach((_, i) => {
      from.push(point(cutAtRest, i));
      to.push(point(cutOnFigure, i));
    });
  }
  const carry = fitRigid(from, to);
  return parts.map(({ obj, atRest, boundary }) => {
    const n = atRest.length / 3;
    const positions = new Float64Array(n * 3);
    for (let v = 0; v < n; v++) positions.set(applySimilarity(carry, point(atRest, v)), v * 3);
    const triangles: number[] = [];
    for (const f of obj.faces)
      for (let i = 1; i + 1 < f.length; i++)
        triangles.push(f[0] as number, f[i] as number, f[i + 1] as number);
    return { positions, triangles: Uint32Array.from(triangles), boundary };
  });
}

/**
 * The part's vertices under the skin (`depth` below zero) in the region that reaches
 * its cut, one byte each: what `trimmedUnder` cuts away.
 */
export function underRoot(part: SculptPart, depth: (p: Vec3) => number): Uint8Array {
  const P = part.positions;
  const T = part.triangles;
  const count = P.length / 3;
  const depthOf = (v: number) =>
    depth([P[v * 3] as number, P[v * 3 + 1] as number, P[v * 3 + 2] as number]);
  const around: number[][] = Array.from({ length: count }, () => []);
  for (let t = 0; t < T.length; t += 3)
    for (let c = 0; c < 3; c++)
      (around[T[t + c] as number] as number[]).push(T[t + ((c + 1) % 3)] as number);
  const under = new Uint8Array(count);
  const queue = part.boundary.filter((v) => depthOf(v) < 0);
  for (const v of queue) under[v] = 1;
  while (queue.length) {
    const v = queue.pop() as number;
    for (const w of around[v] as number[])
      if (!under[w] && depthOf(w) < 0) {
        under[w] = 1;
        queue.push(w);
      }
  }
  return under;
}

/** How near an end of an edge its crossing of the skin may fall, as a share of the edge (`trimmedUnder`). */
const TRIM_END = 0.02;

/**
 * The part cut again where it comes out of the skin: the region under the skin
 * (`depth` below zero) that reaches the cut is removed, each triangle across its edge
 * cut where the depth along each edge is zero, and the new cut runs along that line
 * (and along the old cut where it was out of the skin already). The mesh is
 * compacted; it must still be one disc.
 *
 * A sculpt's cut is where its author's figure's skin was, and placed on ours it is
 * tilted against our skin: the flaccid shaft's is 12 mm under at the front of the
 * root and level at the back, the sac's 7 to 16 mm under all round. What is under our
 * skin is inside the body and never seen. Moved out until none of it is under, the
 * part stood a centimetre off the skin where its cut had been level with it, and its
 * rim was a shelf round the root; turned to lie on the skin, the organ's whole hang
 * turned with it. Cut where it comes out, it meets the skin all round where it is.
 * Only the region joined to the cut is removed (`underRoot`, or `under` as given).
 */
export function trimmedUnder(
  part: SculptPart,
  depth: (p: Vec3) => number,
  under: Uint8Array = underRoot(part, depth),
): SculptPart {
  const P = part.positions;
  const T = part.triangles;
  const count = P.length / 3;
  const at = (v: number): Vec3 => [
    P[v * 3] as number,
    P[v * 3 + 1] as number,
    P[v * 3 + 2] as number,
  ];
  const depths = new Map<number, number>();
  const depthOf = (v: number) => {
    const known = depths.get(v);
    if (known !== undefined) return known;
    const d = depth(at(v));
    depths.set(v, d);
    return d;
  };
  if (!under.some((u) => u)) return part;
  const positions: number[] = [];
  const index = new Int32Array(count).fill(-1);
  const keep = (v: number) => {
    if ((index[v] as number) < 0) {
      index[v] = positions.length / 3;
      positions.push(...at(v));
    }
    return index[v] as number;
  };
  const crossings = new Map<string, number>();
  /** Where the skin crosses the edge from kept `k` to removed `r`. */
  const crossing = (k: number, r: number) => {
    const key = `${k}:${r}`;
    let i = crossings.get(key);
    if (i === undefined) {
      const dk = depthOf(k);
      const t = Math.min(1 - TRIM_END, Math.max(TRIM_END, dk / (dk - depthOf(r))));
      const p = at(k);
      const q = at(r);
      i = positions.length / 3;
      positions.push(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t);
      crossings.set(key, i);
    }
    return i;
  };
  const faces: number[][] = [];
  for (let t = 0; t < T.length; t += 3) {
    const tri = [T[t], T[t + 1], T[t + 2]] as number[];
    const gone = tri.map((v) => under[v] === 1);
    if (gone.every((g) => g)) continue;
    if (!gone.some((g) => g)) {
      faces.push(tri.map(keep));
      continue;
    }
    // Walk the corners in order: a kept corner stays, and each edge between a kept and a
    // removed corner adds its crossing, so the clipped polygon keeps the triangle's winding.
    const poly: number[] = [];
    for (let c = 0; c < 3; c++) {
      const a = tri[c] as number;
      const b = tri[(c + 1) % 3] as number;
      if (!gone[c]) poly.push(keep(a));
      if (gone[c] !== gone[(c + 1) % 3]) poly.push(gone[c] ? crossing(b, a) : crossing(a, b));
    }
    faces.push(poly);
  }
  const triangles: number[] = [];
  for (const f of faces)
    for (let i = 1; i + 1 < f.length; i++)
      triangles.push(f[0] as number, f[i] as number, f[i + 1] as number);
  return {
    positions: Float64Array.from(positions),
    triangles: Uint32Array.from(triangles),
    boundary: boundaryLoop(faces),
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
  const at = (v: number): Vec3 => [
    P[v * 3] as number,
    P[v * 3 + 1] as number,
    P[v * 3 + 2] as number,
  ];
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
        const s = inner.get(a) ?? new Set<number>();
        inner.set(a, s);
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
  if (ways.every((w) => !w))
    throw new Error("sculpt part: no vertex of its cut has a neighbour inside it");
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
  for (const [r, row] of grid.slice(0, SKIRT_ROWS).entries())
    for (const [i, p] of row.entries()) positions.set(p, (count + r * m + i) * 3);
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
