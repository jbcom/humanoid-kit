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

/**
 * CIEDE2000 colour difference (kL = kC = kH = 1), following Sharma, Wu &
 * Dalal (2005), including their notes on the mean hue and hue difference when
 * one colour is achromatic or the hues straddle 0°. Verified against their 34
 * published test pairs (tests/colour.test.ts).
 */
export function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, ap: number) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt(
    (dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH),
  );
}

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
