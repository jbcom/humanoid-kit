/**
 * Linear-RGB colours to and from CSS hex, for the panels' swatches, colour
 * pickers and slider ramps. `linearToSrgb` and `srgbToLinear` work in 0–255
 * sRGB values.
 */
import { linearToSrgb, type Rgb, srgbToLinear } from "../../surface/skinTone.ts";

/** `#rrggbb` for a linear-RGB colour. */
export const cssColour = (rgb: Readonly<Rgb>): string =>
  `#${rgb.map((c) => linearToSrgb(c).toString(16).padStart(2, "0")).join("")}`;

/** The linear-RGB colour of a `#rrggbb` hex string. */
export const fromCssColour = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(srgbToLinear) as Rgb;
};

/** A left-to-right CSS gradient of `steps` colours along `at(0..1)`. */
export function cssRamp(steps: number, at: (t: number) => Rgb): string {
  const stops = Array.from({ length: steps }, (_, i) => cssColour(at(i / (steps - 1))));
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
