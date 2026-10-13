/**
 * Reservoir skinning (src/model/reservoirSkin.ts): a reservoir's vertices take
 * their root's skin weights by where they sit on the organ the detail draws, how
 * far along its surface from the loop, over a band its rise sets; a surface nothing
 * pushes keeps its topology's weights, the very arrays.
 */
import { describe, expect, it } from "vitest";
import { SKIN_INFLUENCES } from "../src/format/assetFormat.ts";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import {
  bandOf,
  evaluatedFold,
  evaluatedSkin,
  type ReservoirSkinning,
  RISE,
  ROOT_BAND,
  reservoirGraph,
  rootShares,
  rootSkin,
  type SkinWeights,
  skinOfEvaluation,
} from "../src/model/reservoirSkin.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { fromHalf, toHalf } from "../src/rig/half.ts";
import { HIP_FOLD } from "../src/rig/hipFold.ts";
import { rowTexels, type SurfaceFold } from "../src/rig/jointFold.ts";
import { KNEE_FOLD } from "../src/rig/kneeFold.ts";
import { skinNormals } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(true), { subdivision: 1 });
// The organ and the sac alone: the anal canal pushes its own reservoir (canal.test.ts).
const man = createRecipe({
  macros: { age: 30, gender: 1 },
  modifiers: { "genitals/anal-canal": 0 },
});
const bare = createRecipe({
  macros: { age: 30, gender: 1 },
  modifiers: {
    "genitals/phallus-size": 0,
    "genitals/testes-size": 0,
    "genitals/anal-canal": 0,
  },
});

/** One vertex's bones and weights, as a map. */
const row = (s: SkinWeights, v: number) => {
  const m = new Map<number, number>();
  for (let k = 0; k < SKIN_INFLUENCES; k++) {
    const w = s.skinWeight[v * SKIN_INFLUENCES + k] as number;
    if (w > 0) m.set(s.skinIndex[v * SKIN_INFLUENCES + k] as number, w);
  }
  return m;
};
/** The total weight two rows give differently. */
const apart = (a: Map<number, number>, b: Map<number, number>) => {
  let d = 0;
  for (const bone of new Set([...a.keys(), ...b.keys()]))
    d += Math.abs((a.get(bone) ?? 0) - (b.get(bone) ?? 0));
  return d;
};

describe("reservoir skinning", { timeout: 300_000 }, () => {
  it("keeps the topology's weights, the very arrays, where nothing is pushed: the base surface, an adult with no organ", () => {
    const child = model.evaluate(createRecipe({ macros: { age: 10 } }));
    expect(child.surface).toBe("base");
    expect(child.skin).toBeNull();
    const without = model.evaluate(bare);
    expect(without.surface).toBe("adult");
    expect(without.skin).toBeNull();
    const topology = model.adultSurface();
    if (!topology) throw new Error("no adult surface");
    const posed = posedSurface(model, bare, "seated");
    expect(posed.skinIndex).toBe(topology.skinIndex);
    expect(posed.skinWeight).toBe(topology.skinWeight);
    const base = posedSurface(model, createRecipe({ macros: { age: 10 } }), "seated");
    expect(base.skinWeight).toBe(model.topology().body.skinWeight);
  });

  it("moves a pushed reservoir vertex's weights to its root's, and leaves a resting one exactly as it was", () => {
    const topology = model.adultSurface();
    if (!topology) throw new Error("no adult surface");
    const rest = model.evaluate(bare).positions.slice();
    const ev = model.evaluate(man);
    const skin = skinOfEvaluation(ev, topology);
    expect(ev.skin, "an organ pushes its reservoir out").not.toBeNull();
    // The posed body the invariants measure is skinned by the same weights.
    const posed = posedSurface(model, man, "seated");
    expect(Array.from(posed.skinWeight)).toEqual(Array.from(skin.skinWeight));
    expect(Array.from(posed.skinIndex)).toEqual(Array.from(skin.skinIndex));
    let resting = 0;
    let changed = 0;
    /** How many pushed vertices have each weight row. */
    const full = new Map<string, number>();
    for (let v = 0; v < topology.vertexCount; v++) {
      const pushed = Math.hypot(
        (ev.positions[v * 3] as number) - (rest[v * 3] as number),
        (ev.positions[v * 3 + 1] as number) - (rest[v * 3 + 1] as number),
        (ev.positions[v * 3 + 2] as number) - (rest[v * 3 + 2] as number),
      );
      const before = row(topology, v);
      const now = row(skin, v);
      if (pushed === 0) {
        resting++;
        for (let k = 0; k < SKIN_INFLUENCES; k++) {
          const at = v * SKIN_INFLUENCES + k;
          expect(skin.skinIndex[at]).toBe(topology.skinIndex[at]);
          expect(skin.skinWeight[at]).toBe(topology.skinWeight[at]);
        }
        continue;
      }
      if (apart(before, now) > 1e-6) changed++;
      // Whatever it is blended to, a vertex's weights still sum to one.
      expect([...now.values()].reduce((s, w) => s + w, 0)).toBeCloseTo(1, 5);
      const key = [...now]
        .sort((a, b) => a[0] - b[0])
        .map(([b, w]) => `${b}:${w.toFixed(5)}`)
        .join(",");
      full.set(key, (full.get(key) ?? 0) + 1);
    }
    expect(resting).toBeGreaterThan(topology.vertexCount / 2);
    expect(changed, "pushed vertices take their root's weights").toBeGreaterThan(1000);
    // Past its band, every vertex of an organ has its root's weights, the same ones: the
    // shaft's and the sac's, two rows carrying most of the drawn organ.
    const rows = [...full.values()].sort((a, b) => b - a);
    expect((rows[0] ?? 0) + (rows[1] ?? 0), "vertices past the band").toBeGreaterThan(1000);
  });

  it("goes from the skin's weights to the root's over the band along the organ's surface, wider for a shallow organ", () => {
    // A cone of rings round a loop: ring 0 is the loop (skin), rings 1..R the reservoir,
    // each 1 mm further along the surface and `slope` mm higher per mm. Pushed by the height.
    const sides = 24;
    const rings = 40;
    const radius = 0.015;
    const cone = (slope: number, opening: number | null = null) => {
      const positions: number[] = [];
      for (let r = 0; r <= rings; r++) {
        const along = r * 0.001;
        const run = along * Math.sqrt(1 - Math.min(0.99, slope) ** 2);
        const rho = Math.max(0.0005, radius - run);
        for (let k = 0; k < sides; k++) {
          const a = (2 * Math.PI * k) / sides;
          positions.push(rho * Math.cos(a), rho * Math.sin(a), along * slope);
        }
      }
      const index: number[] = [];
      for (let r = 0; r < rings; r++)
        for (let k = 0; k < sides; k++) {
          const a = r * sides + k;
          const b = r * sides + ((k + 1) % sides);
          index.push(a, b, a + sides, b, b + sides, a + sides);
        }
      const count = (rings + 1) * sides;
      const bySurface = Int16Array.from({ length: count }, (_, v) => (v < sides ? -1 : 0));
      const loopOf = Int16Array.from({ length: count }, (_, v) => (v < sides ? 0 : -1));
      const renderToSurface = Uint32Array.from({ length: count }, (_, v) => v);
      const skinning: ReservoirSkinning = {
        owner: bySurface,
        roots: [{ index: new Uint16Array(4), weight: Float32Array.from([1, 0, 0, 0]) }],
        loops: [Uint32Array.from({ length: sides }, (_, k) => k)],
        openings: [opening],
        graph: reservoirGraph(index, renderToSurface, bySurface, loopOf),
      };
      const pushed = Float32Array.from({ length: count }, (_, v) =>
        v < sides ? 0 : Math.floor(v / sides) * 0.001 * slope,
      );
      const shares = rootShares(skinning, pushed, Float32Array.from(positions));
      if (!shares) return { byRing: [], whole: -1 };
      // The share by ring, and the first ring that takes the whole root.
      const byRing = Array.from({ length: rings + 1 }, (_, r) => shares[r * sides] as number);
      return { byRing, whole: byRing.findIndex((s) => s >= 1) };
    };
    const steep = cone(0.9);
    const shallow = cone(0.3);
    for (const { byRing } of [steep, shallow]) {
      expect(byRing[0], "the loop is skin").toBe(0);
      for (let r = 1; r <= rings; r++)
        expect(byRing[r] as number).toBeGreaterThanOrEqual(byRing[r - 1] as number);
    }
    // Over the band, `ROOT_BAND` of the base radius: narrow for the steep organ, wide for the shallow.
    // (to a ring: they are a millimetre apart).
    expect(steep.whole).toBeGreaterThan(0);
    expect(Math.abs(steep.whole * 0.001 - ROOT_BAND.narrow * radius)).toBeLessThanOrEqual(0.0015);
    expect(Math.abs(shallow.whole * 0.001 - ROOT_BAND.wide * radius)).toBeLessThanOrEqual(0.0015);
    // A reservoir nothing pushes takes nothing: its topology's weights, exactly.
    expect(cone(0).whole).toBe(-1);
    // A canal, as steep as the steep organ, takes its root over the length its opening
    // closes in, not over the organ's band: half at half of it, all of it from there on.
    // Over the band, its opening's walls went from each side's thigh to the root across one ring.
    const opening = 0.01;
    const canal = cone(0.9, opening).byRing;
    for (let r = 1; r <= rings; r++)
      expect(canal[r] as number).toBeGreaterThanOrEqual(canal[r - 1] as number);
    expect(canal[opening / 0.002] as number).toBeCloseTo(0.5, 1);
    expect(canal.findIndex((s) => s >= 1)).toBe(opening / 0.001);
    expect(canal[steep.whole] as number).toBeLessThan(0.5);
  });

  it("widens the band continuously as an organ rises less steeply, between the narrow and the wide", () => {
    expect(bandOf(0)).toBe(ROOT_BAND.wide);
    expect(bandOf(RISE.shallow)).toBe(ROOT_BAND.wide);
    expect(bandOf(RISE.steep)).toBe(ROOT_BAND.narrow);
    expect(bandOf(2)).toBe(ROOT_BAND.narrow);
    let previous = bandOf(0);
    let jump = 0;
    for (let r = 0; r <= 1; r += 0.0005) {
      const b = bandOf(r);
      expect(b).toBeLessThanOrEqual(previous);
      jump = Math.max(jump, previous - b);
      previous = b;
    }
    expect(jump).toBeLessThan(0.005);
    // An intermediate organ gets an intermediate band.
    const mid = bandOf((RISE.shallow + RISE.steep) / 2);
    expect(mid).toBeGreaterThan(ROOT_BAND.narrow);
    expect(mid).toBeLessThan(ROOT_BAND.wide);
  });

  it("stays continuous where a root's bone overtakes one of the vertex's own: no weight jumps", () => {
    // A vertex on eight bones and a root on eight others: as the share grows the root's
    // overtake the vertex's one by one, and the eight kept change.
    const weights = [0.25, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06, 0.04];
    const skin: SkinWeights = {
      skinIndex: Uint16Array.from(weights.map((_, i) => i)),
      skinWeight: Float32Array.from(weights),
    };
    const roots = [
      rootSkin(
        {
          skinIndex: Uint16Array.from(weights.map((_, i) => 8 + i)),
          skinWeight: Float32Array.from(weights),
        },
        [0],
      ),
    ];
    const skinning: ReservoirSkinning = {
      owner: Int16Array.from([0]),
      roots,
      loops: [Uint32Array.of(0)],
      openings: [null],
      graph: reservoirGraph([], [0], Int16Array.of(0), Int16Array.of(-1)),
    };
    const at = (e: number) => {
      const s = evaluatedSkin(skin, skinning, Float32Array.from([e])) ?? skin;
      return row(s, 0);
    };
    let worst = 0;
    const step = 1 / 4000;
    for (let e = 0; e < 1; e += step) worst = Math.max(worst, apart(at(e), at(e + step)));
    expect(worst).toBeLessThan(0.01);
    expect([...at(1)].sort((a, b) => a[0] - b[0])).toEqual(
      weights.map((w, i) => [8 + i, expect.closeTo(w, 6)]),
    );
    // No share at all: the topology's arrays themselves.
    expect(evaluatedSkin(skin, skinning, Float32Array.from([0]))).toBeNull();
    expect(evaluatedSkin(skin, skinning, null)).toBeNull();
  });

  it("moves a closed canal's lips with its root, so a spread hip cannot part them, as far as the opening is closed", () => {
    // Two lips of a closed opening, each on its own thigh and the pelvis (bone 0), a
    // vertex half way into the closure's zone, and one outside it. The root is the
    // loop's mean, so both thighs at a quarter.
    const I = SKIN_INFLUENCES;
    const lip = (thigh: number) => [0, thigh, 0, 0, 0, 0, 0, 0];
    const skin: SkinWeights = {
      skinIndex: Uint16Array.from([...lip(1), ...lip(2), ...lip(1), ...lip(2)]),
      skinWeight: Float32Array.from([0, 1, 2, 3].flatMap(() => [0.5, 0.5, 0, 0, 0, 0, 0, 0])),
    };
    const root = { index: new Uint16Array(I), weight: new Float32Array(I) };
    root.index.set([0, 1, 2]);
    root.weight.set([0.5, 0.25, 0.25]);
    const skinning: ReservoirSkinning = {
      owner: Int16Array.from([-1, -1, -1, -1]),
      roots: [root],
      loops: [Uint32Array.of(0, 1)],
      openings: [0.01],
      graph: reservoirGraph(
        [],
        [0, 1, 2, 3],
        Int16Array.of(-1, -1, -1, -1),
        Int16Array.of(0, 0, -1, -1),
      ),
      closure: {
        canal: Int16Array.from([0, 0, 0, -1]),
        follows: Float32Array.from([1, 1, 0.5, 0]),
        mirror: Int32Array.from([1, 0, -1, -1]),
      },
    };
    const of = row;
    const closed = evaluatedSkin(skin, skinning, null, [1]);
    if (!closed) throw new Error("a closed canal left its lips' weights as they were");
    // Closed: both lips take the root's weights, the same, so no pose parts them.
    for (const v of [0, 1]) {
      expect(of(closed, v).get(0)).toBeCloseTo(0.5, 6);
      expect(of(closed, v).get(1)).toBeCloseTo(0.25, 6);
      expect(of(closed, v).get(2)).toBeCloseTo(0.25, 6);
    }
    // Half way into the zone: half its own, half the root's.
    expect(of(closed, 2).get(1)).toBeCloseTo(0.375, 6);
    expect(of(closed, 2).get(2)).toBeCloseTo(0.125, 6);
    // Outside the zone: as it was.
    expect(of(closed, 3).get(2)).toBeCloseTo(0.5, 6);
    expect(of(closed, 3).has(1)).toBe(false);
    // Half closed: the lips half way to the root.
    const half = evaluatedSkin(skin, skinning, null, [0.5]);
    expect(half && of(half, 0).get(1)).toBeCloseTo(0.375, 6);
    // Open (not closed at all), or no closure asked: the topology's arrays themselves.
    expect(evaluatedSkin(skin, skinning, null, [0])).toBeNull();
    expect(evaluatedSkin(skin, skinning, null)).toBeNull();
  });

  it("moves a pushed reservoir vertex's hip fold to its root's as its weights, and leaves the rest as they were", () => {
    // Render vertices 0 and 1 are the loop (rows 0 and 1, the left hip's and the right's);
    // 2 is a ring copy with a row of its own, 3 a cap vertex the fold left; 4 is skin elsewhere.
    const row = rowTexels(HIP_FOLD) * 4;
    const values = new Float32Array(3 * row);
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < row; i++) values[r * row + i] = (r + 1) * 0.01 + i * 1e-5;
    values[3] = 1;
    values[row + 3] = 0;
    values[2 * row + 3] = 0.2;
    // Half floats, as a fold holds them, and what they hold.
    const data = Uint16Array.from(values, toHalf);
    const held = (i: number) => fromHalf(data[i] as number);
    const fold: SurfaceFold = {
      joint: HIP_FOLD,
      slot: Float32Array.from([0, 1, 2, -1, -1]),
      rows: 3,
      data,
    };
    const skinning: ReservoirSkinning = {
      owner: Int16Array.from([-1, -1, 0, 0, -1]),
      roots: [{ index: new Uint16Array(4), weight: Float32Array.from([1, 0, 0, 0]) }],
      loops: [Uint32Array.of(0, 1)],
      openings: [null],
      graph: reservoirGraph(
        [],
        [0, 1, 2, 3, 4],
        Int16Array.from([-1, -1, 0, 0, -1]),
        Int16Array.from([0, 0, -1, -1, -1]),
      ),
    };
    // No share: the fold itself.
    expect(evaluatedFold(fold, skinning, new Float32Array(5))).toBe(fold);
    expect(evaluatedFold(fold, skinning, null)).toBe(fold);
    const e = 0.5;
    const out = evaluatedFold(fold, skinning, Float32Array.from([0, 0, 1, e, 0]));
    const rowOf = (v: number) => {
      const r = out.slot[v] as number;
      return Array.from(out.data.subarray(r * row, (r + 1) * row), fromHalf);
    };
    /** `got` is `want` rounded to a half float. */
    const rounded = (got: number, want: number) =>
      expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * 2 ** -11 + 1e-9);
    // The loop and the skin elsewhere keep their rows.
    expect(out.slot[0]).toBe(0);
    expect(out.slot[1]).toBe(1);
    expect(out.slot[4]).toBe(-1);
    expect(Array.from(out.data.subarray(0, 3 * row))).toEqual(Array.from(data));
    // The root's row: the loop's mean displacement and its side the mean of their sides, and
    // no change to the normal (each opening and key's second texel): an organ's normals turn
    // with its root's weights, and the loop's changes are each to its own vertex's normal.
    const normalChange = (i: number) => i % 8 >= 4;
    const root = Array.from({ length: row }, (_, i) =>
      i === 3 ? 0.5 : normalChange(i) ? 0 : (held(i) + held(row + i)) / 2,
    );
    // Taking the whole root, the ring copy has the root's row.
    const full = rowOf(2);
    for (let i = 0; i < row; i++) rounded(full[i] as number, root[i] as number);
    // Taking half, the cap vertex the fold left has half the root's, and the root's side.
    const halfway = rowOf(3);
    for (let i = 0; i < row; i++)
      rounded(halfway[i] as number, i === 3 ? 0.5 : e * (root[i] as number));
    // A fold that reaches neither the loop nor the vertices pushed (the knee's) gives them no rows.
    const elsewhere: SurfaceFold = {
      joint: KNEE_FOLD,
      slot: Float32Array.from([-1, -1, -1, -1, 0]),
      rows: 1,
      data: new Uint16Array(rowTexels(KNEE_FOLD) * 4),
    };
    expect(evaluatedFold(elsewhere, skinning, Float32Array.from([0, 0, 1, e, 0]))).toBe(elsewhere);
  });

  it("gives an organ drawn all the way out its root's normals in a flexed hip, its faces facing them", () => {
    // Seated, a hip turned ninety degrees: the groin skin round the sac's root turns over in
    // the crease and the fold changes its normals by most of their length. Added to the sac,
    // the mean of those changes turned 541 of its faces against their normals.
    const seated = createRecipe({ macros: { age: 30, gender: 1, muscle: 1 } });
    const body = posedSurface(model, seated, "seated");
    const bare = skinNormals(
      body.bones,
      body.rotations,
      body.restNormals,
      body.skinIndex,
      body.skinWeight,
      new Float32Array(body.normals.length),
    );
    const topology = model.adultSurface();
    if (!topology) throw new Error("no adult surface");
    // A vertex on its root's weights alone has exactly them, as every such vertex of its
    // reservoir does: the weight rows a hundred or more moved vertices share are roots'.
    const skinned = { skinIndex: body.skinIndex, skinWeight: body.skinWeight };
    const key = (v: number) =>
      [...row(skinned, v)]
        .sort((a, b) => a[0] - b[0])
        .map(([b, w]) => `${b}:${w.toFixed(5)}`)
        .join(" ");
    const moved = new Map<string, number[]>();
    for (let v = 0; v < body.vertexCount; v++) {
      if (apart(row(topology, v), row(skinned, v)) < 1e-6) continue;
      const k = key(v);
      moved.set(k, [...(moved.get(k) ?? []), v]);
    }
    // A closed canal's lips take its root's weights too (`evaluatedSkin`), but they are skin
    // the closure draws together, not an organ: each keeps its own crease's normal change.
    const { owner } = (
      model as unknown as { adultBodySurface(): { skinning: ReservoirSkinning } }
    ).adultBodySurface().skinning;
    const onRoots = [...moved.values()]
      .filter((vs) => vs.length >= 100)
      .flat()
      .filter((v) => (owner[v] as number) >= 0);
    expect(onRoots.length).toBeGreaterThan(100);
    for (const v of onRoots) {
      const dot = [0, 1, 2].reduce(
        (s, k) => s + (body.normals[v * 3 + k] as number) * (bare[v * 3 + k] as number),
        0,
      );
      expect(dot, `render vertex ${v}`).toBeGreaterThan(1 - 1e-3);
    }
  });
});
