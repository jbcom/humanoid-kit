/**
 * How far a posed body's thigh passes through its trunk (docs/ARCHITECTURE.md,
 * "The hip fold"): the skin the thigh holds most of (a vertex whose weight on
 * the thigh bones is over a half, no more than `FOLD_FRONT_MARGIN` behind a
 * hip and within the fold's reach of it), against the skin the trunk holds most of.
 *
 * Skin passes through skin where an edge of the thigh's mesh crosses a
 * triangle of the trunk's: a fact of the posed mesh, which does not depend on
 * which side of any surface a point is judged to lie, so it does not flicker
 * from one pose to the next. How deep is how far behind the crossed triangle's
 * plane the edge's thigh end lies.
 */
import type { HumanoidAssets } from "../../src/format/assetFormat.ts";
import { DIHEDRAL_LIMIT, DIHEDRAL_REST } from "../../src/foundation/invariants.ts";
import { TriangleCrossings } from "../../src/rig/contact.ts";
import { FOLD_FULL_REACH, foldParts, nearHips } from "../../src/rig/hipFold.ts";
import type { RestBones } from "../../src/rig/pose.ts";
import { bodyTriangles } from "./skinMeasure.ts";

export interface Penetration {
  /** The deepest crossing, metres behind the crossed triangle (0 when none cross). */
  depth: number;
  /** Edges of the thigh's mesh that cross the trunk's. */
  count: number;
}

export class HipContact {
  private readonly movers = new Set<number>();
  private readonly edges: [number, number][] = [];
  private readonly skin: Uint32Array;

  /** `rest` and `control`: the figure's skeleton and rest vertices. */
  constructor(
    assets: HumanoidAssets,
    rest: RestBones,
    control: Float32Array,
    tris: Uint32Array = bodyTriangles(assets),
  ) {
    const parts = foldParts(
      rest,
      control,
      assets.skinIndex,
      assets.skinWeight,
      tris,
      0.5,
      FOLD_FULL_REACH,
    );
    this.skin = parts.skin;
    for (const v of parts.movers) this.movers.add(v);
    // Each edge of the body that has a thigh vertex at an end, once.
    const seen = new Set<number>();
    const n = assets.manifest.vertexCount;
    for (let t = 0; t < tris.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = tris[t + k] as number;
        const b = tris[t + ((k + 1) % 3)] as number;
        if (!this.movers.has(a) && !this.movers.has(b)) continue;
        const key = a < b ? a * n + b : b * n + a;
        if (seen.has(key)) continue;
        seen.add(key);
        this.edges.push([a, b]);
      }
  }

  /** The thigh's penetration of the trunk in the pose that put the body's vertices at `positions`. */
  penetration(positions: Float32Array): Penetration {
    const crossings = new TriangleCrossings(positions, this.skin);
    let depth = 0;
    let count = 0;
    for (const [a, b] of this.edges) {
      const found = crossings.find(a, b);
      for (let h = 0; h < found; h++) {
        const t = crossings.hits[h] as number;
        for (const v of [a, b])
          if (this.movers.has(v)) depth = Math.max(depth, -crossings.side(t, v));
      }
      if (found) count++;
    }
    return { depth, count };
  }
}

/** Each vertex's unit normal on `positions`: its triangles' (`tris`) normals, each weighted by its area. */
export function vertexNormals(positions: Float32Array, tris: Uint32Array): Float32Array {
  const sum = new Float64Array(positions.length);
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]] as [number, number, number];
    const p = (v: number, k: number) => positions[v * 3 + k] as number;
    const u = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)] as const;
    const w = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)] as const;
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const v of [a, b, c])
      for (let k = 0; k < 3; k++) sum[v * 3 + k] = (sum[v * 3 + k] as number) + (n[k] as number);
  }
  const out = new Float32Array(positions.length);
  for (let v = 0; v < out.length / 3; v++) {
    const l =
      Math.hypot(sum[v * 3] as number, sum[v * 3 + 1] as number, sum[v * 3 + 2] as number) || 1;
    for (let k = 0; k < 3; k++) out[v * 3 + k] = (sum[v * 3 + k] as number) / l;
  }
  return out;
}

/** What `CreaseFlaps` counts in one pose. */
export interface Flaps {
  /** Triangles turned against their skinned normals that agreed with them at rest. */
  inverted: number;
  /** Edges folded sharper than `DIHEDRAL_LIMIT` that were smoother than `DIHEDRAL_REST` at rest. */
  folded: number;
}

/**
 * Flaps in the crease between the thigh and the trunk (docs/ARCHITECTURE.md,
 * "The hip fold"): the foundation's collapse and fold invariants
 * (src/foundation/invariants.ts) over the skin within `FOLD_FULL_REACH` of a
 * hip and in front of it, the belly, the groin and the thigh's front, where a
 * fold that pushes skin past its neighbours turns it into flaps with lit edges.
 */
export class CreaseFlaps {
  /** The zone's triangles, three corners each, and its edges with their two triangles (offsets into `tris`). */
  private readonly tris: Uint32Array;
  private readonly edges: [number, number][] = [];
  private readonly rest: Float32Array;
  private readonly restNormals: Float32Array;

  constructor(
    rest: RestBones,
    control: Float32Array,
    restNormals: Float32Array,
    tris: Uint32Array,
  ) {
    this.rest = control;
    this.restNormals = restNormals;
    const zone = nearHips(rest, control, FOLD_FULL_REACH, true);
    const kept: number[] = [];
    for (let t = 0; t < tris.length; t += 3)
      if (zone[tris[t] as number] && zone[tris[t + 1] as number] && zone[tris[t + 2] as number])
        kept.push(tris[t] as number, tris[t + 1] as number, tris[t + 2] as number);
    this.tris = Uint32Array.from(kept);
    const n = control.length / 3;
    const sides = new Map<number, number[]>();
    for (let t = 0; t < this.tris.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = this.tris[t + k] as number;
        const b = this.tris[t + ((k + 1) % 3)] as number;
        const key = a < b ? a * n + b : b * n + a;
        const list = sides.get(key);
        if (list) list.push(t);
        else sides.set(key, [t]);
      }
    for (const list of sides.values())
      if (
        list.length === 2 &&
        this.dihedral(control, list[0] as number, list[1] as number) < DIHEDRAL_REST
      )
        this.edges.push([list[0] as number, list[1] as number]);
  }

  /** Triangle `t`'s (an offset into `tris`) normal on `positions`, times twice its area. */
  private face(positions: Float32Array, t: number): [number, number, number] {
    const [a, b, c] = [this.tris[t], this.tris[t + 1], this.tris[t + 2]] as [
      number,
      number,
      number,
    ];
    const p = (v: number, k: number) => positions[v * 3 + k] as number;
    const u = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)] as const;
    const w = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)] as const;
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  }

  /** The angle (degrees) between triangles `s` and `t`'s faces on `positions`. */
  private dihedral(positions: Float32Array, s: number, t: number): number {
    const m = this.face(positions, s);
    const n = this.face(positions, t);
    const cos =
      (m[0] * n[0] + m[1] * n[1] + m[2] * n[2]) / (Math.hypot(...m) * Math.hypot(...n) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  }

  /** The flaps of the pose that put the body's vertices at `positions`, with skinned `normals`. */
  count(positions: Float32Array, normals: Float32Array): Flaps {
    let inverted = 0;
    for (let t = 0; t < this.tris.length; t += 3) {
      const posed = this.face(positions, t);
      const atRest = this.face(this.rest, t);
      let now = 0;
      let then = 0;
      for (let c = 0; c < 3; c++) {
        const v = this.tris[t + c] as number;
        for (let k = 0; k < 3; k++) {
          now += (posed[k] as number) * (normals[v * 3 + k] as number);
          then += (atRest[k] as number) * (this.restNormals[v * 3 + k] as number);
        }
      }
      if (now < 0 && then > 0) inverted++;
    }
    let folded = 0;
    for (const [s, t] of this.edges) if (this.dihedral(positions, s, t) > DIHEDRAL_LIMIT) folded++;
    return { inverted, folded };
  }
}
