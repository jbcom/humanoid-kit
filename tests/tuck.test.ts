import { describe, expect, it } from "vitest";
import { clothTuck, coveredBy, tuckDepths } from "../src/model/tuck.ts";

/**
 * A flat grid of quads in the plane y = `y`, `n` by `n` cells of `size`, facing
 * up, or down when `down`.
 */
function plate(n: number, size: number, y: number, down = false) {
  const positions: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push(i * size, y, -j * size);
  const faces: number[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      // Counter-clockwise seen from above (+y): the normal points up.
      if (down) faces.push(a, a + (n + 1), a + 1 + (n + 1), a + 1);
      else faces.push(a, a + 1, a + 1 + (n + 1), a + (n + 1));
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

  it("finds cloth in a grid cell a slanted ray only cuts across", () => {
    // From (25, 20) mm along (0.6, 0.8) the ray is in the 30 mm cell x 1, y 0
    // only between 8 and 12.5 mm: no 30 mm step lands there. A 1.6 mm triangle
    // wholly inside that cell sits across the ray 10 mm out.
    const o = Float32Array.of(0.025, 0.02, 0.015);
    const d = Float32Array.of(0.6, 0.8, 0);
    const tri = Float32Array.of(
      0.03036,
      0.02848,
      0.013,
      0.03164,
      0.02752,
      0.013,
      0.031,
      0.028,
      0.018,
    );
    const tuck = tuckDepths({
      positions: o,
      normals: d,
      candidates: Uint32Array.of(0),
      cloth: [{ positions: tri, faces: Uint32Array.of(0, 1, 2, 2) }],
      cap: 0.05,
    });
    expect(tuck[0]).toBeCloseTo(0.01, 5);
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

describe("sinking a garment under the garments over it", () => {
  const middle = 2 * 5 + 2;
  const sink = (innerY: number, outer: ReturnType<typeof plate>[]) => {
    const inner = plate(4, 0.02, innerY);
    return clothTuck({
      positions: inner.positions,
      normals: up(inner.positions.length / 3),
      outer,
      cap: 0.05,
      gap: 0.004,
    });
  };

  it("pulls cloth that pokes out of the garment over it back under, by the gap", () => {
    // 12 mm out of the outer cloth: sunk 12 mm, and 4 more to clear it.
    expect(sink(0.022, [plate(4, 0.02, 0.01)])[middle]).toBeCloseTo(0.016, 5);
  });

  it("pushes cloth closer under the garment over it than the gap down to the gap", () => {
    expect(sink(0.008, [plate(4, 0.02, 0.01)])[middle]).toBeCloseTo(0.002, 5);
  });

  it("leaves cloth that is clear under the garment over it where it is", () => {
    expect(Math.max(...sink(0, [plate(4, 0.02, 0.01)]))).toBe(0);
  });

  it("ignores the far wall of a garment it is inside", () => {
    // Cloth below that faces away is the other side of a boot shaft, not cloth
    // this vertex is outside of.
    expect(Math.max(...sink(0.02, [plate(4, 0.02, 0, true)]))).toBe(0);
  });

  it("does not reach for cloth further off than the cap", () => {
    expect(Math.max(...sink(0.2, [plate(4, 0.02, 0.01)]))).toBe(0);
  });

  describe("cloth behind the garment over it", () => {
    const skin = plate(4, 0.02, 0);
    const count = skin.positions.length / 3;
    // Each cloth vertex bound wholly to the body vertex under it.
    const binding = {
      refVerts: Uint32Array.from({ length: count * 3 }, (_, i) => Math.floor(i / 3)),
      weights: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 0 ? 1 : 0)),
    };
    const covered = (clothY: number, outer: ReturnType<typeof plate>[]) =>
      coveredBy({
        skin: { positions: skin.positions, normals: up(count) },
        binding,
        positions: plate(4, 0.02, clothY).positions,
        outer,
        cap: 0.05,
        beyond: 0.005,
      });

    it("is covered between the skin and the garment over it", () => {
      expect(covered(0.01, [plate(4, 0.02, 0.02)])[middle]).toBe(1);
    });

    it("is covered under a lining that faces it, as inside a boot", () => {
      // The lining faces the leg; the shell outside it faces out.
      const lining = plate(4, 0.02, 0.02, true);
      const shell = plate(4, 0.02, 0.025);
      expect(covered(0.01, [lining, shell])[middle]).toBe(1);
    });

    it("is covered by a garment that sits just inside the skin it hides", () => {
      // A snug boot shaft a centimetre inside the shin it deletes: jeans within
      // `beyond` (5 mm) of it are the boot's to hide, jeans 13 mm out are not.
      expect(covered(-0.008, [plate(4, 0.02, -0.01)])[middle]).toBe(1);
      expect(covered(0.003, [plate(4, 0.02, -0.01)])[middle]).toBe(0);
    });

    it("is not covered outside the garment over it", () => {
      expect(covered(0.03, [plate(4, 0.02, 0.02)])[middle]).toBe(0);
    });

    it("is not covered where the garment over it does not reach", () => {
      expect(covered(0.01, [plate(1, 0.02, 0.02)])[middle]).toBe(0);
    });

    it("is covered when most of its binding's weight is under the garment over it", () => {
      // A plate over the first two cells each way: body vertex 6 is inside it,
      // 24 (the far corner) is not.
      const small = plate(2, 0.02, 0.02);
      const mixed = (w: number) =>
        coveredBy({
          skin: { positions: skin.positions, normals: up(count) },
          binding: { refVerts: Uint32Array.of(6, 24, 24), weights: Float32Array.of(w, 1 - w, 0) },
          positions: Float32Array.of(0.04, 0.01, -0.04),
          outer: [small],
          cap: 0.05,
          beyond: 0.005,
        })[0];
      expect(mixed(0.7)).toBe(1);
      expect(mixed(0.3)).toBe(0);
    });

    it("is not covered by cloth further off the skin than the cap", () => {
      expect(covered(0.01, [plate(4, 0.02, 0.2)])[middle]).toBe(0);
    });
  });

  it("clears the deepest of several garments over it", () => {
    const tuck = sink(0.022, [plate(4, 0.02, 0.015), plate(4, 0.02, 0.01)]);
    expect(tuck[middle]).toBeCloseTo(0.016, 5);
  });
});
