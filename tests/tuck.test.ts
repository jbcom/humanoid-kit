import { describe, expect, it } from "vitest";
import { tuckDepths } from "../src/model/tuck.ts";

/** A flat grid of quads in the plane y = `y`, `n` by `n` cells of `size`, facing up. */
function plate(n: number, size: number, y: number) {
  const positions: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push(i * size, y, -j * size);
  const faces: number[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      // Counter-clockwise seen from above (+y): the normal points up.
      faces.push(a, a + 1, a + 1 + (n + 1), a + (n + 1));
    }
  return { positions: Float32Array.from(positions), faces: Uint32Array.from(faces) };
}

const up = (count: number) =>
  Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 1 ? 1 : 0));

describe("sinking skin under the cloth over it", () => {
  const body = plate(4, 0.02, 0);
  const count = body.positions.length / 3;
  const all = Uint32Array.from({ length: count }, (_, i) => i);

  it("sinks a vertex by its clearance under the cloth", () => {
    const cloth = plate(4, 0.02, 0.012);
    const tuck = tuckDepths({
      positions: body.positions,
      normals: up(count),
      candidates: all,
      cloth: [{ positions: cloth.positions, faces: cloth.faces }],
      cap: 0.03,
    });
    // Over the interior, 12 mm; the plates have the same extent, so the corners
    // lie on the cloth's border where a ray may or may not hit: not asserted.
    const middle = 2 * 5 + 2;
    expect(tuck[middle]).toBeCloseTo(0.012, 5);
  });

  it("leaves a vertex with no cloth over it where it is", () => {
    const small = plate(1, 0.02, 0.01); // covers only the first cell
    const tuck = tuckDepths({
      positions: body.positions,
      normals: up(count),
      candidates: all,
      cloth: [{ positions: small.positions, faces: small.faces }],
      cap: 0.03,
    });
    expect(tuck[4 * 5 + 4]).toBe(0);
  });

  it("does not reach for cloth further off than the cap", () => {
    const cloth = plate(4, 0.02, 0.05);
    const tuck = tuckDepths({
      positions: body.positions,
      normals: up(count),
      candidates: all,
      cloth: [{ positions: cloth.positions, faces: cloth.faces }],
      cap: 0.03,
    });
    expect(Math.max(...tuck)).toBe(0);
  });

  it("clears the outermost of several garments", () => {
    const inner = plate(4, 0.02, 0.004);
    const outer = plate(4, 0.02, 0.02);
    const tuck = tuckDepths({
      positions: body.positions,
      normals: up(count),
      candidates: all,
      cloth: [
        { positions: inner.positions, faces: inner.faces },
        { positions: outer.positions, faces: outer.faces },
      ],
      cap: 0.03,
    });
    expect(tuck[2 * 5 + 2]).toBeCloseTo(0.02, 5);
  });

  it("only considers the candidates", () => {
    const cloth = plate(4, 0.02, 0.01);
    const tuck = tuckDepths({
      positions: body.positions,
      normals: up(count),
      candidates: Uint32Array.of(12),
      cloth: [{ positions: cloth.positions, faces: cloth.faces }],
      cap: 0.03,
    });
    expect(tuck[12]).toBeCloseTo(0.01, 5);
    expect(tuck.reduce((s, t) => s + (t > 0 ? 1 : 0), 0)).toBe(1);
  });

  it("ignores cloth behind the skin", () => {
    const cloth = plate(4, 0.02, -0.01);
    const tuck = tuckDepths({
      positions: body.positions,
      normals: up(count),
      candidates: all,
      cloth: [{ positions: cloth.positions, faces: cloth.faces }],
      cap: 0.03,
    });
    expect(Math.max(...tuck)).toBe(0);
  });
});
