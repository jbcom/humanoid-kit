import { describe, expect, it } from "vitest";
import {
  COVERED_BY,
  FADE_LENGTH,
  GROWTH_SCALE,
  HAIRLINE_NEAR,
  hairFields,
  SCALP_DEPTH,
  SCALP_FALLOFF,
  SCALP_FULL,
  scalpShade,
  UV_SCALE_STEPS,
} from "../src/surface/hairFields.ts";

/**
 * A flat "scalp" of triangles in the plane y = 0 (x, z in [-0.3, 0.3]), and cards:
 * a vertical strip of quads standing on it from y = lift to y = lift + height.
 */
const GRID = 12;
function scalp() {
  const positions: number[] = [];
  for (let j = 0; j <= GRID; j++)
    for (let i = 0; i <= GRID; i++)
      positions.push(-0.3 + (0.6 * i) / GRID, 0, -0.3 + (0.6 * j) / GRID);
  const triangles: number[] = [];
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++) {
      const a = j * (GRID + 1) + i;
      triangles.push(a, a + 1, a + GRID + 1, a + 1, a + GRID + 2, a + GRID + 1);
    }
  return {
    positions: new Float32Array(positions),
    triangles: new Uint32Array(triangles),
    count: positions.length / 3,
  };
}

/** A strip of `rows` quads along y, `width` wide in x, at z = 0, from y0 up by `height`. */
function strip(rows: number, y0: number, height: number, width = 0.1) {
  const positions: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const y = y0 + (height * r) / rows;
    positions.push(-width / 2, y, 0, width / 2, y, 0);
  }
  const faceVerts: number[] = [];
  for (let r = 0; r < rows; r++) {
    const a = r * 2;
    faceVerts.push(a, a + 1, a + 3, a + 2);
  }
  return { positions: new Float32Array(positions), faceVerts: new Uint32Array(faceVerts) };
}

/** How far in front of another card a covering card stands in the test, metres. */
const COVER_GAP = 0.003;

/** A horizontal sheet of one quad, `size` wide, `height` above the scalp plane. */
function sheet(height: number, size = 0.1) {
  const h = size / 2;
  return {
    positions: new Float32Array([-h, height, -h, h, height, -h, h, height, h, -h, height, h]),
    faceVerts: new Uint32Array([0, 1, 2, 3]),
  };
}

describe("scalpShade", () => {
  const body = scalp();
  const at = (heights: number[]) =>
    scalpShade(new Float32Array(heights.flatMap((y) => [0, y, 0])), {
      positions: body.positions,
      triangles: body.triangles,
    });

  it("is 0 on the scalp, 1 from SCALP_DEPTH up, and rises smoothly between", () => {
    const heights = [
      0,
      SCALP_DEPTH / 4,
      SCALP_DEPTH / 2,
      (3 * SCALP_DEPTH) / 4,
      SCALP_DEPTH,
      2 * SCALP_DEPTH,
    ];
    const shade = at(heights);
    expect(shade[0]).toBe(0);
    for (let i = 1; i < shade.length; i++)
      expect(shade[i] as number).toBeGreaterThanOrEqual(shade[i - 1] as number);
    expect(shade[4]).toBe(1);
    expect(shade[5]).toBe(1);
    // Smooth: no step between neighbouring quarters larger than the smoothstep's own slope.
    for (let i = 1; i < 5; i++)
      expect((shade[i] as number) - (shade[i - 1] as number)).toBeLessThan(0.75);
  });
});

describe("hairFields", () => {
  const body = scalp();
  const eligibleAll = new Uint8Array(body.count).fill(1);
  const run = (card: ReturnType<typeof strip>, eligible = eligibleAll) =>
    hairFields({
      positions: card.positions,
      faceVerts: card.faceVerts,
      body: { positions: body.positions, triangles: body.triangles },
      scalpEligible: eligible,
    });

  describe("growth", () => {
    it("is zero where the card meets the scalp and the distance along the card from there", () => {
      const { growth } = run(strip(5, 0.002, 0.1));
      expect(growth[0]).toBe(0);
      expect(growth[1]).toBe(0);
      // Top row: 0.1 m along the card.
      expect(growth[10]).toBeCloseTo(0.1 * GROWTH_SCALE, -1);
      for (let r = 1; r <= 5; r++)
        expect(growth[r * 2] as number).toBeGreaterThan(growth[(r - 1) * 2] as number);
    });

    it("grows from the highest vertex of a card that touches no scalp", () => {
      const { growth } = run(strip(4, 0.2, 0.2));
      // Nothing is near the scalp: the top (y = 0.4) is the root, the bottom the tip.
      expect(growth[8]).toBe(0);
      expect(growth[0]).toBeCloseTo(0.2 * GROWTH_SCALE, -1);
    });

    it("saturates instead of wrapping past the quantisation range", () => {
      const { growth } = run(strip(1, 0.2, 60, 0.01));
      expect(growth[0]).toBe(65535);
    });
  });

  describe("fade", () => {
    it("is zero on a card edge at the scalp, rises along the card, and is full past FADE_LENGTH", () => {
      const { fade } = run(strip(10, 0.002, 0.2));
      expect(fade[0]).toBe(0);
      expect(fade[1]).toBe(0);
      let last = 0;
      for (let r = 0; r <= 10; r++) {
        const f = fade[r * 2] as number;
        expect(f).toBeGreaterThanOrEqual(last);
        last = f;
      }
      // Rows 0.02 m up are past FADE_LENGTH.
      expect(FADE_LENGTH).toBeLessThan(0.02);
      expect(fade[2 * 2]).toBe(255);
    });

    it("leaves every card whole when the style opts out of feathering (dense curls have no cut edge to soften)", () => {
      const card = strip(10, 0.002, 0.2);
      const { fade } = hairFields({
        positions: card.positions,
        faceVerts: card.faceVerts,
        body: { positions: body.positions, triangles: body.triangles },
        scalpEligible: eligibleAll,
        feather: false,
      });
      expect(fade.every((f) => f === 255)).toBe(true);
    });

    it("leaves a free edge far from the scalp alone: only a hairline feathers", () => {
      const { fade } = run(strip(4, 0.2, 0.2));
      expect(fade.every((f) => f === 255)).toBe(true);
    });

    it("does not feather an edge another card lies well over: that edge is inside the hair, not on its line", () => {
      // Card A stands on the scalp; card B, wider and reaching well below A's foot, stands 3 mm in
      // front of it. A's foot is inside B (far from B's edges), so it stays.
      const a = strip(5, 0.002, 0.1, 0.1);
      const b = strip(5, -0.05, 0.2, 0.2);
      for (let i = 2; i < b.positions.length; i += 3) b.positions[i] = COVER_GAP;
      const positions = new Float32Array([...a.positions, ...b.positions]);
      const offset = a.positions.length / 3;
      const faceVerts = new Uint32Array([...a.faceVerts, ...b.faceVerts.map((v) => v + offset)]);
      const { fade } = run({ positions, faceVerts });
      expect(fade[0]).toBe(255);
      expect(fade[1]).toBe(255);
      expect(COVER_GAP).toBeLessThan(COVERED_BY);
    });

    it("still feathers an edge another card merely meets: a shared hairline is one hairline", () => {
      // Card B's foot is at the same height as A's, 3 mm in front: the cards' union ends there,
      // so both feet are on the hairline.
      const a = strip(5, 0.002, 0.1, 0.1);
      const b = strip(5, 0.002, 0.1, 0.2);
      for (let i = 2; i < b.positions.length; i += 3) b.positions[i] = COVER_GAP;
      const positions = new Float32Array([...a.positions, ...b.positions]);
      const offset = a.positions.length / 3;
      const faceVerts = new Uint32Array([...a.faceVerts, ...b.faceVerts.map((v) => v + offset)]);
      const { fade } = run({ positions, faceVerts });
      expect(fade[0]).toBe(0);
      expect(fade[offset]).toBe(0);
    });

    it("does not feather a part of a card far from the scalp, which is no hairline", () => {
      // Two stacked strips share their middle row of vertices, 0.05 above the scalp.
      const card = strip(2, 0.002, 0.1);
      const { fade } = run(card);
      expect(fade[2]).toBe(255);
      expect(HAIRLINE_NEAR).toBeLessThan(0.05);
    });

    it("puts a hairline inside a card's mesh where its painted hair ends over bare skin", () => {
      // A 0.4 m sheet of 2x2 quads 2 mm above the scalp: its centre vertex is interior, 0.2 m from
      // any edge. Where the texture is opaque everywhere the centre is well inside the hair; where
      // it is clear across the middle, the skin under the centre is bare and the centre is on a hairline.
      const h = 0.2;
      const positions: number[] = [];
      const uvs: number[] = [];
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          positions.push(-h + i * h, 0.002, -h + j * h);
          uvs.push(i / 2, j / 2);
        }
      const faceVerts = new Uint32Array([0, 1, 4, 3, 1, 2, 5, 4, 3, 4, 7, 6, 4, 5, 8, 7]);
      const alphaOf = (clearMiddle: boolean) =>
        Uint8Array.from({ length: 16 }, (_, k) => {
          const x = k % 4;
          const y = Math.floor(k / 4);
          return clearMiddle && x >= 1 && x <= 2 && y >= 1 && y <= 2 ? 0 : 255;
        });
      const fadeAt = (clearMiddle: boolean) =>
        hairFields({
          positions: new Float32Array(positions),
          faceVerts,
          body: { positions: body.positions, triangles: body.triangles },
          scalpEligible: eligibleAll,
          cutout: {
            faceUvs: faceVerts,
            uvs: new Float32Array(uvs),
            width: 4,
            height: 4,
            alpha: alphaOf(clearMiddle),
          },
        }).fade[4];
      expect(fadeAt(false)).toBe(255);
      expect(fadeAt(true)).toBe(0);
    });

    it("feathers a card lying along the scalp wherever it is, not only at the mesh's own boundary", () => {
      // The visible hairline is where the painted hair ends, which is inside a card's mesh: a
      // 0.4 m sheet 1 mm above the scalp has vertices only at its corners, yet is all hairline.
      const card = sheet(0.001, 0.4);
      const { fade } = hairFields({
        positions: card.positions,
        faceVerts: card.faceVerts,
        body: { positions: body.positions, triangles: body.triangles },
        scalpEligible: eligibleAll,
      });
      expect(Array.from(fade)).toEqual([0, 0, 0, 0]);
    });
  });

  describe("uvScale", () => {
    it("is the card's texture units per metre, from its UVs and its size", () => {
      // A 0.4 m sheet whose UVs span the unit square: 4 UV units of edge over 1.6 m of edge.
      const card = sheet(0.001, 0.4);
      const { uvScale } = hairFields({
        positions: card.positions,
        faceVerts: card.faceVerts,
        body: { positions: body.positions, triangles: body.triangles },
        scalpEligible: eligibleAll,
        cutout: {
          faceUvs: new Uint32Array([0, 1, 2, 3]),
          uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
          width: 1,
          height: 1,
          alpha: new Uint8Array([255]),
        },
      });
      for (const v of uvScale) expect(v / UV_SCALE_STEPS).toBeCloseTo(2.5, 1);
    });

    it("is zero without the UVs", () => {
      const { uvScale } = run(sheet(0.001));
      expect(uvScale.every((v) => v === 0)).toBe(true);
    });
  });

  describe("fin", () => {
    it("is full on a card standing out of the scalp, which a view along the scalp sees edge-on", () => {
      const { fin } = run(strip(5, 0.002, 0.1));
      for (const f of fin) expect(f).toBe(255);
    });

    it("is zero on a card lying along the scalp, like the shell of a style", () => {
      const { fin } = run(sheet(0.01));
      for (const f of fin) expect(f).toBe(0);
    });
  });

  describe("scalp", () => {
    it("weights a scalp vertex under the card fully, falling off with distance, and lists nothing far away", () => {
      const { scalpVerts, scalpWeights } = run(strip(5, 0.002, 0.1, 0.1));
      const listed = new Map<number, number>();
      scalpVerts.forEach((v, i) => {
        listed.set(v, scalpWeights[i] as number);
      });
      // The body vertex nearest the card's foot (x = 0, z = 0 is a vertex of the grid).
      const at = (x: number, z: number) => {
        const i = Math.round(((x + 0.3) / 0.6) * GRID);
        const j = Math.round(((z + 0.3) / 0.6) * GRID);
        return j * (GRID + 1) + i;
      };
      expect(listed.get(at(0, 0))).toBe(255);
      const near = at(0, 0.05);
      const mid = at(0, 0.1);
      // 0.05 m from the card: beyond SCALP_FALLOFF past SCALP_FULL, so not listed.
      expect(SCALP_FULL + SCALP_FALLOFF).toBeLessThan(0.05);
      expect(listed.has(near)).toBe(false);
      expect(listed.has(mid)).toBe(false);
      expect(scalpVerts.length).toBeGreaterThan(0);
      for (const w of scalpWeights) expect(w).toBeGreaterThan(0);
    });

    it("falls off smoothly between SCALP_FULL and SCALP_FULL + SCALP_FALLOFF", () => {
      // A card 0.001 above the scalp covers its vertex fully; one SCALP_FULL + half the falloff
      // above (and wide) gives about half the weight under it.
      const full = run(strip(2, 0.001, 0.1, 0.2));
      const half = run(strip(2, SCALP_FULL + SCALP_FALLOFF / 2, 0.1, 0.2));
      const centre = 6 * (GRID + 1) + 6;
      const weightAt = (f: ReturnType<typeof run>) => {
        const k = f.scalpVerts.indexOf(centre);
        return k < 0 ? 0 : (f.scalpWeights[k] as number);
      };
      expect(weightAt(full)).toBe(255);
      expect(weightAt(half)).toBeGreaterThan(90);
      expect(weightAt(half)).toBeLessThan(165);
    });

    it("tints only under the hair the cut-out leaves: where the card's texture is clear there is no hair, so no tint", () => {
      // A sheet 1 mm over the scalp, its texture opaque on the left half (u < 0.5), clear on the right.
      const card = sheet(0.001, 0.4);
      const cutout = {
        faceUvs: new Uint32Array([0, 1, 2, 3]),
        // Corners (-x,-z), (+x,-z), (+x,+z), (-x,+z) -> u from 0 to 1 across x.
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        width: 2,
        height: 1,
        alpha: new Uint8Array([255, 0]),
      };
      const { scalpVerts } = hairFields({
        positions: card.positions,
        faceVerts: card.faceVerts,
        body: { positions: body.positions, triangles: body.triangles },
        scalpEligible: eligibleAll,
        cutout,
      });
      const xOf = (v: number) => body.positions[v * 3] as number;
      expect(scalpVerts.length).toBeGreaterThan(0);
      for (const v of scalpVerts) expect(xOf(v), `vertex ${v}`).toBeLessThanOrEqual(0.0501);
      // And without a cut-out the whole sheet's footprint is tinted, both halves.
      const all = hairFields({
        positions: card.positions,
        faceVerts: card.faceVerts,
        body: { positions: body.positions, triangles: body.triangles },
        scalpEligible: eligibleAll,
      });
      expect(all.scalpVerts.some((v) => xOf(v) > 0.1)).toBe(true);
    });

    it("skips ineligible body vertices: a neck or a face is never tinted", () => {
      const none = new Uint8Array(body.count);
      const { scalpVerts } = run(strip(5, 0.002, 0.1, 0.1), none);
      expect(scalpVerts.length).toBe(0);
    });
  });
});
