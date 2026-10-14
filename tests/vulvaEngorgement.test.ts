/**
 * The vulva's engorgement under arousal (#118): the labia minora and the vestibule
 * swell, the outer labia hardly at all. Provisional and uncalibrated: Masters and
 * Johnson (1966) report the minora's diameter growing two to three times; no CC0
 * measurement of the surface's displacement was found (docs/research/ADULT-ANATOMY-DATA.md,
 * section C), so the magnitude is a CHOICE held to a range here.
 *
 * Measured on the drawn surface of the organ-only assets, where arousal moves the
 * genitals alone (the lip and nipple morph is arousal.test.ts's).
 */
import { describe, expect, it } from "vitest";
import { AUTHORING_FIGURE } from "../scripts/lib/control/mound.ts";
import {
  VULVA_ENGORGED,
  VULVA_ENGORGEMENT,
  VULVA_SIZE,
  VULVA_TARGET,
} from "../scripts/lib/detail/vulva.ts";
import { LIP } from "../src/model/canalClosure.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import type { ReservoirSkinning } from "../src/model/reservoirSkin.ts";
import { createRecipe } from "../src/recipe/recipe.ts";
import { adultManifest, loadAdultDetailOnlyAssets } from "./fixtures.ts";

const assets = loadAdultDetailOnlyAssets();
const model = new HumanoidModel(assets, { subdivision: 1 });
const anatomy = adultManifest.anatomy;
const woman = (modifiers: Record<string, number> = {}) =>
  createRecipe({
    macros: AUTHORING_FIGURE.macros,
    // The vulva alone: the authoring figure's default organ would erect under arousal.
    modifiers: {
      [VULVA_SIZE]: 1,
      "genitals/phallus-size": 0,
      "genitals/testes-size": 0,
      ...modifiers,
    },
  });

/** Per drawn vertex, how far arousal moved it, and along the rest surface's normal. */
function swelling(recipe: ReturnType<typeof woman>, arousal: number) {
  const rest = model.evaluate(recipe);
  const P = Float32Array.from(rest.positions);
  const N = Float32Array.from(rest.normals);
  const Q = model.evaluate(recipe, { arousal }).positions;
  const moved: { v: number; d: number; out: number; x: number }[] = [];
  for (let v = 0; v < P.length / 3; v++) {
    const d = [0, 1, 2].map((k) => (Q[v * 3 + k] as number) - (P[v * 3 + k] as number));
    const len = Math.hypot(d[0] as number, d[1] as number, d[2] as number);
    if (len < 1e-6) continue;
    const out = d.reduce((s, x, k) => s + x * (N[v * 3 + k] as number), 0);
    moved.push({ v, d: len, out, x: P[v * 3] as number });
  }
  return { moved, positions: Q };
}

describe("the vulva's engorgement in the pack", () => {
  it("is a target of the skin, driven by the vulva's size times arousal", () => {
    expect(anatomy?.detail?.skin).toContain(VULVA_ENGORGED);
    expect(anatomy?.detail?.skin).toContain(VULVA_TARGET);
    expect(anatomy?.detail?.drives?.[VULVA_ENGORGED]).toEqual([
      `mod:${VULVA_SIZE}`,
      "signal:arousal",
    ]);
  });

  it("moves only skin the vulva's own form moves", () => {
    const folds = new Set(assets.targets.get(VULVA_TARGET)?.indices ?? []);
    const swell = assets.targets.get(VULVA_ENGORGED)?.indices ?? [];
    expect(swell.length).toBeGreaterThan(50);
    for (const v of swell) expect(folds.has(v), `lattice vertex ${v}`).toBe(true);
  });
});

describe("the vulva's engorgement on the skin", { timeout: 600_000 }, () => {
  it("swells the vulva outward by its CHOICE of magnitude at full arousal", () => {
    const { moved } = swelling(woman(), 1);
    expect(moved.length).toBeGreaterThan(50);
    const far = Math.max(...moved.map((m) => m.d));
    expect(far).toBeGreaterThan(VULVA_ENGORGEMENT.depth * 0.6);
    expect(far).toBeLessThan(VULVA_ENGORGEMENT.depth * 1.6);
    // Swelling, not sinking: nearly every moved vertex goes out of the skin.
    const outward = moved.filter((m) => m.out > 0).length;
    expect(outward / moved.length).toBeGreaterThan(0.9);
  });

  it("swells the inner vulva, by the midline, far more than the outer labia", () => {
    const { moved } = swelling(woman(), 1);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const inner = mean(moved.filter((m) => Math.abs(m.x) < 0.005).map((m) => m.d));
    const outer = moved.filter((m) => Math.abs(m.x) > 0.016).map((m) => m.d);
    expect(inner).toBeGreaterThan(VULVA_ENGORGEMENT.depth * 0.4);
    for (const d of outer) expect(d).toBeLessThan(VULVA_ENGORGEMENT.depth * 0.15);
  });

  it("is in proportion to arousal, and none without the vulva or without the signal", () => {
    const at = (a: number, m: Record<string, number> = {}) =>
      Math.max(0, ...swelling(woman(m), a).moved.map((x) => x.d));
    expect(at(0)).toBe(0);
    expect(at(0.5)).toBeCloseTo(at(1) / 2, 4);
    expect(at(1, { [VULVA_SIZE]: 0 })).toBe(0);
  });

  it("keeps the vaginal opening closed: its lips' normals stay together", () => {
    const recipe = woman();
    const body = model.evaluate(recipe, { arousal: 1 });
    const closure = (model as unknown as { adultBody: { skinning: ReservoirSkinning } | null })
      .adultBody?.skinning.closure;
    if (!closure) throw new Error("no canal closure");
    const P = body.positions;
    const N = body.normals;
    const loops = new Map<number, number[]>();
    for (let v = 0; v < P.length / 3; v++) {
      const c = closure.canal[v] as number;
      if (c < 0 || (closure.follows[v] as number) < LIP) continue;
      loops.set(c, [...(loops.get(c) ?? []), v]);
    }
    expect(loops.size).toBe(2);
    for (const [c, vs] of loops) {
      let worst = 0;
      for (const v of vs) {
        let near = -1;
        let best = Number.POSITIVE_INFINITY;
        for (const u of vs) {
          if (u === v) continue;
          const e = Math.hypot(
            ...[0, 1, 2].map((k) => (P[u * 3 + k] as number) - (P[v * 3 + k] as number)),
          );
          if (e < best) [near, best] = [u, e];
        }
        const dot = [0, 1, 2].reduce(
          (s, k) => s + (N[v * 3 + k] as number) * (N[near * 3 + k] as number),
          0,
        );
        worst = Math.max(worst, (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI);
      }
      expect(worst, `canal ${c}`).toBeLessThan(30);
    }
  });
});
