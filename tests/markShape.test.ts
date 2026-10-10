import { describe, expect, it } from "vitest";
import type { PlacedMark } from "../src/bodyArt/decals.ts";
import {
  FLECK_REACH,
  markNoise,
  markOutline,
  markShape,
  PATCH_OUTLINE,
} from "../src/bodyArt/markShape.ts";

const mark = (kind: PlacedMark["kind"], more: Partial<PlacedMark> = {}): PlacedMark => ({
  centre: [0, 0, 0],
  normal: [0, 0, 1],
  right: [1, 0, 0],
  up: [0, 1, 0],
  kind,
  length: 0.04,
  width: 0.04,
  maturity: 1,
  raised: 0,
  seed: 7,
  ...more,
});

/** The shape over a grid `n` across a square `half` metres from the centre each way, at depth `z`. */
const grid = (m: PlacedMark, half: number, n = 61, z = 0) => {
  const o = markOutline(m);
  const out: { x: number; y: number; s: number }[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1) - 0.5) * 2 * half;
      const y = (j / (n - 1) - 0.5) * 2 * half;
      out.push({ x, y, s: markShape(m, o, x, y, z) });
    }
  return out;
};

describe("the marks' noise", () => {
  it("is deterministic, bounded, and continuous across its lattice", () => {
    expect(markNoise(1.3, 2.7, -4.1)).toBe(markNoise(1.3, 2.7, -4.1));
    let lo = 1;
    let hi = -1;
    for (let i = 0; i < 2000; i++) {
      const n = markNoise(i * 0.137, i * 0.071 - 30, i * 0.029);
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    }
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(0.8);
    // Either side of a lattice plane, the same value.
    expect(Math.abs(markNoise(2 - 1e-9, 0.4, 0.6) - markNoise(2 + 1e-9, 0.4, 0.6))).toBeLessThan(
      1e-6,
    );
  });
});

describe("a patch's shape", () => {
  it("is not a naevus's: a naevus is a decal", () => {
    expect(() => markOutline(mark("naevus"))).toThrow(RangeError);
  });

  it("is full at its centre and empty well beyond it, with an edge that is not a circle", () => {
    for (const kind of Object.keys(PATCH_OUTLINE) as (keyof typeof PATCH_OUTLINE)[]) {
      const m = mark(kind);
      const o = markOutline(m);
      expect(markShape(m, o, 0, 0), kind).toBeGreaterThan(0.99);
      expect(markShape(m, o, 0.06, 0), kind).toBe(0);
      // The radius where the shape crosses one half, round the patch, varies.
      const radii = Array.from({ length: 24 }, (_, a) => {
        const t = (a / 24) * Math.PI * 2;
        let r = 0;
        while (r < 0.06 && markShape(m, o, r * Math.cos(t), r * Math.sin(t)) > 0.5) r += 0.0002;
        return r;
      });
      expect(Math.max(...radii) - Math.min(...radii), kind).toBeGreaterThan(0.002);
    }
  });

  it("softens its edge over 1 to 3 mm, whatever the noise's slope", () => {
    for (const kind of ["vitiligo", "cafe-au-lait", "port-wine"] as const)
      for (const seed of [1, 7, 13]) {
        const m = mark(kind, { width: 0.06, length: 0.06, seed });
        // The edge's mean width across it: the area where the shape is between
        // 1% and 99%, over the outline's length (Crofton: crossings of the
        // half-way level along the grid's lines, times the spacing, times π/4).
        const n = 301;
        const half = 0.05;
        const step = (2 * half) / (n - 1);
        const s = grid(m, half, n).map((p) => p.s);
        const at = (i: number, j: number) => s[j * n + i] as number;
        let band = 0;
        let crossings = 0;
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            if (at(i, j) > 0.01 && at(i, j) < 0.99) band++;
            if (i > 0 && at(i, j) > 0.5 !== at(i - 1, j) > 0.5) crossings++;
            if (j > 0 && at(i, j) > 0.5 !== at(i, j - 1) > 0.5) crossings++;
          }
        const width = (band * step * step) / ((crossings * step * Math.PI) / 4);
        expect(width * 1000, `${kind} ${seed}`).toBeGreaterThan(1);
        expect(width * 1000, `${kind} ${seed}`).toBeLessThan(3);
      }
  });

  it("is its other side's mirror image when its width is negative", () => {
    const m = mark("vitiligo");
    const mirrored = mark("vitiligo", { width: -0.04 });
    const o = markOutline(m);
    for (const [x, y] of [
      [0.012, 0.005],
      [-0.019, 0.011],
      [0.021, -0.013],
    ] as const)
      expect(markShape(mirrored, o, -x, y)).toBeCloseTo(markShape(m, o, x, y), 12);
  });

  it("ends by its depth where the skin turns away, not in a cut", () => {
    // Skin turning away at 45° beyond the centre: along it, x = z.
    const m = mark("cafe-au-lait", { width: 0.06, length: 0.06 });
    const o = markOutline(m);
    const along = (d: number) => markShape(m, o, d / Math.SQRT2, 0, -d / Math.SQRT2);
    // It still covers the skin a little way down the turn, and fades out over its
    // soft edge, never in one step as a projection's reach would cut it.
    expect(along(0.015)).toBeGreaterThan(0.99);
    let last = 1;
    for (let d = 0.015; d < 0.06; d += 0.0002) {
      const s = along(d);
      expect(last - s).toBeLessThan(0.25);
      last = s;
    }
    expect(last).toBe(0);
  });

  it("throws vitiligo's flecks just outside its edge, and no other kind's", () => {
    const flecks = (kind: keyof typeof PATCH_OUTLINE) => {
      const m = mark(kind, { width: 0.05, length: 0.05 });
      let outside = 0;
      for (const { x, y, s } of grid(m, 0.05, 121)) {
        // Beyond the furthest the main edge reaches.
        const rho = Math.hypot(x, y) / 0.025;
        if (rho > 1 + PATCH_OUTLINE[kind].irregular + 0.1 && s > 0.5) outside++;
        if (rho > 1 + PATCH_OUTLINE[kind].irregular + FLECK_REACH + 0.1) expect(s).toBe(0);
      }
      return outside;
    };
    expect(flecks("vitiligo")).toBeGreaterThan(3);
    expect(flecks("cafe-au-lait")).toBe(0);
    expect(flecks("port-wine")).toBe(0);
  });
});
