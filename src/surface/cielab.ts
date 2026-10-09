/**
 * CIELAB (D65 white) to and from linear sRGB, for colour models that are
 * measured in CIELAB (skin, lips) and rendered in linear sRGB. The matrices are
 * sRGB's (IEC 61966-2-1) with the D65 white point.
 */
import type { Rgb } from "./skinTone.ts";

export type Lab = [number, number, number];

const WHITE = [0.95047, 1, 1.08883] as const;
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

export function labFromLinear([r, g, b]: Readonly<Rgb>): Lab {
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / WHITE[0],
    (0.2126 * r + 0.7152 * g + 0.0722 * b) / WHITE[1],
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / WHITE[2],
  ];
  const [fx, fy, fz] = xyz.map((t) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116)) as [
    number,
    number,
    number,
  ];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function linearFromLab([L, a, b]: Readonly<Lab>): Rgb {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (f: number) => (f ** 3 > EPSILON ? f ** 3 : (116 * f - 16) / KAPPA);
  const x = inv(fx) * WHITE[0];
  const y = (L > KAPPA * EPSILON ? fy ** 3 : L / KAPPA) * WHITE[1];
  const z = inv(fz) * WHITE[2];
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

/** Lightness, chroma and hue angle in degrees (0–360). */
export function lchFromLab([L, a, b]: Readonly<Lab>): [number, number, number] {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

export function labFromLch(L: number, C: number, hDegrees: number): Lab {
  const h = (hDegrees * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}
