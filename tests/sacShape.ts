/**
 * How a sac reads, measured from its points alone, so the generator's shape and
 * the rendered surface are held to the same test (scrotum.test.ts and
 * tests/browser/adultSac.test.ts): two lobes either side of a median raphe.
 *
 * The figure faces +z with +y up; `midline` is the sac's centre across (x).
 */
export interface SacReading {
  /** How far the midline's front lies behind both lobes' fronts, metres, at the height where that is most. */
  front: number;
  /** How far the midline's lowest point lies above both lobes' lowest, metres. */
  bottom: number;
}

/** The points' extent across: the sac's half-width either side of `midline`. */
export function halfWidths(points: readonly (readonly number[])[], midline: number) {
  let left = 0;
  let right = 0;
  for (const p of points) {
    const x = (p[0] as number) - midline;
    if (x > left) left = x;
    if (-x > right) right = -x;
  }
  return { left, right };
}

export function readSac(points: readonly (readonly number[])[], midline: number): SacReading {
  const { left, right } = halfWidths(points, midline);
  const half = Math.min(left, right);
  // A lobe's band across: the middle of its half; the raphe's: a narrow strip on the midline.
  const lobe = (x: number) => Math.abs(x) > 0.3 * half && Math.abs(x) < 0.7 * half;
  const raphe = (x: number) => Math.abs(x) < 0.08 * half;
  const ys = points.map((p) => p[1] as number);
  const low = Math.min(...ys);
  const high = Math.max(...ys);
  let front = Number.NEGATIVE_INFINITY;
  for (const share of [0.15, 0.25, 0.35, 0.45, 0.55]) {
    const y = low + share * (high - low);
    const band = points.filter((p) => Math.abs((p[1] as number) - y) < 0.003);
    const max = (keep: (x: number) => boolean) =>
      Math.max(
        ...band.filter((p) => keep((p[0] as number) - midline)).map((p) => p[2] as number),
      );
    const r = max((x) => x < 0 && lobe(x));
    const l = max((x) => x > 0 && lobe(x));
    const m = max(raphe);
    if ([r, l, m].every(Number.isFinite)) front = Math.max(front, Math.min(r, l) - m);
  }
  const lowest = (keep: (x: number) => boolean) =>
    Math.min(
      ...points.filter((p) => keep((p[0] as number) - midline)).map((p) => p[1] as number),
    );
  const bottom =
    lowest(raphe) -
    Math.max(
      lowest((x) => x < 0 && lobe(x)),
      lowest((x) => x > 0 && lobe(x)),
    );
  return { front, bottom };
}
