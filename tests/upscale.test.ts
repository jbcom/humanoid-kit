import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  albedoSpace,
  COLOUR_RANGE,
  newDetail,
  normalInterior,
  roundTripAlbedo,
  roundTripCoverage,
  roundTripNormal,
  slopeSpace,
  toneBucket,
  topology,
} from "../scripts/lib/upscale/gates.ts";
import {
  heightSlopes,
  slopesOf,
  spectralHeight,
  upscaleAlbedo,
  upscaleCoverage,
  upscaleNormal,
} from "../scripts/lib/upscale/methods.ts";
import { sha256File } from "../scripts/lib/upscale/provenance.ts";
import {
  areaResize,
  bilinearResize,
  channel,
  lanczosResize,
  linearFromSrgb,
  type Raster,
  raster,
  readRaster,
  srgbFromLinear,
  writeRaster,
} from "../scripts/lib/upscale/raster.ts";
import { aboveBandShare } from "../scripts/lib/upscale/spectrum.ts";
import { upscaleTexture } from "../scripts/lib/upscale/upscaleTexture.ts";
import { labFromLinear, linearFromLab } from "../src/surface/cielab.ts";

const image = (w: number, h: number, c: number, f: (x: number, y: number, k: number) => number) => {
  const r = raster(w, h, c);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let k = 0; k < c; k++) r.data[(y * w + x) * c + k] = f(x, y, k);
  return r;
};
const mean = (r: Raster) => r.data.reduce((s, v) => s + v, 0) / r.data.length;

/** The kit's deepest skin anchor (src/surface/skinTone.ts): L* 30 at ITA −75°, in sRGB. */
const DEEPEST_LAB: [number, number, number] = [30, 8, 20 / Math.tan((75 * Math.PI) / 180)];
const DEEPEST = linearFromLab(DEEPEST_LAB).map(srgbFromLinear);

/** An antialiased disc of radius `r` texels at the centre of a `n`² mask (coverage by 8× supersampling). */
const disc = (n: number, r: number, cx = n / 2, cy = n / 2) =>
  image(n, n, 1, (x, y) => {
    let inside = 0;
    for (let sy = 0; sy < 8; sy++)
      for (let sx = 0; sx < 8; sx++)
        if (Math.hypot(x + (sx + 0.5) / 8 - cx, y + (sy + 0.5) / 8 - cy) < r) inside++;
    return inside / 64;
  });

/** A height field's tangent-space normal map at `n`², sampled `s` texels per unit. */
const heightNormals = (n: number, s: number, h: (x: number, y: number) => number) =>
  image(n, n, 3, (x, y, k) => {
    const X = (x + 0.5) / s;
    const Y = (y + 0.5) / s;
    const e = 1e-3;
    const sx = (h(X + e, Y) - h(X - e, Y)) / (2 * e);
    const sy = (h(X, Y + e) - h(X, Y - e)) / (2 * e);
    const len = Math.hypot(sx, sy, 1);
    return [(-sx / len) * 0.5 + 0.5, (sy / len) * 0.5 + 0.5, (1 / len) * 0.5 + 0.5][k] as number;
  });
const bumps = (x: number, y: number) =>
  3 * Math.exp(-((x - 20) ** 2 + (y - 30) ** 2) / 80) + Math.sin(x / 5) * Math.cos(y / 7);

describe("the resamplers", () => {
  const r = image(16, 8, 2, (x, y, k) => (k ? x / 15 : y / 7) ** 2);

  it("area-downsamples to the exact mean of each footprint", () => {
    const down = areaResize(r, 4, 2);
    expect(mean(down)).toBeCloseTo(mean(r), 6);
    // The top-left output texel averages the source's top-left 4×4 block.
    let s = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s += r.data[(y * 16 + x) * 2] as number;
    expect(down.data[0]).toBeCloseTo(s / 16, 6);
  });

  it("magnifies a constant to the constant, by either filter", () => {
    const flat = image(5, 5, 1, () => 0.3);
    for (const up of [bilinearResize(flat, 20, 20), lanczosResize(flat, 20, 20)])
      for (const v of up.data) expect(v).toBeCloseTo(0.3, 6);
  });

  it("refuses to downsample with Lanczos", () => {
    expect(() => lanczosResize(r, 8, 4)).toThrow(RangeError);
  });

  it("writes and reads 16-bit and 8-bit PNGs, one channel or several", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hk-upscale-"));
    for (const [c, depth, tolerance] of [
      [3, 16, 1e-4],
      [1, 16, 1e-4],
      [4, 8, 1 / 255],
    ] as const) {
      const src = image(6, 4, c, (x, y, k) => (x + y * 6 + k) / (24 + c));
      const file = path.join(dir, `${c}-${depth}.png`);
      await writeRaster(src, file, depth);
      const back = await readRaster(file);
      expect([back.width, back.height, back.channels]).toEqual([6, 4, c]);
      for (let i = 0; i < src.data.length; i++)
        expect(Math.abs((back.data[i] as number) - (src.data[i] as number))).toBeLessThan(
          tolerance,
        );
    }
  });
});

describe("coverage, as a distance field", () => {
  const src = disc(32, 9);
  const up = upscaleCoverage(src, 128, 128);

  it("round-trips to the source's coverage and keeps its one region", () => {
    const g = roundTripCoverage(src, up);
    expect(g.pass).toBe(true);
    expect(g.output).toEqual(g.source);
  });

  it("draws the edge one output texel wide, as crisply as the source drew it", () => {
    // Along the middle row, the partly covered texels on each side of the disc.
    let partial = 0;
    for (let x = 0; x < 128; x++) {
      const a = up.data[64 * 128 + x] as number;
      if (a > 0.02 && a < 0.98) partial++;
    }
    expect(partial).toBeLessThanOrEqual(4);
  });

  it("finds new regions and holes", () => {
    const two = image(16, 16, 1, (x, y) => (x < 5 || x > 10 ? 1 : 0) * (y > 2 && y < 13 ? 1 : 0));
    const ring = image(16, 16, 1, (x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      return d > 3 && d < 6 ? 1 : 0;
    });
    expect(topology(two)).toEqual({ regions: 2, holes: 0 });
    expect(topology(ring)).toEqual({ regions: 1, holes: 1 });
    // A speck where the source had none is a new feature.
    const speck = upscaleCoverage(disc(16, 4), 64, 64);
    speck.data[2 * 64 + 2] = 1;
    expect(roundTripCoverage(disc(16, 4), speck).noNewFeatures).toBe(false);
  });
});

describe("albedo, Lanczos in linear light, back-projected", () => {
  // The deepest skin, a band of near black (a painted line), and a light
  // gradient, with hard edges between: the worst case for Lanczos lobes
  // clipped at zero, which back-projection exists to settle.
  const src = image(64, 64, 3, (x, y, k) =>
    x < 24
      ? (DEEPEST[k] as number)
      : x < 30
        ? 0.02 + 0.01 * k
        : 0.55 + 0.2 * Math.sin(y / 5) - 0.1 * k,
  );
  const up = upscaleAlbedo(src, 256, 256, false);
  /** Lanczos alone, clipped to 0..1, as a plain resampler would leave it. */
  const plain = lanczosResize(src, 256, 256);
  for (let i = 0; i < plain.data.length; i++)
    plain.data[i] = Math.min(1, Math.max(0, plain.data[i] as number));

  it("passes the round trip in every tone bucket, the deepest included", () => {
    const g = roundTripAlbedo(src, up);
    expect(g.pass).toBe(true);
    expect(g.buckets.dark.n).toBeGreaterThanOrEqual(1000);
    expect(g.buckets.dark.mean).toBeLessThan(0.1);
  });

  it("settles what clipping at black shifts, which a plain resampler leaves", () => {
    const settled = roundTripAlbedo(src, up).buckets["not skin"];
    const clipped = roundTripAlbedo(src, plain).buckets["not skin"];
    expect(settled.n).toBeGreaterThan(0);
    expect(clipped.mean).toBeGreaterThan(settled.mean * 2);
  });

  it("adds no detail beyond a Lanczos interpolation's to smooth colour", () => {
    const smooth = image(32, 32, 3, (x, y, k) => 0.3 + 0.1 * Math.sin(x / 4 + k) * Math.cos(y / 6));
    const out = upscaleAlbedo(smooth, 128, 128, false);
    expect(newDetail(smooth, out, albedoSpace, undefined, COLOUR_RANGE).pass).toBe(true);
  });

  it("upscales a cut-out's alpha as coverage", () => {
    const rgba = image(32, 32, 4, (x, y, k) =>
      k === 3 ? (disc(32, 10).data[y * 32 + x] as number) : 0.5,
    );
    const out = upscaleAlbedo(rgba, 64, 64, true);
    expect(roundTripCoverage(channel(rgba, 3), channel(out, 3)).pass).toBe(true);
  });
});

describe("the gates catch invention", () => {
  const src = image(32, 32, 3, (x, y, k) => 0.3 + 0.1 * Math.sin(x / 4 + k) * Math.cos(y / 6));
  const honest = upscaleAlbedo(src, 128, 128, false);

  it("fails texture finer than the source had (pores a learned model might paint)", () => {
    const pores = raster(128, 128, 3, Float32Array.from(honest.data));
    for (let i = 0; i < 128 * 128; i++) {
      const x = i % 128;
      const y = (i - x) / 128;
      const p = 0.06 * Math.sin(x * 2.1) * Math.sin(y * 2.3);
      for (let k = 0; k < 3; k++) pores.data[i * 3 + k] = (pores.data[i * 3 + k] as number) + p;
    }
    expect(newDetail(src, pores, albedoSpace, undefined, COLOUR_RANGE).pass).toBe(false);
  });

  it("fails a pattern in one corner that the whole image's average would hide", () => {
    // A stipple over one 32-texel tile of 16: 1/16 of the area.
    const stipple = raster(128, 128, 3, Float32Array.from(honest.data));
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++)
        for (let k = 0; k < 3; k++)
          stipple.data[(y * 128 + x) * 3 + k] =
            (stipple.data[(y * 128 + x) * 3 + k] as number) + ((x + y) % 2 ? 0.04 : -0.04);
    const g = newDetail(src, stipple, albedoSpace, undefined, COLOUR_RANGE);
    expect(g.localP99).toBeGreaterThan(0.05);
    expect(g.pass).toBe(false);
  });

  describe("a shift of tone", () => {
    // The deepest skin tone on a third of the image, a light one on the rest.
    const light = [0.85, 0.68, 0.6];
    const tones = image(64, 64, 3, (x, _y, k) => (x < 20 ? DEEPEST[k] : light[k]) as number);
    const up = upscaleAlbedo(tones, 128, 128, false);
    /** `up` with the texels of one tone scaled by `f` in linear light. */
    const shift = (dark: boolean, f: number) => {
      const out = raster(128, 128, 3, Float32Array.from(up.data));
      for (let i = 0; i < 128 * 128; i++)
        if ((up.data[i * 3] as number) < 0.5 === dark)
          for (let k = 0; k < 3; k++)
            out.data[i * 3 + k] = srgbFromLinear(linearFromSrgb(up.data[i * 3 + k] as number) * f);
      return roundTripAlbedo(tones, out);
    };

    it("passes when there is none", () => {
      expect(roundTripAlbedo(tones, up).pass).toBe(true);
    });

    it("fails 3% on the deep tone alone, though CIEDE2000 there stays far below 1", () => {
      const g = shift(true, 0.97);
      expect(g.buckets.dark.mean).toBeLessThan(0.5);
      expect(g.buckets.dark.luminanceBias).toBeCloseTo(-0.03, 2);
      expect(g.pass).toBe(false);
    });

    it("judges the same relative shift alike on the light tone", () => {
      const g = shift(false, 0.97);
      expect(g.buckets["very light"].luminanceBias).toBeCloseTo(-0.03, 2);
      expect(g.pass).toBe(false);
    });
  });

  it("buckets tones by ITA°, from very light to dark, and leaves what is no skin out", () => {
    expect(toneBucket(labFromLinear([0.7, 0.55, 0.47]))).toBe("very light");
    expect(toneBucket(DEEPEST_LAB)).toBe("dark");
    // Black ink, and a grey with no yellow in it, are not skin tones.
    expect(toneBucket(labFromLinear([0.002, 0.002, 0.002]))).toBe("not skin");
    expect(toneBucket(labFromLinear([0.05, 0.05, 0.06]))).toBe("not skin");
  });

  it("measures power above the source's Nyquist", () => {
    const low = image(64, 64, 1, (x) => Math.sin((2 * Math.PI * 4 * x) / 64));
    const high = image(64, 64, 1, (x) => Math.sin((2 * Math.PI * 24 * x) / 64));
    expect(aboveBandShare(low, { width: 32, height: 32 })).toBeLessThan(0.01);
    expect(aboveBandShare(high, { width: 32, height: 32 })).toBeGreaterThan(0.99);
    // Any size: 96 texels upscaled from 40 (Nyquist 20 cycles across the image).
    const low96 = image(96, 96, 1, (x) => Math.sin((2 * Math.PI * 10 * x) / 96));
    const high96 = image(96, 96, 1, (x) => Math.sin((2 * Math.PI * 30 * x) / 96));
    expect(aboveBandShare(low96, { width: 40, height: 40 })).toBeLessThan(0.02);
    expect(aboveBandShare(high96, { width: 40, height: 40 })).toBeGreaterThan(0.98);
  });
});

describe("normal maps, through their height", () => {
  const src = heightNormals(64, 1, bumps);
  const truth = heightNormals(128, 2, bumps);
  const up = upscaleNormal(src, 128, 128);

  it("integrates the slopes into the height they came from", () => {
    const { gx, gy } = slopesOf(src);
    const fit = heightSlopes(spectralHeight(gx, gy, 64, 64), 64, 64, 64, 64);
    let worst = 0;
    for (let i = 0; i < 64 * 64; i++)
      worst = Math.max(worst, Math.abs((fit.dx[i] as number) - (gx[i] as number)));
    expect(worst).toBeLessThan(0.02);
  });

  it("re-derives normals that match the height's own at the finer size", () => {
    // Away from the image's edges, where a band-limited fit of a field that does
    // not continue past them rings (on a texture atlas, the unused margin).
    let sum = 0;
    let n = 0;
    for (let y = 16; y < 112; y++)
      for (let x = 16; x < 112; x++) {
        const i = y * 128 + x;
        const v = [0, 1, 2].map((k) => (up.data[i * 3 + k] as number) * 2 - 1);
        const u = [0, 1, 2].map((k) => (truth.data[i * 3 + k] as number) * 2 - 1);
        const dot =
          v.reduce((s, x, k) => s + x * (u[k] as number), 0) /
          (Math.hypot(...v) * Math.hypot(...u));
        sum += (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
        n++;
      }
    expect(sum / n).toBeLessThan(0.15);
  });

  it("passes the round trip and adds no detail", () => {
    expect(roundTripNormal(src, up).pass).toBe(true);
    expect(newDetail(src, up, slopeSpace, normalInterior(src, 128, 128)).pass).toBe(true);
  });

  it("keeps a flat map flat and the unused background as it was", () => {
    const flat = image(16, 16, 3, (x, _y, k) => (x < 4 ? 0 : ([0.5, 0.5, 1][k] as number)));
    const out = upscaleNormal(flat, 64, 64);
    for (let y = 0; y < 64; y++)
      for (let x = 20; x < 64; x++) {
        const o = (y * 64 + x) * 3;
        expect(
          [out.data[o], out.data[o + 1], out.data[o + 2]].map((v) =>
            Number((v as number).toFixed(4)),
          ),
        ).toEqual([0.5, 0.5, 1]);
      }
    expect(out.data[0]).toBe(0);
  });
});

describe("an upscale's manifest entry", () => {
  const sys = fs.mkdtempSync(path.join(os.tmpdir(), "hk-upscale-"));
  fs.mkdirSync(path.join(sys, "clothes"));
  const request = (file: string, edge: number) => ({
    source: path.join(sys, "clothes", file),
    systemDir: sys,
    cls: "normal" as const,
    cutout: false,
    edge,
    framing: "clothed",
    needed: edge,
  });

  it("names its source and code by hash, its licence, and no learned weights", async () => {
    await writeRaster(heightNormals(32, 1, bumps), path.join(sys, "clothes", "bumps.png"), 8);
    const { raster: out, entry } = await upscaleTexture(request("bumps.png", 64));
    expect([out.width, out.height]).toEqual([64, 64]);
    expect(entry.source).toBe("clothes/bumps.png");
    expect(entry.sourceSha256).toBe(sha256File(path.join(sys, "clothes", "bumps.png")));
    expect(entry.tool.version).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entry.weights).toBeNull();
    expect(entry.licence).toBe("CC0-1.0");
    expect(entry.parameters.scale).toBe(2);
    expect(entry.pass).toBe(true);
  });

  it("passes a flat map, whose rounding is no pattern", async () => {
    await writeRaster(
      image(16, 16, 3, (_x, _y, k) => [0.5, 0.5, 1][k] as number),
      path.join(sys, "clothes", "flat.png"),
      8,
    );
    const { entry } = await upscaleTexture(request("flat.png", 64));
    expect(entry.pass).toBe(true);
  });
});
