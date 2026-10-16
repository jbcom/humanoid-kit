import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ageRegions, rasteriseUv } from "../scripts/lib/ageSurfaceMap.ts";
import { skinZones } from "../src/surface/regions/skinZones.ts";
import { bodyDir, loadFixtureAssets } from "./fixtures.ts";

describe("the shipped age surface", () => {
  it("leaves the neck neutral while retaining photographed face and dorsal-hand detail", async () => {
    const assets = loadFixtureAssets();
    const regions = ageRegions(assets);
    const zones = skinZones(assets);
    const size = 512;
    const raster = rasteriseUv(assets, size, [
      regions.face,
      zones.neck,
      regions.hand,
      zones.zone("head"),
    ]);
    const { data, info } = await sharp(path.join(bodyDir, "age-surface.webp"))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([2048, 2048, 3]);

    const at = (x: number, y: number) => {
      const i = y * size + x;
      return [
        raster.cover[i] as number,
        raster.values[i * 4] as number,
        raster.values[i * 4 + 1] as number,
        raster.values[i * 4 + 2] as number,
        raster.values[i * 4 + 3] as number,
      ] as const;
    };
    const channel = (x: number, y: number, c: 0 | 1) =>
      data[((4 * y + 2) * 2048 + 4 * x + 2) * 3 + c] as number;
    let neckSamples = 0;
    const neckNonneutral: [number, number] = [0, 0];
    const detail: { face: [number, number]; hand: [number, number] } = {
      face: [0, 0],
      hand: [0, 0],
    };
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        const [covered, face, neck, hand, head] = at(x, y);
        if (!covered) continue;
        for (const c of [0, 1] as const) {
          if (face > 0.5 && channel(x, y, c) < 128) detail.face[c]++;
          if (hand > 0.5 && channel(x, y, c) < 128) detail.hand[c]++;
        }
        // Stay clear of face texels that the low-resolution mask could classify as neck.
        if (face >= 0.01 || neck <= 0.98 || hand >= 0.01 || head >= 0.2) continue;
        let interior = true;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const [nearCovered, nearFace, nearNeck, nearHand, nearHead] = at(x + dx, y + dy);
            if (
              !nearCovered ||
              nearFace >= 0.01 ||
              nearNeck <= 0.98 ||
              nearHand >= 0.01 ||
              nearHead >= 0.2
            )
              interior = false;
          }
        if (!interior) continue;
        neckSamples++;
        for (const c of [0, 1] as const) if (channel(x, y, c) !== 128) neckNonneutral[c]++;
      }
    expect(neckSamples).toBeGreaterThan(1_000);
    expect(neckNonneutral).toEqual([0, 0]);
    expect(detail.face[0]).toBeGreaterThan(100);
    expect(detail.face[1]).toBeGreaterThan(100);
    expect(detail.hand[0]).toBeGreaterThan(100);
    expect(detail.hand[1]).toBeGreaterThan(100);
  });
});
