/**
 * Penner's pre-integrated skin diffusion (SIGGRAPH 2011), exactly: the
 * reference the scatter table is generated from and checked against.
 *
 * A point on a sphere sees its neighbours' irradiance blurred by the
 * diffusion profile. For Burley's profile of width x (in sphere radii) and a
 * point whose normal makes acos(N·L) with the light, the result depends only
 * on N·L and x, so one two-dimensional table serves every channel of every
 * colour (docs/research/ALGORITHMIC-APPEARANCE.md §2.4).
 */

/** Burley's profile for width d, without its constant factor (it cancels). */
const burley = (s: number, d: number) => (Math.exp(-s / d) + Math.exp(-s / (3 * d))) / s;

/** ∫₀^2π max(0, a + b cos φ) dφ for b ≥ 0. */
function azimuthIntegral(a: number, b: number): number {
  if (a >= b) return 2 * Math.PI * a;
  if (a <= -b) return 0;
  return 2 * (a * Math.acos(-a / b) + Math.sqrt(b * b - a * a));
}

/**
 * The pre-integrated diffuse response of a sphere, relative to Lambert's
 * peak: `max(N·L, 0)` at x = 0, and for any x a normalised blur of it, so its
 * integral over the sphere stays Lambert's. Lighting is dimmed on the lit side
 * and carried past the terminator as x grows.
 *
 * Quadrature: the azimuth in closed form, the polar angle by the midpoint
 * rule, densest within 30 widths of the point, where the profile is.
 */
export function preintegratedDiffuse(nDotL: number, x: number, steps = 6000): number {
  const c = Math.min(1, Math.max(-1, nDotL));
  if (x <= 0) return Math.max(c, 0);
  const s = Math.sqrt(1 - c * c);
  // Beyond chord 30x the profile is below e^-10 of its value.
  const near = Math.min(Math.PI, 2 * Math.asin(Math.min(1, 15 * x)));
  let num = 0;
  let den = 0;
  const segment = (from: number, to: number, n: number) => {
    const h = (to - from) / n;
    for (let i = 0; i < n; i++) {
      const psi = from + (i + 0.5) * h;
      const w = burley(2 * Math.sin(psi / 2), x) * Math.sin(psi) * h;
      num += azimuthIntegral(c * Math.cos(psi), s * Math.sin(psi)) * w;
      den += 2 * Math.PI * w;
    }
  };
  segment(0, near, steps);
  if (near < Math.PI) segment(near, Math.PI, steps / 4);
  return num / den;
}
