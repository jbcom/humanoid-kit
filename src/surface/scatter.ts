/**
 * The colour-driven subsurface scattering model, in TypeScript.
 *
 * Every channel's scatter distance follows from its own albedo, so any colour
 * (skin, fur, scales, fantasy) scatters plausibly with no per-colour tuning:
 *
 * 1. surface albedo → single-scattering albedo (Chiang, Kutz & Burley 2016, Eq. 1);
 * 2. → Burley profile width d = α · ℓ / s(A), with the scattering length ℓ
 *    rising with wavelength and s the diffuse-transmission profile scale
 *    (Christensen & Burley 2015, Eq. 6);
 * 3. d times surface curvature → an energy-conserving wrap of N·L (McAuley's
 *    form), fitted to a Penner-style pre-integration of Burley's profile over a
 *    sphere.
 *
 * `SkinMaterial`'s shader is generated from these constants, and the sphere
 * parity test renders it against these functions, so the two cannot drift.
 * See docs/research/ALGORITHMIC-APPEARANCE.md §2.
 */
import type { Rgb } from "./skinTone.ts";

/** Representative wavelengths 612, 549 and 465 nm, relative to 550 nm. */
export const WAVELENGTH_RATIO: Readonly<Rgb> = [612 / 550, 549 / 550, 465 / 550];

/** The scatter parameters `SkinMaterial` uses for natural skin. */
export const SKIN_SCATTER = {
  /** Scattering mean free path at 550 nm, metres (skin ≈ 1.14 mm, Jensen 2001). */
  mfp: 1.14e-3,
  /** How much further red scatters than blue (spectral slope). */
  slope: 1.4,
  /** Fraction of the pigment that sits above an unpigmented scattering layer. */
  pigmentDepth: 0.75,
} as const;

/** Chiang, Kutz & Burley 2016, Eq. 1: surface albedo → single-scattering albedo. */
export const singleScatterAlbedo = (a: number): number =>
  1 - Math.exp(-5.09406 * a + 2.61188 * a * a - 4.31805 * a * a * a);

/** Christensen & Burley 2015, Eq. 6: the diffuse surface transmission profile scale. */
export const profileScale = (a: number): number => 1.9 - a + 3.5 * (a - 0.8) ** 2;

const clampAlbedo = (c: number) => Math.min(0.999, Math.max(0.001, c));

/**
 * Per-channel Burley profile width d, in metres. With `pigmentDepth` p > 0 the
 * medium scatters as `albedo^(1−p) · substrate^p`: pigment above a substrate
 * colours the light without changing how far the substrate carries it.
 */
export function scatterDistance(
  albedo: Readonly<Rgb>,
  mfp: number = SKIN_SCATTER.mfp,
  slope: number = SKIN_SCATTER.slope,
  pigmentDepth = 0,
  substrate: Readonly<Rgb> = albedo,
): Rgb {
  return albedo.map((c, k) => {
    const a =
      clampAlbedo(c) ** (1 - pigmentDepth) * clampAlbedo(substrate[k] as number) ** pigmentDepth;
    const ls = mfp * (WAVELENGTH_RATIO[k] as number) ** slope;
    return (singleScatterAlbedo(a) * ls) / profileScale(a);
  }) as Rgb;
}

/** The wrap fitted to the pre-integrated profile; x = d · curvature (dimensionless). */
export const wrapFromScatter = (x: number): number => {
  const y = Math.max(0, x) ** 1.2997;
  return (2.0246 * y) / (1 + 1.3543 * y);
};

/**
 * Diffuse response to one light, relative to the albedo: `max(N·L + w, 0) /
 * (1 + w)²`. At w = 0 it is Lambert's `max(N·L, 0)`, and for every w its
 * integral over the sphere of normals equals Lambert's, so wrapping moves
 * light round a curve without adding any.
 */
export const wrappedDiffuse = (nDotL: number, w: number): number =>
  Math.max(nDotL + w, 0) / ((1 + w) * (1 + w));
