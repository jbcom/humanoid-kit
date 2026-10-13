/**
 * An organ carried by its loop (src/model/detailCarry.ts): a reservoir's pushed
 * vertices are placed from the figure the detail was authored on, moved rigidly
 * from its loop to this figure's, and a vertex nothing pushes stays on this
 * figure's skin.
 */
import { describe, expect, it } from "vitest";
import type { ReservoirCarriage } from "../src/model/detailCarry.ts";
import {
  CARRIED_FROM,
  CARRIED_FULLY,
  carriedDetail,
  rigidFit,
  skinUnderOrgans,
} from "../src/model/detailCarry.ts";

/** A rotation of `angle` about the unit `axis`, as a row-major 3x3. */
function rotation(axis: [number, number, number], angle: number): number[] {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}
const apply = (R: ArrayLike<number>, t: ArrayLike<number>, p: readonly number[]) =>
  [0, 1, 2].map(
    (r) =>
      (R[r * 3] as number) * (p[0] as number) +
      (R[r * 3 + 1] as number) * (p[1] as number) +
      (R[r * 3 + 2] as number) * (p[2] as number) +
      (t[r] as number),
  ) as [number, number, number];

const R = rotation(
  [0.3, 0.9, 0.3].map((v) => v / Math.hypot(0.3, 0.9, 0.3)) as [number, number, number],
  0.4,
);
const T = [0.02, -0.01, 0.03];
// A loop of eight points on a skewed ring, authored, and the same moved rigidly.
const authoredLoop = Array.from({ length: 8 }, (_, i) => {
  const a = (2 * Math.PI * i) / 8;
  return [0.015 * Math.cos(a), 0.01 * Math.sin(a), 0.002 * Math.cos(2 * a)];
});
const figureLoop = authoredLoop.map((p) => apply(R, T, p));

describe("the rigid fit of a loop", () => {
  it("recovers a rigid motion exactly", () => {
    const fit = rigidFit(authoredLoop.flat(), figureLoop.flat());
    for (let i = 0; i < 9; i++) expect(fit.rotation[i]).toBeCloseTo(R[i] as number, 9);
    for (let k = 0; k < 3; k++) expect(fit.translation[k]).toBeCloseTo(T[k] as number, 9);
  });
});

describe("a reservoir's detail, carried", () => {
  // Lattice vertices 0..7 are the loop; 8 and 9 lie inside it. Detail indices 20 and 21 are
  // members resting on 8 and 9; 30 is outside every reservoir.
  const carriage: ReservoirCarriage = {
    loop: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
    members: Uint32Array.from([20, 21]),
    restOn: Uint32Array.from([8, 9]),
  };
  const authoredInside: Record<number, number[]> = { 8: [0, 0, 0.001], 9: [0.004, 0, 0] };
  // This figure's skin inside the loop is not where the motion puts it: the body morph moved it.
  const figureInside: Record<number, number[]> = {
    8: [...apply(R, T, [0, 0, 0.001])].map((v, k) => v + (k === 1 ? 0.003 : 0)),
    9: apply(R, T, [0.004, 0, 0]),
  };
  const authored = (v: number) =>
    (v < 8 ? authoredLoop[v] : authoredInside[v]) as unknown as readonly [number, number, number];
  const figure = (v: number) =>
    (v < 8 ? figureLoop[v] : figureInside[v]) as unknown as readonly [number, number, number];

  it("places a vertex pushed past the full distance where the authored skin and its push, carried, put it", () => {
    const d = [0, -0.03, 0];
    const out = carriedDetail(
      { indices: [20, 30], xyz: Float32Array.from([...d, 0.001, 0, 0]) },
      [carriage],
      authored,
      figure,
    );
    const indices = Array.from(out.indices);
    const at = indices.indexOf(20);
    const want = apply(R, T, [d[0] as number, d[1] as number, 0.001 + (d[2] as number)]);
    for (let k = 0; k < 3; k++)
      expect((figureInside[8]?.[k] as number) + (out.xyz[at * 3 + k] as number)).toBeCloseTo(
        want[k] as number,
        6,
      );
    // Outside every reservoir: the displacement as given.
    const o = indices.indexOf(30);
    expect(Array.from(out.xyz.subarray(o * 3, o * 3 + 3))).toEqual([
      expect.closeTo(0.001, 7),
      0,
      0,
    ]);
  });

  it("leaves a vertex nothing pushes exactly on this figure's skin, and blends without a jump between", () => {
    const zero = carriedDetail(
      { indices: [21], xyz: new Float32Array(3) },
      [carriage],
      authored,
      figure,
    );
    expect(Array.from(zero.xyz)).toEqual([0, 0, 0]);
    // Pushed less than the carriage starts: the displacement as given, on this figure's skin.
    const near = carriedDetail(
      { indices: [20], xyz: Float32Array.from([0, -0.9 * CARRIED_FROM, 0]) },
      [carriage],
      authored,
      figure,
    );
    expect(Array.from(near.xyz)).toEqual([0, expect.closeTo(-0.9 * CARRIED_FROM, 7), 0]);
    let previous: number[] | null = null;
    let jump = 0;
    for (let s = 0; s <= 2 * CARRIED_FULLY; s += CARRIED_FULLY / 400) {
      const out = carriedDetail(
        { indices: [20], xyz: Float32Array.from([0, -s, 0]) },
        [carriage],
        authored,
        figure,
      );
      const p = Array.from(out.xyz);
      if (previous)
        jump = Math.max(
          jump,
          Math.hypot(...p.map((v, k) => v - ((previous as number[])[k] as number))),
        );
      previous = p;
    }
    expect(jump).toBeLessThan(1e-4);
  });

  it("sums a member's displacements from several targets before carrying them", () => {
    const one = carriedDetail(
      { indices: [20], xyz: Float32Array.from([0, -0.02, 0]) },
      [carriage],
      authored,
      figure,
    );
    const two = carriedDetail(
      { indices: [20, 20], xyz: Float32Array.from([0, -0.012, 0, 0, -0.008, 0]) },
      [carriage],
      authored,
      figure,
    );
    for (let k = 0; k < 3; k++) expect(two.xyz[k]).toBeCloseTo(one.xyz[k] as number, 7);
  });

  it("lets a member keep the skin's own detail as far as its organ leaves it in the skin", () => {
    // The skin sinks 4 mm at members 20 and 21 and at 30, outside every reservoir.
    const skin = {
      indices: [20, 21, 30],
      xyz: Float32Array.from([0, 0, -0.004, 0, 0, -0.004, 0, 0, -0.004]),
    };
    const at = (organ: number) =>
      skinUnderOrgans(skin, { indices: [20], xyz: Float32Array.from([0, -organ, 0]) }, [carriage])
        .xyz;
    // Not pushed (or barely): the skin's whole sink; pushed fully out: none of it.
    expect(at(0)[2]).toBeCloseTo(-0.004, 9);
    expect(at(CARRIED_FROM)[2]).toBeCloseTo(-0.004, 9);
    expect(at(CARRIED_FULLY)[2]).toBeCloseTo(0, 9);
    const half = at((CARRIED_FROM + CARRIED_FULLY) / 2)[2] as number;
    expect(half).toBeLessThan(-0.001);
    expect(half).toBeGreaterThan(-0.003);
    // A member the organ does not push, and a vertex outside every reservoir, keep it.
    expect(at(CARRIED_FULLY)[5]).toBeCloseTo(-0.004, 9);
    expect(at(CARRIED_FULLY)[8]).toBeCloseTo(-0.004, 9);
  });
});
