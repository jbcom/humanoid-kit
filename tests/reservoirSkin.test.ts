/**
 * Reservoir skinning (src/model/reservoirSkin.ts): a reservoir's vertices take
 * their root's skin weights as far as the detail has pushed them out of the skin;
 * a surface nothing pushes keeps its topology's weights, the very arrays.
 */
import { describe, expect, it } from "vitest";
import { posedSurface } from "../src/foundation/posed.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import {
  evaluatedFold,
  evaluatedSkin,
  PUSH_STARTS,
  PUSHED_FULLY,
  type ReservoirSkinning,
  rootShare,
  rootSkin,
  type SkinWeights,
  skinOfEvaluation,
} from "../src/model/reservoirSkin.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { FOLD_ROW_TEXELS, type SurfaceFold } from "../src/rig/hipFold.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const model = new HumanoidModel(loadFixtureAssets(true), { subdivision: 1 });
const man = createRecipe({ macros: { age: 30, gender: 1 } });
const bare = createRecipe({
  macros: { age: 30, gender: 1 },
  modifiers: { "genitals/phallus-size": 0, "genitals/testes-size": 0 },
});

/** One vertex's four bones and weights, as a map. */
const row = (s: SkinWeights, v: number) => {
  const m = new Map<number, number>();
  for (let k = 0; k < 4; k++) {
    const w = s.skinWeight[v * 4 + k] as number;
    if (w > 0) m.set(s.skinIndex[v * 4 + k] as number, w);
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
    let fullCount = 0;
    /** The weights of every vertex pushed its full distance, by row: one row per reservoir drawn. */
    const full = new Set<string>();
    for (let v = 0; v < topology.vertexCount; v++) {
      const pushed = Math.hypot(
        (ev.positions[v * 3] as number) - (rest[v * 3] as number),
        (ev.positions[v * 3 + 1] as number) - (rest[v * 3 + 1] as number),
        (ev.positions[v * 3 + 2] as number) - (rest[v * 3 + 2] as number),
      );
      const before = row(topology, v);
      const now = row(skin, v);
      if (pushed <= PUSH_STARTS * 0.99) {
        resting++;
        for (let k = 0; k < 4; k++) {
          expect(skin.skinIndex[v * 4 + k]).toBe(topology.skinIndex[v * 4 + k]);
          expect(skin.skinWeight[v * 4 + k]).toBe(topology.skinWeight[v * 4 + k]);
        }
        continue;
      }
      if (apart(before, now) > 1e-6) changed++;
      // Whatever it is blended to, a vertex's weights still sum to one.
      expect([...now.values()].reduce((s, w) => s + w, 0)).toBeCloseTo(1, 5);
      if (pushed >= PUSHED_FULLY * 1.01) {
        fullCount++;
        full.add(
          [...now]
            .sort((a, b) => a[0] - b[0])
            .map(([b, w]) => `${b}:${w.toFixed(5)}`)
            .join(","),
        );
      }
    }
    expect(resting).toBeGreaterThan(topology.vertexCount / 2);
    expect(changed, "pushed vertices take their root's weights").toBeGreaterThan(1000);
    // Pushed all the way, every vertex of a reservoir has its root's weights, the same ones:
    // the shaft's and the sac's, two rows for the whole drawn organ.
    expect(fullCount, "vertices pushed the full distance").toBeGreaterThan(1000);
    expect(full.size).toBeLessThanOrEqual(2);
  });

  it("blends continuously in the push-out distance, from none at its start to all at the full distance", () => {
    expect(rootShare(0)).toBe(0);
    expect(rootShare(PUSH_STARTS)).toBe(0);
    expect(rootShare(PUSHED_FULLY)).toBe(1);
    expect(rootShare(1)).toBe(1);
    let previous = 0;
    let jump = 0;
    for (let d = 0; d <= 2 * PUSHED_FULLY; d += PUSHED_FULLY / 2000) {
      const s = rootShare(d);
      expect(s).toBeGreaterThanOrEqual(previous);
      jump = Math.max(jump, s - previous);
      previous = s;
    }
    expect(jump).toBeLessThan(0.002);
  });

  it("stays continuous where a root's bone overtakes one of the vertex's own: no weight jumps", () => {
    // A vertex on four bones and a root on four others: as the share grows the root's
    // overtake the vertex's one by one, and the four kept change.
    const skin: SkinWeights = {
      skinIndex: Uint16Array.from([0, 1, 2, 3]),
      skinWeight: Float32Array.from([0.4, 0.3, 0.2, 0.1]),
    };
    const roots = [
      rootSkin(
        {
          skinIndex: Uint16Array.from([4, 5, 6, 7]),
          skinWeight: Float32Array.from([0.4, 0.3, 0.2, 0.1]),
        },
        [0],
      ),
    ];
    const skinning: ReservoirSkinning = {
      owner: Int16Array.from([0]),
      roots,
      loops: [Uint32Array.of(0)],
    };
    const at = (d: number) => {
      const s = evaluatedSkin(skin, skinning, Float32Array.from([d])) ?? skin;
      return row(s, 0);
    };
    let worst = 0;
    const step = (PUSHED_FULLY - PUSH_STARTS) / 4000;
    for (let d = PUSH_STARTS; d < PUSHED_FULLY; d += step)
      worst = Math.max(worst, apart(at(d), at(d + step)));
    expect(worst).toBeLessThan(0.01);
    expect([...at(PUSHED_FULLY)].sort((a, b) => a[0] - b[0])).toEqual([
      [4, expect.closeTo(0.4, 6)],
      [5, expect.closeTo(0.3, 6)],
      [6, expect.closeTo(0.2, 6)],
      [7, expect.closeTo(0.1, 6)],
    ]);
    // Not pushed far enough to take any: the topology's arrays themselves.
    expect(evaluatedSkin(skin, skinning, Float32Array.from([PUSH_STARTS / 2]))).toBeNull();
  });

  it("moves a pushed reservoir vertex's hip fold to its root's as its weights, and leaves the rest as they were", () => {
    // Render vertices 0 and 1 are the loop (rows 0 and 1, the left hip's and the right's);
    // 2 is a ring copy with a row of its own, 3 a cap vertex the fold left; 4 is skin elsewhere.
    const row = FOLD_ROW_TEXELS * 4;
    const data = new Float32Array(3 * row);
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < row; i++) data[r * row + i] = (r + 1) * 0.01 + i * 1e-5;
    data[3] = 1;
    data[row + 3] = 0;
    data[2 * row + 3] = 0.2;
    const fold: SurfaceFold = { slot: Float32Array.from([0, 1, 2, -1, -1]), rows: 3, data };
    const skinning: ReservoirSkinning = {
      owner: Int16Array.from([-1, -1, 0, 0, -1]),
      roots: [{ index: new Uint16Array(4), weight: Float32Array.from([1, 0, 0, 0]) }],
      loops: [Uint32Array.of(0, 1)],
    };
    // Nothing pushed far enough: the fold itself.
    expect(evaluatedFold(fold, skinning, new Float32Array(5).fill(PUSH_STARTS / 2))).toBe(fold);
    const half = PUSH_STARTS + (PUSHED_FULLY - PUSH_STARTS) / 2;
    const out = evaluatedFold(fold, skinning, Float32Array.from([0, 0, PUSHED_FULLY, half, 0]));
    const rowOf = (v: number) => {
      const r = out.slot[v] as number;
      return out.data.subarray(r * row, (r + 1) * row);
    };
    // The loop and the skin elsewhere keep their rows.
    expect(out.slot[0]).toBe(0);
    expect(out.slot[1]).toBe(1);
    expect(out.slot[4]).toBe(-1);
    expect(Array.from(out.data.subarray(0, 3 * row))).toEqual(Array.from(data));
    // The root's row: the loop's mean, and its side the mean of their sides.
    const root = Array.from({ length: row }, (_, i) =>
      i === 3 ? 0.5 : ((data[i] as number) + (data[row + i] as number)) / 2,
    );
    // Pushed all the way, the ring copy has the root's row.
    const full = rowOf(2);
    for (let i = 0; i < row; i++) expect(full[i]).toBeCloseTo(root[i] as number, 6);
    // Halfway, the cap vertex the fold left has half the root's, and the root's side.
    const e = rootShare(half);
    const halfway = rowOf(3);
    for (let i = 0; i < row; i++)
      expect(halfway[i]).toBeCloseTo(i === 3 ? 0.5 : e * (root[i] as number), 6);
  });
});
