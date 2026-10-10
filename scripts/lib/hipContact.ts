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
import { TriangleCrossings } from "../../src/rig/contact.ts";
import { FOLD_FULL_REACH, foldParts } from "../../src/rig/hipFold.ts";
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
