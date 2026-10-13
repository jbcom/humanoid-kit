import { describe, expect, it } from "vitest";
import { SKIN_INFLUENCES } from "../src/format/assetFormat.ts";
import { type Quat, rotate } from "../src/graft/fit.ts";
import { occupiedCellVisitCount } from "../src/graft/graft.ts";
import {
  arcParams,
  boundaryEdges,
  CUT_SITES,
  fairLoop,
  GraftError,
  type GraftPart,
  maxTurn,
  orderLoops,
  sampleLoop,
  similarityFit,
  weldByPosition,
} from "../src/graft/index.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { loadFixtureAssets } from "./fixtures.ts";

/**
 * A sphere of radius `r` open below latitude `open` (radians below the
 * equator), centred on the origin: a head-like part whose one boundary loop
 * is its neck. `bands` rings of `segments` vertices, the open ring last.
 */
function openSphere(r: number, segments = 24, bands = 12, open = 0.6): GraftPart {
  const positions: number[] = [0, r, 0];
  const lats: number[] = [];
  for (let b = 1; b <= bands; b++) lats.push(Math.PI / 2 - (b / bands) * (Math.PI / 2 + open));
  for (const lat of lats)
    for (let s = 0; s < segments; s++) {
      const lon = (s / segments) * Math.PI * 2;
      positions.push(
        r * Math.cos(lat) * Math.sin(lon),
        r * Math.sin(lat),
        r * Math.cos(lat) * Math.cos(lon),
      );
    }
  const triangles: number[] = [];
  const ring = (b: number, s: number) => 1 + b * segments + (s % segments);
  for (let s = 0; s < segments; s++) triangles.push(0, ring(0, s), ring(0, s + 1));
  for (let b = 0; b + 1 < bands; b++)
    for (let s = 0; s < segments; s++) {
      const a = ring(b, s);
      const c = ring(b, s + 1);
      const d = ring(b + 1, s);
      const e = ring(b + 1, s + 1);
      triangles.push(a, d, e, a, e, c);
    }
  return { positions, triangles };
}

/** Boundary edges (each undirected edge in exactly one triangle) of a welded triangle list. */
function openEdges(index: ArrayLike<number>, weld: ArrayLike<number>): number {
  const count = new Map<string, number>();
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = weld[index[t + k] as number] as number;
      const b = weld[index[t + ((k + 1) % 3)] as number] as number;
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  let open = 0;
  for (const n of count.values()) if (n === 1) open++;
  return open;
}

/** The largest angle, in degrees, between the two faces on any edge of the closed ring `ring` (welded ids). */
function ringCrease(
  index: ArrayLike<number>,
  weld: ArrayLike<number>,
  positions: ArrayLike<number>,
  ring: ArrayLike<number>,
): number {
  const on = new Set<string>();
  for (let i = 0; i < ring.length; i++) {
    const a = weld[ring[i] as number] as number;
    const b = weld[ring[(i + 1) % ring.length] as number] as number;
    on.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }
  const p = (v: number) => [0, 1, 2].map((k) => positions[v * 3 + k] as number);
  const faces = new Map<string, number[][]>();
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => p(index[t + k] as number)) as [
      number[],
      number[],
      number[],
    ];
    const u = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
    const w = [0, 1, 2].map((k) => (c[k] as number) - (a[k] as number));
    const n = [
      (u[1] as number) * (w[2] as number) - (u[2] as number) * (w[1] as number),
      (u[2] as number) * (w[0] as number) - (u[0] as number) * (w[2] as number),
      (u[0] as number) * (w[1] as number) - (u[1] as number) * (w[0] as number),
    ];
    const l = Math.hypot(...n) || 1;
    for (let k = 0; k < 3; k++) {
      const x = weld[index[t + k] as number] as number;
      const y = weld[index[t + ((k + 1) % 3)] as number] as number;
      const key = x < y ? `${x}:${y}` : `${y}:${x}`;
      if (on.has(key)) (faces.get(key) ?? faces.set(key, []).get(key))?.push(n.map((q) => q / l));
    }
  }
  let worst = 0;
  for (const [f, g] of faces.values()) {
    if (!f || !g) continue;
    const d =
      (f[0] as number) * (g[0] as number) +
      (f[1] as number) * (g[1] as number) +
      (f[2] as number) * (g[2] as number);
    worst = Math.max(worst, (Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI);
  }
  return worst;
}

describe("the graft's loop utilities", () => {
  it("searches occupied skin cells without enumerating empty space", () => {
    // The earlier cubic-shell search examined 1,770,000 empty coordinates
    // before it reached a matching cell 60 steps away on every axis.  The
    // nearest-cell index visits each populated cell once, with no radius cap.
    expect(
      occupiedCellVisitCount(
        [
          [0, 0, 0],
          [61, 61, 61],
        ],
        [30.5, 30.5, 30.5],
      ),
    ).toBe(2);
  });

  it("welds coincident vertices and finds a part's one open loop, in order", () => {
    const part = openSphere(1);
    const weld = weldByPosition(part.positions);
    const loops = orderLoops(boundaryEdges(part.triangles, weld));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(24);
  });

  it("fairs a jagged loop under the turn gate", () => {
    const points = new Float64Array(48 * 3);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const jag = i % 2 === 0 ? 1 : 0.8;
      points.set([jag * Math.cos(a), jag * Math.sin(a), 0], i * 3);
    }
    const limit = (40 * Math.PI) / 180;
    expect(maxTurn(points)).toBeGreaterThan(limit);
    const turn = fairLoop(points, limit);
    expect(turn).toBeLessThanOrEqual(limit);
    expect(maxTurn(points)).toBeCloseTo(turn, 9);
  });

  it("samples a closed loop evenly by arc length", () => {
    const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    const s = sampleLoop(square, arcParams(square), 8);
    expect(Array.from(s.subarray(3, 6))).toEqual([0.5, 0, 0]);
    expect(Array.from(s.subarray(12, 15))).toEqual([1, 1, 0]);
  });

  it("recovers a known similarity", () => {
    const from = openSphere(3).positions as number[];
    const h = Math.SQRT1_2;
    const q: Quat = [0, h, 0, h];
    const to = new Float64Array(from.length);
    for (let i = 0; i < from.length; i += 3) {
      const p = rotate(q, [from[i] as number, from[i + 1] as number, from[i + 2] as number]);
      to.set([0.01 * p[0] + 1, 0.01 * p[1] - 2, 0.01 * p[2] + 0.5], i);
    }
    const fit = similarityFit(from, to);
    expect(fit.scale).toBeCloseTo(0.01, 9);
    expect(fit.translation[0]).toBeCloseTo(1, 9);
    expect(fit.translation[1]).toBeCloseTo(-2, 9);
    expect(Math.abs(fit.rotation[1])).toBeCloseTo(h, 9);
  });
});

describe("a graft on a figure", { timeout: 120_000 }, () => {
  const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 1 });
  const recipe = createRecipe({ macros: { age: 30 } });
  const rest = model.evaluate(recipe);
  // A head in centimetres, as a foreign asset would come: the fit finds the scale.
  const head = openSphere(11);
  const graft = model.graft({ at: "neck", part: head });
  const topology = graft.topology();

  it("names its sites", () => {
    expect(Object.keys(CUT_SITES).sort()).toEqual(
      ["ankle.L", "ankle.R", "neck", "wrist.L", "wrist.R"].sort(),
    );
  });

  it("cuts each site along one edge loop of the base mesh, with the pinned edge counts", () => {
    const fv = model.assets.faceVerts;
    const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    const edges: Record<string, number> = {};
    for (const at of Object.keys(CUT_SITES) as (keyof typeof CUT_SITES)[]) {
      const removed = new Set(Array.from(model.graft({ at, part: head }).topology().removedFaces));
      const kept = new Set<string>();
      for (let f = 0; f < fv.length / 4; f++)
        if (!removed.has(f))
          for (let k = 0; k < 4; k++)
            kept.add(key(fv[f * 4 + k] as number, fv[f * 4 + ((k + 1) % 4)] as number));
      let n = 0;
      for (const f of removed)
        for (let k = 0; k < 4; k++)
          if (kept.has(key(fv[f * 4 + k] as number, fv[f * 4 + ((k + 1) % 4)] as number))) n++;
      edges[at] = n;
    }
    expect(edges).toEqual({ neck: 42, "wrist.L": 20, "wrist.R": 20, "ankle.L": 30, "ankle.R": 30 });
  });

  it("removes the head above the neck loop, binds the part to the head bone", () => {
    expect(topology.rootBone).toBe("head");
    expect(topology.removedFaces.length).toBeGreaterThan(0);
    expect(topology.removedBones).toContain("jaw");
    expect(topology.removedBones).not.toContain("head");
    expect(topology.removedBones).not.toContain("neck01");
    expect(topology.loop.length).toBeGreaterThan(8);
    expect(topology.rim).toHaveLength(24);
  });

  it("merges one surface: no open edge on the loop, the band or the rim", () => {
    const seamVerts = new Set<number>();
    for (const v of topology.loop) seamVerts.add(topology.weld[v] as number);
    for (const v of topology.rim) seamVerts.add(topology.weld[v] as number);
    for (let v = topology.bodyVertexCount; v < topology.partStart; v++)
      seamVerts.add(topology.weld[v] as number);
    const count = new Map<string, number>();
    const index = topology.index;
    for (let t = 0; t < index.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = topology.weld[index[t + k] as number] as number;
        const b = topology.weld[index[t + ((k + 1) % 3)] as number] as number;
        if (!seamVerts.has(a) || !seamVerts.has(b)) continue;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    const open = [...count.values()].filter((n) => n !== 2);
    expect(open).toEqual([]);
    expect(topology.groups.map((g) => g.name)).toEqual(["body", "bridge", "part"]);
    expect(openEdges(head.triangles, weldByPosition(head.positions))).toBe(24);
  });

  it("fits the part to the neck in metres and keeps the band smooth", () => {
    const s = graft.evaluate(rest);
    expect(s.surface).toBe("base");
    // An 11 cm sphere opening at a neck: centimetres become metres.
    expect(s.fit.scale).toBeGreaterThan(0.002);
    expect(s.fit.scale).toBeLessThan(0.05);
    expect(s.fit.turn).toBeLessThanOrEqual(40);
    for (const v of s.positions) expect(Number.isFinite(v)).toBe(true);
    for (let v = 0; v < topology.vertexCount; v++) {
      const l = Math.hypot(
        s.normals[v * 3] as number,
        s.normals[v * 3 + 1] as number,
        s.normals[v * 3 + 2] as number,
      );
      expect(l).toBeCloseTo(1, 3);
    }
    // The part sits above the loop, on the body's axis.
    let partY = 0;
    for (let v = topology.partStart; v < topology.vertexCount; v++)
      partY += s.positions[v * 3 + 1] as number;
    partY /= topology.vertexCount - topology.partStart;
    let loopY = 0;
    for (const v of topology.loop) loopY += s.positions[v * 3 + 1] as number;
    loopY /= topology.loop.length;
    expect(partY).toBeGreaterThan(loopY);
    // The body's kept vertices are the evaluation's own.
    for (const v of topology.loop)
      for (let k = 0; k < 3; k++) expect(s.positions[v * 3 + k]).toBe(rest.positions[v * 3 + k]);
  });

  it("refits on another figure: the part follows the neck's girth", () => {
    const heavy = model.evaluate(createRecipe({ macros: { age: 30, weight: 1, muscle: 1 } }));
    const thin = model.evaluate(createRecipe({ macros: { age: 30, weight: 0, muscle: 0 } }));
    expect(graft.evaluate(heavy).fit.loopRadius).toBeGreaterThan(
      graft.evaluate(thin).fit.loopRadius,
    );
  });

  it("bends a donor's neck into the body's: no knee at the rim", () => {
    // A heavy older man's head on a slim young woman: his neck leans otherwise than hers.
    const donor = model.cutAway(
      "neck",
      model.evaluate(createRecipe({ macros: { age: 60, gender: 1, weight: 0.4, muscle: 0.6 } })),
    );
    const onto = model.graft({ at: "neck", part: donor });
    const slim = model.evaluate(
      createRecipe({ macros: { age: 25, gender: 0, height: 1, weight: 0 } }),
    );
    const s = onto.evaluate(slim);
    const t = onto.topology(s.surface);
    expect(ringCrease(t.index, t.weld, s.positions, t.rim)).toBeLessThan(8);
  });

  it("skins the part as the head it replaces: its top to the head, its rim to the neck's", () => {
    const bones = model.assets.manifest.skeleton.bones.map((b) => b.name);
    const head = bones.indexOf("head");
    const weightOn = (v: number, bone: number) => {
      let w = 0;
      for (let k = 0; k < SKIN_INFLUENCES; k++)
        if (topology.skinIndex[v * SKIN_INFLUENCES + k] === bone)
          w += topology.skinWeight[v * SKIN_INFLUENCES + k] as number;
      return w;
    };
    // The sphere's pole, its first vertex, is the crown: the head's alone.
    expect(weightOn(topology.partStart, head)).toBeGreaterThan(0.95);
    // At the rim the part takes the skin of the body it replaced there, so it
    // carries some neck weight and is not bound rigidly to the head.
    let rimHead = 0;
    for (const v of topology.rim) rimHead += weightOn(v, head);
    expect(rimHead / topology.rim.length).toBeLessThan(0.95);
    for (let v = 0; v < topology.vertexCount; v++) {
      let w = 0;
      for (let k = 0; k < SKIN_INFLUENCES; k++)
        w += topology.skinWeight[v * SKIN_INFLUENCES + k] as number;
      expect(w).toBeCloseTo(1, 4);
    }
  });

  it("takes a supplied seam, a plane-trimmed part and a hand at the wrist", () => {
    const loop = orderLoops(boundaryEdges(head.triangles, weldByPosition(head.positions)))[0];
    const supplied = model.graft({ at: "neck", part: { ...head, seam: { loop: loop ?? [] } } });
    expect(supplied.topology().rim).toHaveLength(24);
    const trimmed = model.graft({
      at: "neck",
      part: { ...head, seam: { plane: { point: [0, 0, 0], normal: [0, -1, 0] } } },
    });
    // Trimmed at the equator: the part keeps its upper half and opens there.
    const trimmedPart = trimmed.topology().groups.find((g) => g.name === "part");
    const wholePart = topology.groups.find((g) => g.name === "part");
    expect(trimmedPart?.count).toBeLessThan(wholePart?.count ?? 0);
    expect(trimmed.topology().rim).toHaveLength(24);
    expect(Number.isFinite(trimmed.evaluate(rest).fit.scale)).toBe(true);
    const hand = model.graft({ at: "wrist.L", part: openSphere(4) });
    expect(hand.topology().rootBone).toBe("wrist.L");
    expect(hand.topology().removedBones).toContain("finger1-1.L");
    expect(hand.evaluate(rest).fit.turn).toBeLessThanOrEqual(40);
  });

  it("carries the part's groups through a plane trim", () => {
    const total = head.triangles.length / 3;
    const half = Math.floor(total / 2);
    const groups = [
      { name: "a", start: 0, count: half },
      { name: "b", start: half, count: total - half },
    ];
    const plane = { point: [0, 0, 0] as const, normal: [0, -1, 0] as const };
    const g = model.graft({
      at: "neck",
      part: {
        ...head,
        groups,
        seam: { plane: { point: [...plane.point], normal: [...plane.normal] } },
      },
    });
    const t = g.topology();
    const partGroups = t.groups.slice(2);
    expect(partGroups.length).toBeGreaterThan(0);
    for (const pg of partGroups) expect(["a", "b"]).toContain(pg.name);
    // The part's groups tile the rest of the index, in order, with no gaps.
    let at = (t.groups[1]?.start ?? 0) + (t.groups[1]?.count ?? 0);
    for (const pg of partGroups) {
      expect(pg.start).toBe(at);
      at += pg.count;
    }
    expect(at).toBe(t.index.length / 3);
    // Untrimmed, both groups come through at their own sizes.
    const whole = model.graft({ at: "neck", part: { ...head, groups } }).topology();
    expect(whole.groups.slice(2).map((x) => [x.name, x.count])).toEqual([
      ["a", half],
      ["b", total - half],
    ]);
  });

  it("refuses fit options that would collapse or flip the band", () => {
    for (const options of [
      { gap: 0 },
      { band: -1 },
      { maxTurn: 0 },
      { scale: -1 },
      { scale: [1, 0, 1] as [number, number, number] },
    ])
      expect(() => model.graft({ at: "neck", part: head, ...options })).toThrow(GraftError);
  });

  it("refuses an unknown site and a part with no seam", () => {
    expect(() => model.graft({ at: "tail", part: head })).toThrow(GraftError);
    // A closed octahedron has no boundary to graft at.
    const closed: GraftPart = {
      positions: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1],
      triangles: [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5],
    };
    expect(() => model.graft({ at: "neck", part: closed })).toThrow(GraftError);
  });
});
