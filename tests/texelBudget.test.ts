import { describe, expect, it } from "vitest";
import {
  COVERAGE,
  EDGE_STEP,
  FRAMINGS,
  framingOf,
  neededEdge,
  pxPerMm,
  shippedEdge,
  TEXTURE_CEILING,
  texelDensity,
  triangles,
} from "../scripts/lib/texelBudget.ts";

/** A flat square `side` metres across, as two triangles, mapped onto the whole texture. */
const square = (side: number) =>
  triangles(
    [0, 0, 0, side, 0, 0, side, side, 0, 0, side, 0],
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 1, 2, 3],
    [0, 1, 2, 3],
    0,
    1,
  );

describe("texel density", () => {
  it("is texels per millimetre of surface", () => {
    // 1024 texels over 0.1 m: 10.24 per mm.
    expect(texelDensity(square(0.1), 1024, 1024, 0.5)).toBeCloseTo(10.24, 6);
  });

  it("weights its quantiles by area, so a small stretched corner does not decide it", () => {
    // Nine-tenths of the area mapped at full density, a tenth squeezed to a sliver of UV.
    const big = square(0.3).map((t) => ({ ...t, uv: t.uv * 0.99 }));
    const small = square(0.1).map((t) => ({ ...t, uv: t.uv * 0.0001 }));
    const all = [...big, ...small];
    expect(texelDensity(all, 1024, 1024, 0.5)).toBeGreaterThan(3);
    // The sliver: 1% of the UV square's side over 0.1 m.
    expect(texelDensity(all, 1024, 1024, 0.05)).toBeCloseTo(0.1024, 6);
  });
});

describe("the edge a texture needs", () => {
  it("resolves the framing over COVERAGE of its area, rounded up to EDGE_STEP", () => {
    // A 0.1 m square at the face's framing needs pxPerMm × 100 texels.
    const want = pxPerMm(FRAMINGS.face) * 100;
    const edge = neededEdge(square(0.1), "face");
    expect(edge % EDGE_STEP).toBe(0);
    expect(edge).toBeGreaterThanOrEqual(want);
    expect(edge - want).toBeLessThan(EDGE_STEP);
    expect(COVERAGE).toBe(0.9);
  });

  it("judges what is worn on the head at the face's framing, the rest at a clothed figure's", () => {
    for (const kind of ["eyes", "teeth", "tongue", "hair", "eyebrows", "eyelashes", "scalp", "hat"])
      expect(framingOf(kind), kind).toBe("face");
    for (const kind of ["clothes", "shoes", "jacket"])
      expect(framingOf(kind), kind).toBe("clothed");
  });
});

describe("the edge a texture ships at", () => {
  it("is its need, raised to the pack's default and capped by its source and the ceiling", () => {
    expect(shippedEdge(1408, 2048, 1024)).toBe(1408);
    expect(shippedEdge(512, 2048, 1024)).toBe(1024);
    expect(shippedEdge(512, 512, 1024)).toBe(512);
    expect(shippedEdge(4096, 2048, 1024)).toBe(2048);
    expect(shippedEdge(8192, 8192, 1024)).toBe(TEXTURE_CEILING);
  });
});
