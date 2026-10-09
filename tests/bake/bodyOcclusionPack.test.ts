/**
 * The full bake of the body's own occlusion against the shipped pack. It casts
 * every ray at every occlusion corner, so it runs in the uninstrumented `bake`
 * project (vitest.config.ts).
 */
import { describe, expect, it } from "vitest";
import type { BodyOcclusion } from "../../src/format/assetFormat.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { OCCLUSION_KEYS, occlusionCorners } from "../../src/rig/occlusionKeys.ts";
import { loadFixtureAssets } from "../fixtures.ts";

const CORNERS = occlusionCorners(OCCLUSION_KEYS.length);

describe("the shipped body occlusion", { timeout: 900_000 }, () => {
  const assets = loadFixtureAssets();
  const shipped = assets.bodyOcclusion as BodyOcclusion;

  const compare = (fresh: BodyOcclusion, what: string) => {
    expect(Array.from(fresh.vertices), what).toEqual(Array.from(shipped.vertices));
    expect(fresh.values.length).toBe(shipped.vertices.length * CORNERS);
    let worst = 0;
    fresh.values.forEach((v, k) => {
      worst = Math.max(worst, Math.abs(v - (shipped.values[k] as number)));
    });
    // One byte per value: the same rays give the same bytes, bar a rounding at an edge.
    expect(worst, what).toBeLessThanOrEqual(1);
  };

  it("is what the code bakes, at every corner", () => {
    compare(new HumanoidModel(assets, { subdivision: 1 }).bakeBodyOcclusion(), "the default set");
  });

  it("does not depend on the worn set or the subdivision level", () => {
    // The body shades itself: nothing worn changes it, and no clothing hides its faces.
    compare(
      new HumanoidModel(assets, { subdivision: 0, attachments: [] }).bakeBodyOcclusion(),
      "nothing worn, level 0",
    );
  });
});
