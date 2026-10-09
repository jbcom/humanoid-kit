/**
 * Full attachment-occlusion bakes of the figure against the shipped pack.
 * They cast every ray of every occlusion corner, so they run in the
 * uninstrumented `bake` project (vitest.config.ts).
 */
import { describe, expect, it } from "vitest";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { OCCLUSION_KEYS, occlusionCorners } from "../../src/rig/occlusionKeys.ts";
import { loadFixtureAssets } from "../fixtures.ts";

const CORNERS = occlusionCorners(OCCLUSION_KEYS.length);

describe("the shipped attachment occlusion", { timeout: 300_000 }, () => {
  it("is what the code bakes, at every corner, whatever the subdivision level", () => {
    const assets = loadFixtureAssets();
    for (const level of [0, 1]) {
      const baked = new HumanoidModel(assets, { subdivision: level }).bakeAttachmentOcclusion();
      [...assets.attachments.values()].forEach((a, i) => {
        const fresh = baked[i] as Float32Array;
        expect(fresh.length).toBe(a.entry.vertexCount * CORNERS);
        let worst = 0;
        fresh.forEach((v, k) => {
          worst = Math.max(worst, Math.abs(v - (a.occlusion[k] as number) / 255));
        });
        // One byte per value: at most half a step of rounding.
        expect(worst, `${a.entry.id} at level ${level}`).toBeLessThanOrEqual(0.5 / 255 + 1e-6);
      });
    }
  });

  it("is baked at rest at load for a set the pack did not bake, and posed afterwards", () => {
    const assets = loadFixtureAssets();
    const teethOnly = { subdivision: 0, attachments: ["teeth/base"] };
    const model = new HumanoidModel(assets, teethOnly);
    const atLoad = model.topology().attachments[0]?.occlusion ?? new Float32Array(0);
    expect(atLoad.length).toBeGreaterThan(0);
    // At load every corner holds the rest value.
    atLoad.forEach((v, k) => {
      expect(v).toBe(atLoad[k - (k % CORNERS)]);
    });
    const steps = model.bakePosedOcclusion();
    let yields = 0;
    let step = steps.next();
    for (; !step.done; step = steps.next()) yields++;
    // One pause before each corner after rest.
    expect(yields).toBe(CORNERS - 1);
    const posed = step.value?.[0] ?? new Float32Array(0);
    expect(posed.length).toBe(atLoad.length);
    // Rest is unchanged, the corners are the model's own bake: at level 0 the
    // render vertices are the control vertices split at UV seams, so every
    // rendered value is one of the baked values, and the open mouth uncovers teeth.
    posed.forEach((v, k) => {
      if (k % CORNERS === 0) expect(v).toBe(atLoad[k]);
    });
    const reference = new HumanoidModel(assets, teethOnly).bakeAttachmentOcclusion()[0];
    const bakedValues = new Set(reference);
    expect([...posed].every((v) => bakedValues.has(v))).toBe(true);
    const mean = (m: number) =>
      posed.reduce((s, v, k) => (k % CORNERS === m ? s + v : s), 0) / (posed.length / CORNERS);
    expect(mean(1)).toBeGreaterThan(mean(0));
  });

  it("is not baked again for the pack's own set", () => {
    const model = new HumanoidModel(loadFixtureAssets(), { subdivision: 0 });
    expect(model.bakePosedOcclusion().next()).toEqual({ done: true, value: null });
  });
});
