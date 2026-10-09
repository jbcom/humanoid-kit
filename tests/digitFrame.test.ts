import { describe, expect, it } from "vitest";
import { type DigitLine, digitFrame } from "../src/surface/regions/digitFrame.ts";

type V = [number, number, number];

/** A digit along +z from the origin, with a bend at its middle joint, and a ring of vertices round it at each station. */
function digit(bend = 0): { line: DigitLine; points: V[] } {
  // Base (0,0,0) is the reference point, then joints at z = 0.02, 0.05, 0.075 and the tip at 0.095.
  const joints: V[] = [
    [0, 0, -0.03],
    [0, 0, 0],
    [0, 0, 0.02],
    [0, 0, 0.05],
    [0, 0, 0.07],
  ];
  const turned = joints.map((p, i) =>
    i >= 3 ? ([p[0] + bend * (i - 2) * 0.01, p[1], p[2]] as V) : p,
  );
  return { line: turned, points: [] };
}

describe("a digit frame", () => {
  const facing: V = [0, 1, 0];

  it("gives a vertex its digit, its distance along (from the base joint) and across", () => {
    const line = digit().line;
    // Rings of eight vertices of radius 5 mm at stations along the digit.
    const positions: number[] = [];
    const stations = [-0.02, 0.005, 0.03, 0.06];
    for (const z of stations)
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 2 * Math.PI;
        positions.push(0.005 * Math.cos(a), 0.005 * Math.sin(a), z);
      }
    const n = positions.length / 3;
    const frame = digitFrame({
      positions: Float32Array.from(positions),
      vertexCount: n,
      include: () => true,
      lines: [line],
      facing,
    });
    for (let v = 0; v < n; v++) {
      expect(frame.digit[v]).toBe(1);
      const z = positions[v * 3 + 2] as number;
      // `along` is the position along the digit from its base joint (the line's second point).
      expect(frame.along[v]).toBeCloseTo(z, 4);
      // `across` is the offset along (axis × facing): for an axis of +z and a facing of +y, that is -x.
      expect(frame.across[v]).toBeCloseTo(-(positions[v * 3] as number), 4);
      // `under` is the offset's part along the facing direction: +y.
      expect(frame.under[v]).toBeCloseTo(positions[v * 3 + 1] as number, 4);
    }
  });

  it("takes the nearest of several digits", () => {
    const a = digit().line;
    const b = a.map(([x, y, z]) => [x + 0.02, y, z] as V);
    const positions = Float32Array.from([0.002, 0.003, 0.03, 0.019, 0.003, 0.03]);
    const frame = digitFrame({
      positions,
      vertexCount: 2,
      include: () => true,
      lines: [a, b],
      facing,
    });
    expect(Array.from(frame.digit)).toEqual([1, 2]);
  });

  it("leaves vertices it is not asked about alone", () => {
    const line = digit().line;
    const frame = digitFrame({
      positions: Float32Array.from([0, 0, 0.03, 0, 0, 0.03]),
      vertexCount: 2,
      include: (v) => v === 1,
      lines: [line],
      facing,
    });
    expect(frame.digit[0]).toBe(0);
    expect(frame.digit[1]).toBe(1);
  });

  it("runs along on smoothly round a bend: no jump at the bisector", () => {
    const line = digit(1).line;
    // Stations across the bend at the third joint (z = 0.05), on the digit's axis offset by 4 mm.
    const stations: number[] = [];
    for (let i = 0; i <= 40; i++) stations.push(0.035 + (0.03 * i) / 40);
    const pts: number[] = [];
    for (const z of stations) pts.push(0.004, 0.004, z);
    const frame = digitFrame({
      positions: Float32Array.from(pts),
      vertexCount: stations.length,
      include: () => true,
      lines: [line],
      facing,
    });
    let worst = 0;
    for (let i = 1; i < stations.length; i++)
      worst = Math.max(
        worst,
        Math.abs((frame.along[i] as number) - (frame.along[i - 1] as number)),
      );
    // Consecutive samples 0.75 mm apart: `along` may not step by more than a few times that.
    expect(worst).toBeLessThan(0.003);
  });

  it("reports each digit's joints as distances along it from its base joint", () => {
    const line = digit().line;
    const frame = digitFrame({
      positions: Float32Array.from([0.005, 0, 0.03]),
      vertexCount: 1,
      include: () => true,
      lines: [line],
      facing,
    });
    // Joints: base 0, then the two joints and the tip, as distances along from the base.
    expect(frame.joints[0]?.[0]).toBeCloseTo(0, 6);
    expect(frame.joints[0]?.length).toBe(4);
    expect(frame.joints[0]?.[3]).toBeCloseTo(0.07, 4);
  });
});
