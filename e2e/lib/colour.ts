/** CIELAB (D65) from 8-bit sRGB or linear RGB, for comparing renders with albedos. */
export type Lab = [number, number, number];

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function labFromLinear([r, g, b]: readonly [number, number, number]): Lab {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const labFromSrgb8 = (r: number, g: number, b: number): Lab =>
  labFromLinear([toLinear(r), toLinear(g), toLinear(b)]);

export const chroma = ([, a, b]: Lab) => Math.hypot(a, b);
export const hueDeg = ([, a, b]: Lab) => (Math.atan2(b, a) * 180) / Math.PI;

/** Smallest signed difference between two hue angles, in degrees. */
export const hueDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/**
 * Summarises the figure's pixels in an RGBA region: median L* (robust to
 * highlights and shadow) and mean a*, b* over the middle 60% by lightness, so
 * eye whites, nostrils and specular peaks do not dominate.
 *
 * Background is keyed out and the mask is eroded by `erode` pixels, so
 * anti-aliased edge pixels, which blend in the key colour, are not counted.
 */
export function summarise(
  rgba: Uint8ClampedArray | number[],
  width: number,
  background: [number, number, number],
  erode = 2,
): Lab | null {
  const height = rgba.length / 4 / width;
  const isBackground = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const d =
      Math.abs((rgba[p * 4] as number) - background[0]) +
      Math.abs((rgba[p * 4 + 1] as number) - background[1]) +
      Math.abs((rgba[p * 4 + 2] as number) - background[2]);
    isBackground[p] = d < 24 ? 1 : 0;
  }
  const nearBackground = (x: number, y: number) => {
    for (let dy = -erode; dy <= erode; dy++)
      for (let dx = -erode; dx <= erode; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        if (isBackground[yy * width + xx]) return true;
      }
    return false;
  };
  const labs: Lab[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (nearBackground(x, y)) continue;
      const i = (y * width + x) * 4;
      labs.push(labFromSrgb8(rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number));
    }
  if (labs.length < 500) return null;
  labs.sort((p, q) => p[0] - q[0]);
  const mid = labs.slice(Math.floor(labs.length * 0.2), Math.ceil(labs.length * 0.8));
  const median = (labs[Math.floor(labs.length / 2)] as Lab)[0];
  const a = mid.reduce((s, l) => s + l[1], 0) / mid.length;
  const b = mid.reduce((s, l) => s + l[2], 0) / mid.length;
  return [median, a, b];
}
