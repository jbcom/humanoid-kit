import { describe, expect, it } from "vitest";
import { strandMapFromRgba } from "../scripts/lib/strandMap.ts";
import { HAIR_STRAND_MEAN } from "../src/surface/hairTone.ts";

const SIZE = 64;
const srgbToLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** An RGBA image from a per-pixel function returning [r, g, b, a] (0..255). */
const image = (f: (x: number, y: number) => [number, number, number, number]) => {
  const px = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) px.set(f(x, y), (y * SIZE + x) * 4);
  return px;
};

/** Mean linear luminance of the texels a strand map's own alpha calls opaque, weighted by alpha. */
const meanLinear = (rgba: Uint8Array) => {
  let sum = 0;
  let w = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = (rgba[i + 3] as number) / 255;
    sum += srgbToLinear(rgba[i] as number) * a;
    w += a;
  }
  return sum / w;
};

describe("strandMapFromRgba", () => {
  // Vertical stripes of varying brightness, in a dark brown, with a clear corner.
  const stripes = image((x, y) => {
    if (x < 8 && y < 8) return [0, 0, 0, 0];
    const v = 30 + (x % 4) * 10;
    return [v * 1.4, v, v * 0.6, 255];
  });

  it("scales the luminance so its alpha-weighted mean is the strand mean", () => {
    const m = strandMapFromRgba(stripes, SIZE, SIZE);
    expect(meanLinear(m.rgba)).toBeCloseTo(HAIR_STRAND_MEAN, 2);
  });

  it("keeps the mean when a dark atlas's bright strands clip: the gain is solved, not assumed", () => {
    // Nine texels in ten near black, one in ten bright: scaling the dark ones up to the
    // mean would push the bright ones past white.
    const glints = image((x, y) =>
      (x + y * 3) % 10 === 0 ? [200, 200, 200, 255] : [12, 12, 12, 255],
    );
    const m = strandMapFromRgba(glints, SIZE, SIZE);
    expect(meanLinear(m.rgba)).toBeCloseTo(HAIR_STRAND_MEAN, 2);
    // The gain is larger than the naive one, and the glints did clip.
    expect(m.gain).toBeGreaterThan(HAIR_STRAND_MEAN / m.sourceMean);
    expect(m.rgba.some((v, i) => i % 4 === 0 && v === 255)).toBe(true);
  });

  it("is grey: the source's hue is gone, whatever colour the atlas was painted in", () => {
    const red = image(() => [200, 60, 30, 255]);
    const m = strandMapFromRgba(red, SIZE, SIZE);
    for (let i = 0; i < m.rgba.length; i += 4) {
      expect(m.rgba[i + 1]).toBe(m.rgba[i]);
      expect(m.rgba[i + 2]).toBe(m.rgba[i]);
    }
  });

  it("gives equal-luminance atlases of different hues the same map", () => {
    // Rec. 709 luminance of (r, g, b) matched by a grey of the same linear luminance.
    const warm = image(() => [180, 90, 40, 255]);
    const y = 0.2126 * srgbToLinear(180) + 0.7152 * srgbToLinear(90) + 0.0722 * srgbToLinear(40);
    const grey = Math.round(255 * (y <= 0.0031308 ? y * 12.92 : 1.055 * y ** (1 / 2.4) - 0.055));
    const plain = image(() => [grey, grey, grey, 255]);
    const a = strandMapFromRgba(warm, SIZE, SIZE);
    const b = strandMapFromRgba(plain, SIZE, SIZE);
    for (let i = 0; i < a.rgba.length; i += 4)
      expect(Math.abs((a.rgba[i] as number) - (b.rgba[i] as number))).toBeLessThanOrEqual(1);
  });

  it("leaves alpha untouched and does not let clear texels set the mean", () => {
    const m = strandMapFromRgba(stripes, SIZE, SIZE);
    for (let i = 3; i < stripes.length; i += 4) expect(m.rgba[i]).toBe(stripes[i]);
    // Brightening only the clear texels' colour must not change the opaque ones.
    const brightClear = image((x, y) =>
      x < 8 && y < 8
        ? [255, 255, 255, 0]
        : ([30 + (x % 4) * 10, 30 + (x % 4) * 10, 30 + (x % 4) * 10, 255] as [
            number,
            number,
            number,
            number,
          ]),
    );
    const dark = image((x, y) =>
      x < 8 && y < 8
        ? [0, 0, 0, 0]
        : ([30 + (x % 4) * 10, 30 + (x % 4) * 10, 30 + (x % 4) * 10, 255] as [
            number,
            number,
            number,
            number,
          ]),
    );
    expect(strandMapFromRgba(brightClear, SIZE, SIZE).rgba).toEqual(
      strandMapFromRgba(dark, SIZE, SIZE).rgba,
    );
  });

  it("reports the gain it applied and the source's mean, so a dark atlas is visibly dark", () => {
    const m = strandMapFromRgba(
      image(() => [40, 40, 40, 255]),
      SIZE,
      SIZE,
    );
    expect(m.sourceMean).toBeCloseTo(srgbToLinear(40), 4);
    expect(m.gain).toBeCloseTo(HAIR_STRAND_MEAN / srgbToLinear(40), 3);
  });

  it("finds strands along V in vertical stripes and along U in horizontal ones, with high coherence", () => {
    const vertical = image((x) => [60 + (x % 4) * 40, 60 + (x % 4) * 40, 60 + (x % 4) * 40, 255]);
    const horizontal = image((_, y) => [
      60 + (y % 4) * 40,
      60 + (y % 4) * 40,
      60 + (y % 4) * 40,
      255,
    ]);
    const v = strandMapFromRgba(vertical, SIZE, SIZE);
    const h = strandMapFromRgba(horizontal, SIZE, SIZE);
    // Strand direction in texture space, radians from U: stripes that vary along x run along V.
    expect(Math.abs(Math.sin(v.strandAngle))).toBeGreaterThan(0.99);
    expect(Math.abs(Math.cos(h.strandAngle))).toBeGreaterThan(0.99);
    expect(v.coherence).toBeGreaterThan(0.9);
    expect(h.coherence).toBeGreaterThan(0.9);
  });

  it("finds no direction in noise: low coherence", () => {
    let s = 12345;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
    const noise = image(() => {
      const g = 40 + Math.floor(rand() * 180);
      return [g, g, g, 255];
    });
    expect(strandMapFromRgba(noise, SIZE, SIZE).coherence).toBeLessThan(0.15);
  });

  it("refuses an image with no opaque texel", () => {
    expect(() =>
      strandMapFromRgba(
        image(() => [10, 10, 10, 0]),
        SIZE,
        SIZE,
      ),
    ).toThrow(/opaque/);
  });
});
