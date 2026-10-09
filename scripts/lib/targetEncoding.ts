/**
 * One sparse target in the pack's `TARGET_ENCODING` (src/format/assetFormat.ts):
 * ascending vertex indices as u16 deltas, then the x, y and z deltas as three
 * i16 planes in steps of `scale` metres, before the file is gzipped. Shared by
 * the packer, for upstream targets, and for the targets it generates.
 */
export interface EncodedTarget {
  name: string;
  /** Index deltas, then the x, y and z planes (`TARGET_ENCODING`, before gzip). */
  chunk: Uint8Array;
  count: number;
  scale: number;
}

/**
 * Encodes a target. `idx` ascends without repeats and each gap fits 16 bits;
 * `d` is xyz per index in metres. The scale is the largest delta over 32767, so
 * the largest delta is exact and the rest are within half a step of theirs.
 */
export function encodeSparseTarget(
  name: string,
  idx: readonly number[],
  d: ArrayLike<number>,
): EncodedTarget {
  const n = idx.length;
  if (d.length !== n * 3) throw new Error(`target ${name}: ${n} indices but ${d.length} deltas`);
  let max = 0;
  for (let i = 0; i < d.length; i++) max = Math.max(max, Math.abs(d[i] as number));
  const scale = max / 32767 || 1;
  // Index deltas (indices ascend, so most are 1), then x, y and z planes:
  // the same numbers, laid out so gzip finds the repetition.
  const chunk = new Uint8Array(n * 8);
  const view = new DataView(chunk.buffer);
  let prev = 0;
  idx.forEach((v, k) => {
    const gap = v - prev;
    if (gap < 0 || gap > 0xffff || v > 0xffff)
      throw new Error(`target ${name}: index ${v} does not follow ${prev} in 16 bits`);
    view.setUint16(k * 2, gap, true);
    prev = v;
  });
  for (let k = 0; k < d.length; k++)
    view.setInt16(
      n * 2 + ((k % 3) * n + Math.floor(k / 3)) * 2,
      Math.round((d[k] as number) / scale),
      true,
    );
  return { name, chunk, count: n, scale };
}
