/**
 * Friction ridge relief: the parallel ridges of the soles and palms, 0.4 to
 * 0.6 mm apart, far finer than the mesh or the field atlas (docs/ARCHITECTURE.md,
 * "Feet").
 *
 * The pattern is sparse Gabor noise (Lagae et al. 2009): in each cell of a jittered
 * grid, a few kernels, each a plane wave across the ridges under an envelope
 * elongated along them, with a random phase. Summed, they give stripes of the
 * given spacing and orientation that run for a few millimetres and then end,
 * split and join where kernels with different phases overlap, which is what
 * a fingerprint's minutiae are. It is a function of position and orientation
 * alone, so nothing has to be stored at ridge resolution: the field atlas
 * carries only the slowly turning orientation, and the shader (`hkRidges` in
 * `skinMaterial.ts`) evaluates this same function per pixel.
 *
 * The orientation is a direction modulo a half turn. The layer's coordinate
 * stores it (`ridgeOrientationCoordinate`), its mask where there are ridges.
 */

/** Cell of the kernel grid, in ridge spacings. */
export const RIDGE_CELL_PERIODS = 12;
/** Kernels per cell. */
export const RIDGE_KERNELS = 2;
/** The envelope's standard deviation along the ridges and across them, in spacings. */
export const RIDGE_ALONG = 5;
export const RIDGE_ACROSS = 1.6;
/** The relief's slope from the normalised sum to height (0..1): 0.5 + this × the sum in standard deviations. */
export const RIDGE_CONTRAST = 0.35;

/** The sum's standard deviation (in kernel amplitudes): kernels per cell area × ½ × the envelope's squared integral. */
export const RIDGE_SIGMA = Math.sqrt(
  (RIDGE_KERNELS * 0.5 * Math.PI * RIDGE_ALONG * RIDGE_ACROSS) / RIDGE_CELL_PERIODS ** 2,
);

/** PCG2D (Jarzynski and Olano 2020), the same arithmetic as the shader's `hkRidgeHash`. */
function pcg2d(x: number, y: number): [number, number] {
  let a = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  let b = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  a = (a + Math.imul(b, 1664525)) >>> 0;
  b = (b + Math.imul(a, 1664525)) >>> 0;
  a = (a ^ (a >>> 16)) >>> 0;
  b = (b ^ (b >>> 16)) >>> 0;
  a = (a + Math.imul(b, 1664525)) >>> 0;
  b = (b + Math.imul(a, 1664525)) >>> 0;
  a = (a ^ (a >>> 16)) >>> 0;
  b = (b ^ (b >>> 16)) >>> 0;
  return [a, b];
}

const UNIT = 1 / 4294967296;

/**
 * The ridge relief at (`x`, `y`) metres, 0 to 1 (1 on a ridge's crest), for
 * ridges whose waves run along direction `theta` (radians) a `spacing` apart.
 */
export function ridgeHeight(x: number, y: number, theta: number, spacing: number): number {
  const cell = RIDGE_CELL_PERIODS * spacing;
  const qx = x / cell;
  const qy = y / cell;
  const ix = Math.floor(qx);
  const iy = Math.floor(qy);
  const wx = Math.cos(theta);
  const wy = Math.sin(theta);
  const sa = RIDGE_ALONG * spacing;
  const sc = RIDGE_ACROSS * spacing;
  let sum = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      for (let k = 0; k < RIDGE_KERNELS; k++) {
        const [hx, hy] = pcg2d((cx + 0x8000) >>> 0, (cy * RIDGE_KERNELS + k + 0x8000) >>> 0);
        const px = (cx + hx * UNIT) * cell;
        const py = (cy + hy * UNIT) * cell;
        const [phase] = pcg2d((cx + 0x4000) >>> 0, (cy * RIDGE_KERNELS + k + 0x4000) >>> 0);
        const dx = x - px;
        const dy = y - py;
        const across = dx * wx + dy * wy;
        const along = -dx * wy + dy * wx;
        const env = Math.exp(-0.5 * ((along / sa) ** 2 + (across / sc) ** 2));
        sum += env * Math.cos((2 * Math.PI * across) / spacing + 2 * Math.PI * phase * UNIT);
      }
    }
  return Math.min(1, Math.max(0, 0.5 + (RIDGE_CONTRAST * sum) / RIDGE_SIGMA));
}

/**
 * Where the stored orientation wraps: an orientation is a direction modulo a
 * half turn, so its coordinate (0 to 1 over a half turn) must start somewhere,
 * and bilinear filtering between two angles either side of that seam passes
 * through every angle between them, the long way round. On the soles (the UV
 * layout is frozen) the ridge directions in UV lie near 90°, with the fewest
 * vertices at 15° (`tests/feet.test.ts` holds the share of neighbouring
 * vertices straddling it to a few per cent), so the seam is there.
 */
export const RIDGE_ORIENTATION_SEAM = Math.PI / 12;

/** The 0..1 coordinate that stores an orientation (radians, any turn) about the seam. */
export function ridgeOrientationCoordinate(theta: number): number {
  const t = (((theta - RIDGE_ORIENTATION_SEAM) % Math.PI) + Math.PI) % Math.PI;
  return t / Math.PI;
}

/** The orientation (radians, from the seam up to a half turn past it) a coordinate stores. */
export function ridgeOrientation(coordinate: number): number {
  return coordinate * Math.PI + RIDGE_ORIENTATION_SEAM;
}
