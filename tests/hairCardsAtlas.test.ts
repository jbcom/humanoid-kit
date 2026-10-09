/** The authored strand maps (scripts/lib/hairCards/atlas.ts): drawn from vector shapes, periodic round a tube. */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ATLAS_HEIGHT,
  braidAtlas,
  coilCropAtlas,
  connectedPart,
  locAtlas,
  PAD,
  TILE_COUNT,
  TILE_WIDTH,
  tileRange,
  twistAtlas,
} from "../scripts/lib/hairCards/atlas.ts";

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

describe.each([
  ["braid", braidAtlas],
  ["twist", twistAtlas],
  ["loc", locAtlas],
] as const)("the %s atlas", (_name, make) => {
  it("is one image of tiles, opaque, with a spread of brightness", async () => {
    const { data, width, height } = await pixels(await make());
    expect(width).toBe(TILE_WIDTH * TILE_COUNT);
    expect(height).toBe(ATLAS_HEIGHT);
    let min = 255;
    let max = 0;
    for (let i = 0; i < width * height; i++) {
      expect(data[i * 4 + 3]).toBe(255);
      min = Math.min(min, data[i * 4] as number);
      max = Math.max(max, data[i * 4] as number);
    }
    // Structure to read as strands: dark crevices and light crests.
    expect(max - min).toBeGreaterThan(120);
  });

  it("repeats round each tile: the padding beyond a tile's pattern is the pattern's own start", async () => {
    const { data, width, height } = await pixels(await make());
    const period = TILE_WIDTH - 2 * PAD;
    for (let k = 0; k < TILE_COUNT; k++) {
      let worst = 0;
      let sum = 0;
      let count = 0;
      for (let y = 8; y < height - 8; y += 3)
        for (let i = 2; i < PAD - 1; i++) {
          // The first padding columns are the pattern's last ones, one period on.
          const a = data[(y * width + k * TILE_WIDTH + i) * 4] as number;
          const b = data[(y * width + k * TILE_WIDTH + i + period) * 4] as number;
          worst = Math.max(worst, Math.abs(a - b));
          sum += Math.abs(a - b);
          count++;
        }
      // (The soft blur and the clip leave a few levels; a seam would be a fifth of the range.)
      expect(sum / count, `tile ${k} mean seam error`).toBeLessThan(6);
      expect(worst, `tile ${k} worst seam error`).toBeLessThan(90);
    }
  });

  it("is made the same every time", async () => {
    expect((await make()).equals(await make())).toBe(true);
  });
});

describe("tileRange", () => {
  it("keeps each tile's U range inside its own columns, clear of the padding, and apart from the next", () => {
    for (let k = 0; k < TILE_COUNT; k++) {
      const { u0, u1 } = tileRange(k);
      const total = TILE_WIDTH * TILE_COUNT;
      expect(u0 * total).toBeCloseTo(k * TILE_WIDTH + PAD, 6);
      expect(u1 * total).toBeCloseTo((k + 1) * TILE_WIDTH - PAD, 6);
    }
  });
});

describe("the coil crop atlas", () => {
  // A cut-out of two blobs: one at the top (the cap) and a loose card below, not touching it.
  const width = 96;
  const height = 96;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (x > 8 && x < 88 && y > 6 && y < 50) alpha[y * width + x] = 255;
      if (x > 30 && x < 40 && y > 60 && y < 92) alpha[y * width + x] = 255;
    }
  const cutout = { width, height, alpha };

  it("finds the connected part from a texel in it, and not the loose card", () => {
    const keep = connectedPart(cutout, 48, 20);
    expect(keep[20 * width + 48]).toBe(1);
    expect(keep[70 * width + 35]).toBe(0);
    expect(keep[60 * width + 60]).toBe(0);
  });

  it("draws coils only inside the kept part, and breaks its edge into a ragged one", async () => {
    const keep = connectedPart(cutout, 48, 20);
    const { data } = await pixels(await coilCropAtlas(cutout, keep));
    let outside = 0;
    let inside = 0;
    let levels = new Set<number>();
    for (let i = 0; i < width * height; i++) {
      const a = data[i * 4 + 3] as number;
      if (!keep[i]) outside += a === 0 ? 0 : 1;
      else {
        inside += a === 255 ? 1 : 0;
        levels.add(data[i * 4] as number);
      }
    }
    expect(outside).toBe(0);
    expect(inside).toBeGreaterThan(0.6 * 80 * 44);
    // The coils have brightness of their own, not one flat grey.
    expect(levels.size).toBeGreaterThan(8);
    levels = new Set();
  });

  it("is made the same every time", async () => {
    const keep = connectedPart(cutout, 48, 20);
    expect((await coilCropAtlas(cutout, keep)).equals(await coilCropAtlas(cutout, keep))).toBe(
      true,
    );
  });
});
