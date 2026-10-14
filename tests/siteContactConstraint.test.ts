import { describe, expect, it } from "vitest";
import {
  createSiteContactConstraint,
  type SiteContactFigure,
  type SiteContactInput,
  type SiteContactReport,
} from "../src/index.ts";
import type { BoneRotations } from "../src/rig/bones.ts";

const pose = (): BoneRotations => new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]);
const receipt = (): SiteContactReport => ({
  status: "reached",
  gap: 0.001,
  orientationError: null,
  collision: 0,
  rounds: 1,
});

function setup() {
  let calls = 0;
  const solve = (input: SiteContactInput) => {
    calls++;
    input.out.set([0, 0, 0, 0, 0, 0, 0, 1]);
    return receipt();
  };
  const geometry = {};
  const source = pose();
  const sourceGeneration = {};
  const target = { effector: "finger-pad-2.R", site: "nose-tip" };
  const out = pose();
  return {
    constraint: createSiteContactConstraint(solve),
    calls: () => calls,
    input: {
      active: true,
      figure: { generation: geometry } as SiteContactFigure,
      geometryGeneration: geometry,
      source: { generation: sourceGeneration, rotations: source },
      target,
      out,
    },
  };
}

describe("cached site-contact constraint", () => {
  it("solves once for one immutable geometry, target, shape and source sample", () => {
    const { constraint, calls, input } = setup();
    expect(constraint.update(input)).toMatchObject({ state: "holding", weight: 1 });
    constraint.update(input);
    expect(calls()).toBe(1);

    constraint.update({ ...input, shape: "pinch" });
    expect(calls()).toBe(2);
    constraint.update({ ...input, target: { ...input.target } });
    expect(calls()).toBe(3);
    constraint.update({
      ...input,
      source: { generation: {}, rotations: Float32Array.from(input.source.rotations) },
    });
    expect(calls()).toBe(4);
  });

  it("blends the cached full solve without falsely reporting early contact", () => {
    const { constraint, calls, input } = setup();
    const report = constraint.update({ ...input, weight: 0.5 });
    expect(report).toMatchObject({
      state: "blending",
      weight: 0.5,
      solution: { status: "reached" },
    });
    expect(input.out[3]).toBeCloseTo(Math.SQRT1_2, 6);
    constraint.update({ ...input, weight: 1 });
    expect(calls()).toBe(1);
  });

  it("releases exactly to the source and makes a later active phase solve anew", () => {
    const { constraint, calls, input } = setup();
    constraint.update(input);
    input.out.fill(0);
    expect(constraint.update({ ...input, active: false })).toEqual({
      state: "released",
      weight: 0,
      solution: null,
    });
    expect(input.out).toEqual(input.source.rotations);
    constraint.update(input);
    expect(calls()).toBe(2);
    expect(constraint.cancel(input.source, input.out)).toMatchObject({
      state: "cancelled",
      weight: 0,
    });
    expect(input.out).toEqual(input.source.rotations);
    constraint.update(input);
    expect(calls()).toBe(3);
    constraint.invalidate();
    constraint.update(input);
    expect(calls()).toBe(4);
  });

  it("rejects an output buffer that aliases the immutable source", () => {
    const { constraint, calls, input } = setup();
    expect(() => constraint.update({ ...input, out: input.source.rotations })).toThrow(
      /out must not alias source rotations/,
    );
    expect(calls()).toBe(0);
    expect(() => constraint.release(input.source, input.source.rotations)).toThrow(
      /out must not alias source rotations/,
    );
  });

  it("rejects a distinct view that shares the source bytes before solving", () => {
    const { constraint, calls, input } = setup();
    const source = input.source.rotations;
    const alias = new Float32Array(source.buffer, source.byteOffset, source.length);
    const before = Array.from(source);
    expect(alias).not.toBe(source);
    expect(() => constraint.update({ ...input, out: alias })).toThrow(
      /out must not alias source rotations/,
    );
    expect(calls()).toBe(0);
    expect(Array.from(source)).toEqual(before);
  });

  it("rejects a mutable source pose under a retained identity", () => {
    const { constraint, calls, input } = setup();
    constraint.update(input);
    input.source.rotations[0] = 0.1;
    expect(() => constraint.update(input)).toThrow(/source pose changed without a new generation/);
    expect(calls()).toBe(1);
  });

  it("rejects stale geometry and releases permanently on dispose", () => {
    const { constraint, input } = setup();
    expect(() => constraint.update({ ...input, geometryGeneration: {} })).toThrow(
      /geometry generation is stale/,
    );
    constraint.dispose();
    expect(() => constraint.update(input)).toThrow(/disposed/);
  });
});
