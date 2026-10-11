import { describe, expect, it } from "vitest";
import { deltaE2000, labFromLinear } from "../e2e/lib/colour.ts";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import { VULVA_SIZE, VULVA_TARGET, vulvaSkinMask } from "../scripts/lib/detail/vulva.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { VULVA_LAYER } from "../src/surface/regions/adult.ts";
import { DEFAULT_SKIN_TONE, skinAlbedo } from "../src/surface/skinTone.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

/**
 * The vulva (scripts/lib/detail/vulva.ts): the labia and the cleft of bogdan666's CC0
 * `adult_female_2020` proxy, transferred onto the skin of the adult surface's region
 * as a detail target of the skin (docs/research/ADULT-SCULPT-PLAN.md, section 6f).
 */
const assets = loadFixtureAssets(true);
const model = new HumanoidModel(assets, { subdivision: 1 });
const lattice = model.adultDetailLattice(AUTHORING_FIGURE);
if (!lattice) throw new Error("no adult surface");
const target = assets.targets.get(VULVA_TARGET);
if (!target) throw new Error(`the pack has no ${VULVA_TARGET}`);
const anatomy = adultManifest.anatomy;
/** Each refinement-mesh vertex's region index. */
const regionOf = new Map(Array.from(lattice.regionIds, (id, i) => [id, i] as const));

/** The target's displacement of each of its vertices, metres. */
const displaced = new Map<number, [number, number, number]>();
for (let i = 0; i < target.indices.length; i++)
  displaced.set(
    target.indices[i] as number,
    [0, 1, 2].map((k) => (target.deltas[i * 3 + k] as number) * target.scale) as [
      number,
      number,
      number,
    ],
  );
/** How far a region vertex is sunk under the skin, along its normal, metres. */
const sunk = (v: number) => {
  const d = displaced.get(v) ?? [0, 0, 0];
  return -[0, 1, 2].reduce(
    (s, k) => s + d[k as 0 | 1 | 2] * (lattice.normals[v * 3 + k] as number),
    0,
  );
};

describe("the vulva in the pack", () => {
  it("is a target of the skin, driven by its own size, with nothing of an organ's", () => {
    expect(anatomy?.detail?.skin).toEqual([VULVA_TARGET]);
    expect(anatomy?.detail?.drives?.[VULVA_TARGET]).toEqual([`mod:${VULVA_SIZE}`]);
    expect(anatomy?.features.find((f) => f.id === "vulva")?.modifiers).toEqual([VULVA_SIZE]);
    const m = adultManifest.modifiers.find((x) => x.id === VULVA_SIZE);
    expect(m?.lo).toBeNull();
    expect(m?.hi).toBe("");
  });

  it("is the whole sculpt for a woman and none for a man, blended between (no swap)", () => {
    expect(anatomy?.defaults?.[VULVA_SIZE]).toBe("0.35,1;0.65,0");
  });
});

describe("the vulva on the skin", () => {
  it("has a cleft the length of the labia majora (Kreklau 2018: 80 +- 15 mm)", () => {
    // The deepest sink of the vertices on the midline, in 5 mm steps from back to front; the
    // cleft is the run of steps sunk more than 2 mm round the deepest.
    const steps = new Map<number, number>();
    for (const v of displaced.keys()) {
      if (v >= lattice.regionCount || Math.abs(lattice.positions[v * 3] as number) > 0.003)
        continue;
      const step = Math.floor((lattice.positions[v * 3 + 2] as number) / 0.005);
      steps.set(step, Math.max(steps.get(step) ?? 0, sunk(v)));
    }
    const deepest = [...steps].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    let lo = deepest;
    let hi = deepest;
    while ((steps.get(lo - 1) ?? 0) > 0.002) lo--;
    while ((steps.get(hi + 1) ?? 0) > 0.002) hi++;
    const length = (hi - lo + 1) * 0.005;
    expect(length).toBeGreaterThan(0.08 - 0.0153);
    expect(length).toBeLessThan(0.08 + 0.0153);
  });

  it("sinks the skin no deeper than the cleft is, leaving the vestibule's depth to its canal", () => {
    let deepest = 0;
    for (const v of displaced.keys())
      if (v < lattice.regionCount) deepest = Math.max(deepest, sunk(v));
    expect(deepest).toBeGreaterThan(0.003);
    expect(deepest).toBeLessThanOrEqual(0.006 + 1e-6);
  });

  it("meets the skin round it without a step", () => {
    // Its outermost vertices (with a region neighbour it does not move) move by under 0.5 mm,
    // a quarter of the region's 2 mm edge there: no kink at its rim shows.
    const { start, vertices } = lattice.polygons;
    let worst = 0;
    for (let p = 0; p + 1 < start.length; p++) {
      const ids = Array.from(vertices.subarray(start[p] as number, start[p + 1] as number)).map(
        (id) => regionOf.get(id) as number,
      );
      if (!ids.some((v) => !displaced.has(v))) continue;
      for (const v of ids) {
        const d = displaced.get(v);
        if (d) worst = Math.max(worst, Math.hypot(...d));
      }
    }
    expect(worst).toBeLessThan(0.0005);
  });

  it("moves no ring itself, and the drawn surface no further than the target does", () => {
    // A ring's vertices copy their loop vertices and move with them (`displace`); given the
    // loop's displacement too, a collapsed sac's wall sank twice as far, a step at its loop.
    for (const r of lattice.reservoirs)
      for (let m = r.base; m < r.base + r.loop * r.rings; m++) expect(displaced.has(m)).toBe(false);
    const authored = Math.max(...[...displaced.values()].map((d) => Math.hypot(...d)));
    const recipe = (size: number) =>
      createRecipe({ macros: AUTHORING_FIGURE.macros, modifiers: { [VULVA_SIZE]: size } });
    const without = model.evaluate(recipe(0)).positions;
    const withIt = model.evaluate(recipe(1)).positions;
    let drawn = 0;
    for (let v = 0; v < without.length / 3; v++)
      drawn = Math.max(
        drawn,
        Math.hypot(
          ...[0, 1, 2].map((k) => (withIt[v * 3 + k] as number) - (without[v * 3 + k] as number)),
        ),
      );
    expect(drawn).toBeGreaterThan(0.003);
    expect(drawn).toBeLessThanOrEqual(authored * 1.01);
  });

  it("is drawn by default on a woman, not on a man, and half on a figure between", () => {
    // Its one drive is the size's positive part (`mod:`), so the size is its weight.
    const weight = (gender: number) =>
      model.withDefaults(createRecipe({ macros: { ...AUTHORING_FIGURE.macros, gender } }))
        .modifiers[VULVA_SIZE] ?? 0;
    expect(weight(0)).toBeCloseTo(1, 6);
    expect(weight(1)).toBe(0);
    expect(weight(0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("the vulva's skin colour", () => {
  const spec = anatomy?.skinLayers.find((l) => l.id === "vulva-skin");
  const mask = spec?.vertexMask;
  if (!mask) throw new Error("the pack authors no vulva-skin mask");
  const shape = model.controlShape(AUTHORING_FIGURE);

  it("is the generator's mask, from the vulva's form on the authoring figure", () => {
    const form = {
      name: VULVA_TARGET,
      indices: Array.from(target.indices),
      xyz: Array.from(target.deltas, (d) => d * target.scale),
    };
    const want = vulvaSkinMask(lattice, form, shape.control, shape.body);
    expect(mask.indices).toEqual(want.indices);
    for (const [i, w] of mask.weights.entries())
      expect(w).toBeCloseTo(want.weights[i] as number, 5);
    expect(mask.weights.filter((w) => w > 0.99).length).toBeGreaterThan(0);
  });

  it("has no edge: along any base edge it changes by at most 50 per metre", () => {
    const w = new Map(mask.indices.map((v, i) => [v, mask.weights[i] as number] as const));
    const P = shape.control;
    const fv = assets.faceVerts;
    let steepest = 0;
    for (let f = 0; f < fv.length / 4; f++)
      for (let c = 0; c < 4; c++) {
        const a = fv[f * 4 + c] as number;
        const b = fv[f * 4 + ((c + 1) % 4)] as number;
        const l = Math.hypot(
          (P[a * 3] as number) - (P[b * 3] as number),
          (P[a * 3 + 1] as number) - (P[b * 3 + 1] as number),
          (P[a * 3 + 2] as number) - (P[b * 3 + 2] as number),
        );
        if (l > 0) steepest = Math.max(steepest, Math.abs((w.get(a) ?? 0) - (w.get(b) ?? 0)) / l);
      }
    expect(steepest).toBeLessThanOrEqual(50);
  });

  it("is the body's skin, mildly deepened, at every tone: 1 to 6 CIEDE2000 from the skin round it", () => {
    for (const melanin of [0, 0.1, 0.2, 0.35, 0.5, 0.7, 0.85, 1]) {
      const tone = { ...DEFAULT_SKIN_TONE, melanin };
      const skin = skinAlbedo(tone);
      const paint = VULVA_LAYER.paint({ tone, signals: {}, age: 30, gender: 0 } as never);
      if (!("stops" in paint)) throw new Error("the vulva layer paints no stops");
      const drawn = skin.map(
        (c, k) => c + paint.strength * (((paint.stops[0] as number[])[k] as number) - c),
      ) as [number, number, number];
      const dE = deltaE2000(labFromLinear(skin), labFromLinear(drawn));
      expect(dE, `melanin ${melanin}`).toBeGreaterThanOrEqual(1);
      expect(dE, `melanin ${melanin}`).toBeLessThanOrEqual(6);
      // Deeper, not another hue: no channel rises above the skin's but red.
      expect(drawn[0]).toBeLessThanOrEqual(skin[0] + 1e-9);
    }
  });

  it("lies on the islands too: a collapsed sac's cap in the vulva carries its colour", () => {
    const fields = model.adultLayerFields();
    const extra = fields?.extra;
    if (!fields || !extra) throw new Error("no island fields");
    const l = fields.layers.indexOf("vulva-skin");
    const count = extra.uvs.length / 2;
    let most = 0;
    for (let i = 0; i < count; i++)
      most = Math.max(most, extra.layerFields[(l * count + i) * 2] as number);
    expect(most).toBeGreaterThan(0.9);
  });
});
