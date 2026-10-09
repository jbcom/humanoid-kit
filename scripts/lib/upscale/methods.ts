/**
 * Upscaling by channel class (docs/evidence/upscale.md), each method chosen to
 * invent nothing: it reconstructs the source's own signal at a finer grid and
 * adds no detail the source does not hold.
 *
 * - Coverage (cut-out alphas, masks): the distance field the coverage already
 *   is. Across an antialiased edge a pixel's coverage is 0.5 plus the signed
 *   distance of its centre from the edge, in pixels, so the linear
 *   interpolation of coverage is that distance field sampled finer. Scaled to
 *   output pixels and re-rasterised with a one-pixel ramp, it draws the same
 *   edge crisply at the new size. It is exact for straight edges, and far from
 *   an edge it saturates to 0 or 1 as it should.
 * - Albedo: Lanczos-3 in linear light, premultiplied by alpha, so a colour
 *   averages as light does and transparent texels bleed nothing into edges.
 * - Normal maps: never resampled as vectors. The slopes are integrated into a
 *   height field (least squares in a cosine basis, so the edges are free), the
 *   height's exact slopes are evaluated at the new size, and the normals are
 *   derived from them. The part of the slopes no height explains is carried
 *   across as a residual, so nothing of the source is lost.
 *
 * Albedo and slopes are then back-projected (`backProject`): Lanczos lobes
 * clipped at black, and a derivative that is not the area average's inverse,
 * would otherwise move the result's average off the source's, on the darkest
 * texels most. (Clamping each texel to its 2×2 source range, the usual
 * anti-ringing step, was tried and measured worse: the clip is itself a
 * nonlinearity, adds harmonics above the source's band, and fights the
 * back-projection; docs/evidence/upscale.md.)
 */
import {
  areaResize,
  bilinearResize,
  channel,
  lanczosResize,
  linearFromSrgb,
  type Raster,
  raster,
  srgbFromLinear,
} from "./raster.ts";

export type ChannelClass = "albedo" | "coverage" | "normal";

/** What each class is upscaled by, as recorded in the provenance manifest. */
export const METHOD: Record<ChannelClass, string> = {
  albedo: "lanczos3 in linear light, premultiplied alpha, back-projected",
  coverage: "coverage as distance field, one-pixel ramp",
  normal:
    "height by least-squares cosine-basis integration, re-derived at the new size, residual lanczos3, back-projected slopes",
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Back-projection passes: enough for the round trip to settle well inside its gate. */
export const BACK_PROJECTIONS = 12;

/**
 * Iterative back-projection (Irani & Peleg 1991): adds to `out`, in place, the
 * Lanczos magnification of what its area-downsample still misses of `src`,
 * `BACK_PROJECTIONS` times, then `bound`s each texel. The correction is the
 * source's own residual, magnified, so it invents nothing, and it settles the
 * round trip that clamping and the interpolator's own response disturb.
 */
export function backProject(
  src: Raster,
  out: Raster,
  bound: (data: Float32Array, i: number) => void,
) {
  const texels = out.width * out.height;
  for (let pass = 0; pass < BACK_PROJECTIONS; pass++) {
    const down = areaResize(out, src.width, src.height);
    for (let i = 0; i < down.data.length; i++)
      down.data[i] = (src.data[i] as number) - (down.data[i] as number);
    const fix = lanczosResize(down, out.width, out.height);
    for (let i = 0; i < out.data.length; i++)
      out.data[i] = (out.data[i] as number) + (fix.data[i] as number);
    for (let i = 0; i < texels; i++) bound(out.data, i);
  }
  return out;
}

/** A one-channel coverage mask at `width`×`height`, its edges crisp at the new size. */
export function upscaleCoverage(alpha: Raster, width: number, height: number): Raster {
  if (alpha.channels !== 1) throw new RangeError("upscaleCoverage takes one channel");
  const scale = Math.sqrt((width * height) / (alpha.width * alpha.height));
  const up = bilinearResize(alpha, width, height);
  for (let i = 0; i < up.data.length; i++)
    up.data[i] = clamp01(((up.data[i] as number) - 0.5) * scale + 0.5);
  return up;
}

/**
 * An sRGB albedo (3 channels, or 4 with alpha) at `width`×`height`. With
 * `cutout`, the alpha is a coverage mask and is upscaled as one.
 */
export function upscaleAlbedo(
  rgba: Raster,
  width: number,
  height: number,
  cutout: boolean,
): Raster {
  const c = rgba.channels;
  if (c !== 3 && c !== 4) throw new RangeError("upscaleAlbedo takes RGB or RGBA");
  const n = rgba.width * rgba.height;
  const premultiplied = raster(rgba.width, rgba.height, 4);
  const straight = raster(rgba.width, rgba.height, 3);
  for (let i = 0; i < n; i++) {
    const a = c === 4 ? (rgba.data[i * 4 + 3] as number) : 1;
    for (let k = 0; k < 3; k++) {
      const v = linearFromSrgb(rgba.data[i * c + k] as number);
      straight.data[i * 3 + k] = v;
      premultiplied.data[i * 4 + k] = v * a;
    }
    premultiplied.data[i * 4 + 3] = a;
  }
  // Premultiplied colour stays within 0..alpha, alpha within 0..1.
  const bound = (d: Float32Array, i: number) => {
    const a = clamp01(d[i * 4 + 3] as number);
    d[i * 4 + 3] = a;
    for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.min(a, Math.max(0, d[i * 4 + k] as number));
  };
  const up = lanczosResize(premultiplied, width, height);
  for (let i = 0; i < width * height; i++) bound(up.data, i);
  backProject(premultiplied, up, bound);
  // Where the alpha is (near) zero the premultiplied colour says nothing: keep the straight colour.
  const upStraight = bilinearResize(straight, width, height);
  const alpha = cutout && c === 4 ? upscaleCoverage(channel(rgba, 3), width, height) : null;
  const out = raster(width, height, c);
  for (let i = 0; i < width * height; i++) {
    const a = clamp01(up.data[i * 4 + 3] as number);
    for (let k = 0; k < 3; k++) {
      const v =
        a > 1e-3 ? (up.data[i * 4 + k] as number) / a : (upStraight.data[i * 3 + k] as number);
      out.data[i * c + k] = srgbFromLinear(v);
    }
    if (c === 4) out.data[i * 4 + 3] = alpha ? (alpha.data[i] as number) : a;
  }
  return out;
}

/**
 * The cosine (or sine) basis of an `n`-texel axis sampled at `out` points
 * spread evenly over it: row i, column k is cos(πk(x + ½)/n) at
 * x = (i + ½)·n/out − ½, in source texels. At `out = n` it is the DCT-II's (or
 * DST-II's) analysis matrix. Its columns are the mirrored (free-edge) modes of
 * the axis, so a sum of them is band-limited and has no seam at the edges.
 */
function basis(n: number, out: number, fn: typeof Math.cos): Float64Array {
  const m = new Float64Array(out * n);
  for (let i = 0; i < out; i++)
    for (let k = 0; k < n; k++) m[i * n + k] = fn((Math.PI * k * (i + 0.5)) / out);
  return m;
}

/**
 * out[j·outW + i] = Σ_l By[j, l] Σ_k Bx[i, k] c[l·w + k], for `c` a `w`×`h`
 * grid, `Bx` outW×w and `By` outH×h: a separable transform (analysis or synthesis).
 */
function separable2(
  c: Float64Array,
  w: number,
  h: number,
  Bx: Float64Array,
  outW: number,
  By: Float64Array,
  outH: number,
): Float64Array {
  const t = new Float64Array(h * outW);
  for (let l = 0; l < h; l++)
    for (let i = 0; i < outW; i++) {
      let s = 0;
      for (let k = 0; k < w; k++) s += (c[l * w + k] as number) * (Bx[i * w + k] as number);
      t[l * outW + i] = s;
    }
  const out = new Float64Array(outH * outW);
  for (let j = 0; j < outH; j++)
    for (let l = 0; l < h; l++) {
      const b = By[j * h + l] as number;
      if (b === 0) continue;
      for (let i = 0; i < outW; i++)
        out[j * outW + i] = (out[j * outW + i] as number) + b * (t[l * outW + i] as number);
    }
  return out;
}

/**
 * A height in the mirrored cosine basis of a `w`×`h` grid,
 * h(x, y) = Σ H[l, k] cos(πk(x + ½)/w) cos(πl(y + ½)/h), whose exact
 * derivative best matches the slopes `gx` (along a row) and `gy` (down a
 * column) in least squares: Frankot & Chellappa's projection onto integrable
 * slopes (1988), in the cosine basis so the edges are free rather than
 * periodic. Its coefficients, mean zero.
 */
export function spectralHeight(
  gx: Float64Array,
  gy: Float64Array,
  w: number,
  h: number,
): Float64Array {
  const cosX = basis(w, w, Math.cos);
  const sinX = basis(w, w, Math.sin);
  const cosY = basis(h, h, Math.cos);
  const sinY = basis(h, h, Math.sin);
  // Analysis: the matrices are transposes of synthesis; Bx[k, x] ≡ basis[x, k].
  const transpose = (m: Float64Array, n: number) => {
    const t = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) t[k * n + i] = m[i * n + k] as number;
    return t;
  };
  const Gx = separable2(gx, w, h, transpose(sinX, w), w, transpose(cosY, h), h);
  const Gy = separable2(gy, w, h, transpose(cosX, w), w, transpose(sinY, h), h);
  const H = new Float64Array(w * h);
  for (let l = 0; l < h; l++)
    for (let k = 0; k < w; k++) {
      if (k === 0 && l === 0) continue;
      const a = (Math.PI * k) / w;
      const b = (Math.PI * l) / h;
      // Squared norms of the sin·cos and cos·sin modes over the grid.
      const nx = (w / 2) * (l === 0 ? h : h / 2);
      const ny = (k === 0 ? w : w / 2) * (h / 2);
      const gxk = k === 0 ? 0 : (Gx[l * w + k] as number) / nx;
      const gyl = l === 0 ? 0 : (Gy[l * w + k] as number) / ny;
      // ∂/∂x of cos(a(x + ½)) is −a·sin(a(x + ½)); least squares over both slopes.
      H[l * w + k] = -(a * gxk * nx + b * gyl * ny) / (a * a * nx + b * b * ny);
    }
  return H;
}

/**
 * The exact slopes, per source texel, of the height `H` (`spectralHeight` of a
 * `w`×`h` grid) at `outW`×`outH` points spread evenly over the grid.
 */
export function heightSlopes(H: Float64Array, w: number, h: number, outW: number, outH: number) {
  const dsin = (n: number, out: number) => {
    const m = basis(n, out, Math.sin);
    for (let i = 0; i < out; i++)
      for (let k = 0; k < n; k++) m[i * n + k] = ((m[i * n + k] as number) * -Math.PI * k) / n;
    return m;
  };
  return {
    dx: separable2(H, w, h, dsin(w, outW), outW, basis(h, outH, Math.cos), outH),
    dy: separable2(H, w, h, basis(w, outW, Math.cos), outW, dsin(h, outH), outH),
  };
}

/** Below this z a texel is no tangent-space normal (a map's unused black, say). */
const MIN_NZ = 0.05;

/**
 * Slopes of an encoded tangent-space normal map (OpenGL convention: green is
 * up in the texture, so down a row is minus it) per texel along a row and down
 * a column, and which texels hold a normal at all.
 */
export function slopesOf(n: Raster) {
  const count = n.width * n.height;
  const gx = new Float64Array(count);
  const gy = new Float64Array(count);
  const valid = raster(n.width, n.height, 1);
  for (let i = 0; i < count; i++) {
    const x = (n.data[i * n.channels] as number) * 2 - 1;
    const y = (n.data[i * n.channels + 1] as number) * 2 - 1;
    const z = (n.data[i * n.channels + 2] as number) * 2 - 1;
    if (z < MIN_NZ) continue;
    gx[i] = -x / z;
    gy[i] = y / z;
    valid.data[i] = 1;
  }
  return { gx, gy, valid };
}

/** Encodes slopes (along a row, down a column) as a tangent-space normal, 0..1. */
const encodeNormal = (sx: number, sy: number, out: Float32Array, o: number) => {
  const len = Math.hypot(sx, sy, 1);
  out[o] = (-sx / len) * 0.5 + 0.5;
  out[o + 1] = (sy / len) * 0.5 + 0.5;
  out[o + 2] = (1 / len) * 0.5 + 0.5;
};

/** An encoded tangent-space normal map (RGB or RGBA) at `width`×`height`, via its height. */
export function upscaleNormal(n: Raster, width: number, height: number): Raster {
  const { width: w, height: h } = n;
  const { gx, gy, valid } = slopesOf(n);
  // The mean slope is a plane, exact on its own; a cosine height with free edges
  // has none (its slopes are sines), and would ring trying to make one.
  let mx = 0;
  let my = 0;
  let count = 0;
  for (let i = 0; i < w * h; i++)
    if (valid.data[i]) {
      mx += gx[i] as number;
      my += gy[i] as number;
      count++;
    }
  mx /= Math.max(1, count);
  my /= Math.max(1, count);
  const fx = new Float64Array(w * h);
  const fy = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++)
    if (valid.data[i]) {
      fx[i] = (gx[i] as number) - mx;
      fy[i] = (gy[i] as number) - my;
    }
  const H = spectralHeight(fx, fy, w, h);
  const g = heightSlopes(H, w, h, w, h);
  // What no height explains (curl, and the Nyquist sine no cosine height has): carried as is.
  const residual = raster(w, h, 2);
  for (let i = 0; i < w * h; i++) {
    residual.data[i * 2] = (fx[i] as number) - (g.dx[i] as number);
    residual.data[i * 2 + 1] = (fy[i] as number) - (g.dy[i] as number);
  }
  const gUp = heightSlopes(H, w, h, width, height);
  const rUp = lanczosResize(residual, width, height);
  const validUp = upscaleCoverage(valid, width, height);
  const inside = (i: number) => (validUp.data[i] as number) >= 0.5;
  // The output's slopes (per source texel, as a normal's are scale-free): the
  // plane's, plus the height's, re-derived, plus the residual; zero off the islands.
  const slopes = raster(width, height, 2);
  for (let i = 0; i < width * height; i++)
    if (inside(i)) {
      slopes.data[i * 2] = mx + (gUp.dx[i] as number) + (rUp.data[i * 2] as number);
      slopes.data[i * 2 + 1] = my + (gUp.dy[i] as number) + (rUp.data[i * 2 + 1] as number);
    }
  const sourceSlopes = raster(w, h, 2);
  for (let i = 0; i < w * h; i++) {
    sourceSlopes.data[i * 2] = gx[i] as number;
    sourceSlopes.data[i * 2 + 1] = gy[i] as number;
  }
  backProject(sourceSlopes, slopes, (d, i) => {
    if (inside(i)) return;
    d[i * 2] = 0;
    d[i * 2 + 1] = 0;
  });
  // Outside the map's islands, the source's own background, magnified.
  const background = bilinearResize(n, width, height);
  const out = raster(width, height, n.channels);
  for (let i = 0; i < width * height; i++) {
    const o = i * n.channels;
    if (!inside(i)) {
      for (let k = 0; k < n.channels; k++) out.data[o + k] = background.data[o + k] as number;
      continue;
    }
    encodeNormal(slopes.data[i * 2] as number, slopes.data[i * 2 + 1] as number, out.data, o);
    if (n.channels === 4) out.data[o + 3] = background.data[o + 3] as number;
  }
  return out;
}

/** Downsamples an encoded normal map as its slopes average (for the round trip), keeping its islands. */
export function areaResizeNormal(n: Raster, width: number, height: number): Raster {
  const { gx, gy, valid } = slopesOf(n);
  const s = raster(n.width, n.height, 3);
  for (let i = 0; i < n.width * n.height; i++) {
    s.data[i * 3] = gx[i] as number;
    s.data[i * 3 + 1] = gy[i] as number;
    s.data[i * 3 + 2] = valid.data[i] as number;
  }
  const down = areaResize(s, width, height);
  const out = raster(width, height, 3);
  for (let i = 0; i < width * height; i++) {
    const v = down.data[i * 3 + 2] as number;
    if (v < 0.5) continue;
    encodeNormal(
      (down.data[i * 3] as number) / v,
      (down.data[i * 3 + 1] as number) / v,
      out.data,
      i * 3,
    );
  }
  return out;
}
