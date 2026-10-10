/**
 * The adult anatomy pack's coat regions (scripts/lib/adultCoat.ts): pubic
 * hair's area, measured on the base mesh round the mons. Well formed for the
 * format, on the drawn skin of the pelvis's front, over the mons, symmetric,
 * and soft at every edge.
 */
import { describe, expect, it } from "vitest";
import { adultCoatRegions, monsCentre } from "../scripts/lib/adultCoat.ts";
import { ADULT_COAT_REGION_IDS, groupFaces } from "../src/format/assetFormat.ts";
import { loadFixtureAssets } from "./fixtures.ts";

/** The adult pack's mons target: the test's check that the measured frame is on the mons. */
const MONS_TARGET = "pelvis/bulge-incr";
// With the adult pack, for its mons target; the regions are measured from the base mesh alone.
const assets = loadFixtureAssets(true);
const P = assets.positions;
const regions = adultCoatRegions(assets);
const pubic = regions[0];
const mask = new Float32Array(assets.manifest.vertexCount);
pubic?.vertices.forEach((v, i) => {
  mask[v] = pubic.mask[i] as number;
});
const drawn = new Set<number>();
const edges: [number, number][] = [];
for (const f of groupFaces(assets, "body"))
  for (let k = 0; k < 4; k++) {
    const a = assets.faceVerts[f * 4 + k] as number;
    drawn.add(a);
    edges.push([a, assets.faceVerts[f * 4 + ((k + 1) % 4)] as number]);
  }
const at = (v: number, k: number) => P[v * 3 + k] as number;

/** The mons: its target's drawn vertices displaced most (the helper's are never drawn). */
const mons = (() => {
  const t = assets.targets.get(MONS_TARGET);
  if (!t) throw new Error(`no ${MONS_TARGET}`);
  const size = (i: number) =>
    Math.hypot(
      t.deltas[i * 3] as number,
      t.deltas[i * 3 + 1] as number,
      t.deltas[i * 3 + 2] as number,
    );
  const peak = Math.max(...Array.from(t.indices, (_, i) => size(i)));
  return Array.from(t.indices).filter((v, i) => drawn.has(v) && size(i) > 0.8 * peak);
})();

describe("the adult pack's coat regions", () => {
  it("are pubic hair's area alone, well formed for the format", () => {
    expect(regions.map((r) => r.id)).toEqual([...ADULT_COAT_REGION_IDS]);
    const { vertices, mask: m } = pubic as NonNullable<typeof pubic>;
    expect(vertices.length).toBe(m.length);
    expect(vertices.length).toBeGreaterThan(50);
    vertices.forEach((v, i) => {
      if (i > 0) expect(v).toBeGreaterThan(vertices[i - 1] as number);
      expect(m[i]).toBeGreaterThan(0);
      expect(m[i]).toBeLessThanOrEqual(1);
      // Three decimals: the manifest carries what the pack measured, compactly.
      expect(Math.round((m[i] as number) * 1000) / 1000).toBe(m[i]);
    });
  });

  it("place their frame at the mons: its target's centre's height, on the midline's skin", () => {
    const t = assets.targets.get(MONS_TARGET);
    if (!t) throw new Error(`no ${MONS_TARGET}`);
    const c = [0, 0, 0];
    let total = 0;
    t.indices.forEach((v, i) => {
      const w = Math.hypot(
        t.deltas[i * 3] as number,
        t.deltas[i * 3 + 1] as number,
        t.deltas[i * 3 + 2] as number,
      );
      total += w;
      for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + w * at(v, k);
    });
    const frame = monsCentre(assets, drawn);
    expect(Math.abs(frame[1] - (c[1] as number) / total)).toBeLessThan(0.01);
    // The midline's skin, which the mons bulges past on either side of it.
    expect(Math.abs(frame[2] - (c[2] as number) / total)).toBeLessThan(0.04);
  });

  it("are measured from the body pack alone, as the packer measures them", () => {
    expect(adultCoatRegions(loadFixtureAssets())).toEqual(regions);
  });

  it("lie on the drawn skin of the pelvis's front, round the mons", () => {
    for (const v of pubic?.vertices ?? []) {
      expect(drawn.has(v), `vertex ${v}`).toBe(true);
      expect(Math.abs(at(v, 0)), `vertex ${v}`).toBeLessThan(0.1);
      expect(at(v, 1), `vertex ${v}`).toBeGreaterThan(-0.2);
      expect(at(v, 1), `vertex ${v}`).toBeLessThan(0.05);
    }
  });

  it("cover the mons fully", () => {
    expect(mons.length).toBeGreaterThan(3);
    for (const v of mons) expect(mask[v], `vertex ${v}`).toBeGreaterThan(0.9);
  });

  it("are symmetric about the midline", () => {
    for (const v of pubic?.vertices ?? []) {
      // The vertex nearest the mirror image of v.
      let best = -1;
      let gap = Number.POSITIVE_INFINITY;
      for (const u of drawn) {
        const d = Math.hypot(at(u, 0) + at(v, 0), at(u, 1) - at(v, 1), at(u, 2) - at(v, 2));
        if (d < gap) {
          gap = d;
          best = u;
        }
      }
      if (gap < 1e-4)
        expect(Math.abs((mask[best] as number) - (mask[v] as number))).toBeLessThan(0.01);
    }
  });

  it("change by no more than fully over a centimetre along any edge", () => {
    let worst = 0;
    for (const [a, b] of edges) {
      const length = Math.hypot(at(a, 0) - at(b, 0), at(a, 1) - at(b, 1), at(a, 2) - at(b, 2));
      if (length > 0)
        worst = Math.max(worst, Math.abs((mask[a] as number) - (mask[b] as number)) / length);
    }
    expect(worst).toBeLessThan(100);
  });
});
