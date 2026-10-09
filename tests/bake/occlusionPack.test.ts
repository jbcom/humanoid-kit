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

  it("is baked at load for a set of attachments the pack did not bake", () => {
    const assets = loadFixtureAssets();
    const eyesOnly = { subdivision: 0, attachments: ["eyes/high-poly"] };
    const fromTopology = new HumanoidModel(assets, eyesOnly).topology().attachments[0]?.occlusion;
    // The same model's own bake, carried to its render vertices, is what it shows.
    const reference = new HumanoidModel(assets, eyesOnly).bakeAttachmentOcclusion()[0];
    expect(fromTopology?.length).toBeGreaterThan(0);
    // At level 0 the render vertices are the control vertices split at UV seams,
    // so every rendered value is one of the baked values.
    const bakedValues = new Set(reference);
    expect([...(fromTopology ?? [])].every((v) => bakedValues.has(v))).toBe(true);
  });
});
