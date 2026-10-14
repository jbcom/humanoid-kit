import { describe, expect, it } from "vitest";
import type { CanalClosureSpec } from "../src/format/assetFormat.ts";
import {
  CLOSED_FROM,
  closedLipNormals,
  closedLoop,
  closureDisplacement,
  closureShare,
} from "../src/model/canalClosure.ts";

type V = readonly [number, number, number];

/** A loop of `n` points on an ellipse in the plane y = 0 (skin facing down, -y), `ax` across, `az` front to back. */
const ellipse = (n: number, ax: number, az: number, at: V = [0, 0, 0]): V[] =>
  Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return [at[0] + ax * Math.sin(t), at[1], at[2] + az * Math.cos(t)] as const;
  });
const DOWN: V = [0, -1, 0];

describe("a canal's closure at the skin", () => {
  it("closes a slit across and keeps its length front to back", () => {
    const loop = ellipse(16, 0.006, 0.012, [0.01, -0.07, 0.03]);
    const closed = closedLoop(loop, DOWN, 0);
    loop.forEach((p, i) => {
      const q = closed[i] as V;
      expect(q[0]).toBeCloseTo(0.01, 9);
      expect(q[1]).toBeCloseTo(p[1], 9);
      expect(q[2]).toBeCloseTo(p[2], 9);
    });
  });

  it("shortens a puckered slit while keeping the skin curve in proportion", () => {
    // A non-flat loop retains a shortened curve instead of collapsing to a point.
    const loop = ellipse(12, 0.006, 0.006).map(
      (p) => [p[0], p[1] + 0.001 * (p[2] / 0.006) ** 2, p[2]] as const,
    );
    const mean = loop.reduce((s, p) => s + p[1], 0) / loop.length;
    const closed = closedLoop(loop, DOWN, 0, 0.003);
    loop.forEach((p, i) => {
      const q = closed[i] as V;
      expect(q[0]).toBeCloseTo(0, 9);
      expect(q[1] - mean).toBeCloseTo((p[1] - mean) * 0.25, 9);
      expect(q[2]).toBeCloseTo(p[2] * 0.25, 9);
    });
    const length = Math.max(...closed.map((q) => q[2])) - Math.min(...closed.map((q) => q[2]));
    expect(length).toBeCloseTo(0.003, 9);
    const open = closedLoop(loop, DOWN, 0.002, 0.003);
    const gap = Math.max(...open.map((q) => q[0])) - Math.min(...open.map((q) => q[0]));
    expect(gap).toBeCloseTo(0.002, 9);
  });

  it("meets at one depth when opposite sides of the skin have different depths", () => {
    const loop = ellipse(16, 0.006, 0.012).map(
      (p) => [p[0], 0.2 * p[0] + 0.001 * (p[2] / 0.012) ** 2, p[2]] as const,
    );
    const closed = closedLoop(loop, DOWN, 0);
    for (let i = 1; i < 8; i++) {
      const left = closed[i] as V;
      const right = closed[16 - i] as V;
      expect(left[0]).toBeCloseTo(right[0], 9);
      expect(left[1]).toBeCloseTo(right[1], 9);
      expect(left[2]).toBeCloseTo(right[2], 9);
      expect(left[1]).toBeCloseTo(0.001 * (left[2] / 0.012) ** 2, 9);
    }
  });

  it("shades a closed slit's lips together, as far as the canal is closed (#77)", () => {
    // Two lips facing across the slit and away from each other's sides, side by side
    // along it, with a vertex of skin that is not a lip, and a lip of a canal not drawn.
    const tilt = Math.SQRT1_2;
    const positions = Float32Array.from([
      0, 0, 0, 0, 0, 0.001, 0, 0, 0.002, 0, 0, 0.003, 0.05, 0, 0, 0.09, 0, 0,
    ]);
    const facing = [
      tilt,
      -tilt,
      0,
      -tilt,
      -tilt,
      0,
      tilt,
      -tilt,
      0,
      -tilt,
      -tilt,
      0,
      1,
      0,
      0,
      1,
      0,
      0,
    ];
    const closure = {
      canal: Int16Array.from([0, 0, 0, 0, -1, 1]),
      follows: Float32Array.from([1, 1, 1, 1, 0, 1]),
    };
    const normals = Float32Array.from(facing);
    closedLipNormals(closure, [1, 0], positions, normals);
    const deg = (a: number, b: readonly number[]) =>
      (Math.acos(
        Math.min(
          1,
          [0, 1, 2].reduce((s, k) => s + (normals[a * 3 + k] as number) * (b[k] as number), 0),
        ),
      ) *
        180) /
      Math.PI;
    for (let v = 0; v < 4; v++) {
      // Across mostly cancels: each lip faces out of the skin, near the normal both share,
      // 90 degrees from the other lip's beside it before.
      expect(deg(v, [0, -1, 0])).toBeLessThan(30);
      if (v > 0) expect(deg(v, [...normals.subarray((v - 1) * 3, v * 3)])).toBeLessThan(30);
      expect(Math.hypot(...normals.subarray(v * 3, v * 3 + 3))).toBeCloseTo(1, 6);
    }
    // Neither the skin round it nor an open canal's lips.
    expect([...normals.subarray(12)]).toEqual(facing.slice(12));
    const open = Float32Array.from(facing);
    closedLipNormals(closure, [0, 0], positions, open);
    expect([...open]).toEqual([...Float32Array.from(facing)]);
  });

  it("does not lengthen a loop when the requested slit is longer than the opening", () => {
    const loop = ellipse(16, 0.006, 0.012);
    const closed = closedLoop(loop, DOWN, 0, 0.04);
    loop.forEach((p, i) => {
      expect((closed[i] as V)[2]).toBeCloseTo(p[2], 9);
    });
  });

  it("closes a figure's own loop wherever its shape differs from the authoring figure's", () => {
    // The zone's weights carry the loop's moves; the loop itself closes exactly on any loop.
    const spec: CanalClosureSpec = {
      target: "t",
      gap: 0,
      normal: [0, 1, 0],
      loopRegion: [0, 1, 2, 3],
      zone: [7],
      zoneStart: [0, 2],
      zoneLoop: [1, 3],
      zoneWeight: [0.25, 0.25],
    };
    for (const width of [0.004, 0.009]) {
      const loop = ellipse(4, width, 0.01);
      const d = closureDisplacement(spec, loop, 1);
      expect(d.indices).toEqual([0, 1, 2, 3, 7]);
      for (let i = 0; i < 4; i++)
        expect((loop[i] as V)[0] + (d.xyz[i * 3] as number)).toBeCloseTo(0, 9);
      // The zone vertex: a quarter of each side's move across, which are opposite.
      expect(d.xyz[12] as number).toBeCloseTo(0, 9);
    }
  });

  it("applies the specified slit length when closing a figure's own loop", () => {
    const spec: CanalClosureSpec = {
      target: "t",
      gap: 0,
      length: 0.003,
      normal: [0, 1, 0],
      loopRegion: [0, 1, 2, 3],
      zone: [],
      zoneStart: [0],
      zoneLoop: [],
      zoneWeight: [],
    };
    const loop = ellipse(4, 0.006, 0.006);
    const d = closureDisplacement(spec, loop, 1);
    const front = loop.map((p, i) => p[2] + (d.xyz[i * 3 + 2] as number));
    expect(Math.max(...front) - Math.min(...front)).toBeCloseTo(0.003, 9);
  });

  it("is closed at every weight its canal is drawn at from CLOSED_FROM, and none at 0", () => {
    expect(closureShare(0)).toBe(0);
    expect(closureShare(CLOSED_FROM)).toBe(1);
    expect(closureShare(0.5)).toBe(1);
    expect(closureShare(CLOSED_FROM / 2)).toBeCloseTo(0.5, 6);
  });
});
