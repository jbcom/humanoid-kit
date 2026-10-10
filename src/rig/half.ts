/**
 * IEEE 754 binary16 ("half float"), the format a `HalfFloatType` texture holds:
 * a sign, five exponent bits and ten of significand, so a value keeps 11
 * significant bits and is rounded to within 2⁻¹¹ of itself (relative), the
 * nearest representable value, ties to even, as the GPU reads it back.
 * Written here rather than taken from three (`DataUtils.toHalfFloat`), which
 * truncates: a 66 mm displacement lost 61 µm to it, a whole step, against 31
 * µm rounded. The pure core keeps no three dependency.
 */

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** `x` as the binary16 nearest it (its 16 bits), ties to even; past the largest finite, infinity. */
export function toHalf(x: number): number {
  f32[0] = x;
  const bits = u32[0] as number;
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;
  // NaN and infinity.
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
  // The exponent re-biased from float32's 127 to binary16's 15.
  const e = exponent - 112;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    // A subnormal binary16 (or zero): the significand with its leading one, shifted down, rounded.
    if (e < -10) return sign;
    const m = mantissa | 0x800000;
    const shift = 14 - e;
    const half = 1 << (shift - 1);
    const rest = m & ((1 << shift) - 1);
    let out = m >>> shift;
    if (rest > half || (rest === half && out & 1)) out++;
    return sign | out;
  }
  // A normal one: ten significand bits kept, the thirteen dropped rounded, ties to even.
  let out = (e << 10) | (mantissa >>> 13);
  const rest = mantissa & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && out & 1)) out++;
  // A carry out of the significand moves to the next exponent, and past the largest to infinity.
  return sign | out;
}

/** The value binary16 `h` (its 16 bits) holds, exactly. */
export function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >>> 10) & 0x1f;
  const mantissa = h & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}
