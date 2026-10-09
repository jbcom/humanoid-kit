import { describe, expect, it } from "vitest";
import { bindToBody } from "../scripts/lib/hairCards/bind.ts";
import { evaluateBinding } from "../src/mhclo/bound.ts";

/** Two triangles forming a bent sheet: the plane y = 0 for x < 0 and a slope for x > 0. */
const body = {
  positions: Float32Array.of(-1, 0, -1, 0, 0, -1, 0, 0, 1, -1, 0, 1, 1, 0.5, -1, 1, 0.5, 1),
  triangles: Uint32Array.of(0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2),
};

describe("bindToBody", () => {
  const points = Float32Array.of(
    -0.5,
    0.02,
    0.1, // above the flat part
    0.4,
    0.3,
    -0.2, // above the slope
    0.2,
    0.19,
    0.8, // near an edge of the slope
    -0.9,
    -0.01,
    -0.9, // under a corner
  );
  const binding = bindToBody(points, body);

  it("weights each vertex's three base corners so they sum to 1", () => {
    for (let v = 0; v < 4; v++) {
      const sum = [0, 1, 2].reduce((t, k) => t + (binding.weights[v * 3 + k] as number), 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("puts every vertex back where it was, on the body at rest", () => {
    const out = evaluateBinding(
      {
        ...binding,
        entry: { scale: null, vertexCount: 4 },
      },
      body.positions,
      new Float32Array(12),
    );
    for (let i = 0; i < out.length; i++)
      expect(out[i] as number).toBeCloseTo(points[i] as number, 5);
  });

  it("binds a vertex to the face nearest it, so its offset is the distance from the surface", () => {
    // Above the flat part: the corners are the flat triangle's, and the offset is the 0.02 height.
    const flat = [0, 1, 2].map((k) => binding.refVerts[k] as number);
    expect(flat.every((i) => i <= 3)).toBe(true);
    expect(binding.offsets[1]).toBeCloseTo(0.02, 5);
  });

  it("carries a bound vertex with the body when the body moves", () => {
    const lifted = Float32Array.from(body.positions, (x, i) => (i % 3 === 1 ? x + 1 : x));
    const out = evaluateBinding(
      { ...binding, entry: { scale: null, vertexCount: 4 } },
      lifted,
      new Float32Array(12),
    );
    for (let v = 0; v < 4; v++)
      expect(out[v * 3 + 1] as number).toBeCloseTo((points[v * 3 + 1] as number) + 1, 5);
  });
});
