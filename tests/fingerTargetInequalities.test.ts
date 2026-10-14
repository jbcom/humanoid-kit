import { describe, expect, it } from "vitest";
import {
  type FingerSurfaceTargetInput,
  fingerChannelLimits,
  solveFingerSurfaceTarget,
} from "../src/rig/fingerTarget.ts";
import { IDENTITY_POSE, type RigData, restBonesFrom } from "../src/rig/pose.ts";

const angle = (pose: Float32Array, joint = 0) =>
  (2 * Math.atan2(pose[joint * 4] as number, pose[joint * 4 + 3] as number) * 180) / Math.PI;

function fixture(): FingerSurfaceTargetInput {
  const names = [1, 2, 3].map((joint) => `finger2-${joint}.R`);
  const rig: RigData = {
    bones: names,
    faceUnits: { names: [], joints: [], frames: [] },
    poses: [
      {
        name: "tpose",
        title: "Constraint fixture",
        description: "Three source-channel joints.",
        joints: names.map((name) => ({ name, channels: ["Xrotation", "Yrotation", "Zrotation"] })),
        frame: Array(9).fill(0),
      },
    ],
  };
  const channels = fingerChannelLimits(rig, 2, "R", 0, 0);
  for (const channel of channels) {
    if (channel.channel !== "Xrotation") continue;
    channel.minDegrees = -15;
    channel.maxDegrees = 15;
  }
  return {
    rest: restBonesFrom(names, new Int16Array([-1, 0, 1]), new Float32Array(9)),
    rig,
    rotations: IDENTITY_POSE(3),
    side: "R",
    digit: 2,
    channels,
    sample: (pose, out) => {
      out.position = [-0.001 + 0.001 * angle(pose), 0, 0];
      out.normal = [-1, 0, 0];
      return out;
    },
    target: () => ({ position: [0.001, 0, 0], surfaceNormal: [1, 0, 0] }),
    minimumNormalAlignment: 0.9,
    tolerance: 0.00001,
    iterations: 24,
    inequalities: {
      definitions: [{ id: "skin-clearance", allowanceMeters: 0.000001 }],
      sample: (_pose, pad, _contact, margins) => {
        margins[0] = pad.position[0];
      },
    },
  };
}

describe("finger surface hard inequalities", () => {
  it("rejects a pinned interior pad even inside the contact tolerance, without publishing a pose", () => {
    const input = fixture();
    input.channels = input.channels.map((c) => ({ ...c, minDegrees: 0, maxDegrees: 0 }));
    input.tolerance = 0.002;
    input.out = new Float32Array(input.rotations.length).fill(7);
    const source = input.rotations.slice();
    const output = input.out.slice();
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("unreached");
    expect(result.reason).toBe("constraints-not-reached");
    expect(result.constraintStatus).toBe("violated");
    expect(result.constraints?.[0]?.marginMeters).toBe(-0.001);
    expect(result.rotations).toEqual(source);
    expect(input.rotations).toEqual(source);
    expect(input.out).toEqual(output);
  });

  it("restores feasibility and reaches contact using only the declared bounded channels", () => {
    const input = fixture();
    const source = input.rotations.slice();
    input.out = new Float32Array(source.length).fill(7);
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("reached");
    expect(result.constraintStatus).toBe("feasible");
    expect(result.distance).toBeLessThanOrEqual(input.tolerance as number);
    expect(result.normalAlignment).toBe(1);
    expect(result.rotations).toBe(input.out);
    expect(input.rotations).toEqual(source);
    for (let i = 0; i < input.channels.length; i++) {
      expect(result.degrees[i]).toBeGreaterThanOrEqual(input.channels[i]?.minDegrees as number);
      expect(result.degrees[i]).toBeLessThanOrEqual(input.channels[i]?.maxDegrees as number);
    }
  });

  it("does not publish a bounded but still penetrating restoration iterate", () => {
    const input = fixture();
    input.channels = input.channels.map((c) => ({ ...c, minDegrees: 0, maxDegrees: 0.5 }));
    input.out = new Float32Array(input.rotations.length).fill(7);
    const output = input.out.slice();
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("unreached");
    expect(result.reason).toBe("constraints-not-reached");
    expect(result.rotations).toEqual(input.rotations);
    expect(input.out).toEqual(output);
    expect(result.constraints?.[0]?.marginMeters).toBe(-0.001);
  });

  it.each([-1, 1])("preserves exact station bounds when contact asks past edge %s", (side) => {
    const input = fixture();
    input.sample = (pose, out) => {
      out.position = [0.0015 + 0.001 * angle(pose), 0, 0];
      out.normal = [-1, 0, 0];
      return out;
    };
    input.target = () => ({ position: [side < 0 ? -0.003 : 0.006, 0, 0] });
    delete input.minimumNormalAlignment;
    input.inequalities = {
      definitions: [
        { id: "station-low", allowanceMeters: 0 },
        { id: "station-high", allowanceMeters: 0 },
      ],
      sample: (_pose, pad, _contact, margins) => {
        margins[0] = pad.position[0];
        margins[1] = 0.003 - pad.position[0];
      },
    };
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("unreached");
    expect(result.reason).not.toBe("constraints-not-reached");
    expect(result.constraintStatus).toBe("feasible");
    expect(result.pad.position[0]).toBeGreaterThanOrEqual(0);
    expect(result.pad.position[0]).toBeLessThanOrEqual(0.003);
    expect(result.distance).toBeLessThan(0.0045);
  });

  it("checks nonlinear feasibility after the linearized step", () => {
    const input = fixture();
    input.sample = (pose, out) => {
      out.position = [0.001 * angle(pose), 0.001 * angle(pose, 1), 0];
      out.normal = [-1, 0, 0];
      return out;
    };
    input.target = () => ({ position: [0.004, 0, 0] });
    delete input.minimumNormalAlignment;
    input.inequalities = {
      definitions: [{ id: "inside-circle", allowanceMeters: 0 }],
      sample: (_pose, pad, _contact, margins) => {
        margins[0] = 0.002 - Math.hypot(pad.position[0], pad.position[1]);
      },
    };
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("unreached");
    expect(result.constraintStatus).toBe("feasible");
    expect(Math.hypot(result.pad.position[0], result.pad.position[1])).toBeLessThanOrEqual(0.002);
    expect(result.distance).toBeLessThan(0.004);
  });

  it("cannot purchase penetration with a better normal objective", () => {
    const input = fixture();
    input.sample = (pose, out) => {
      const a = angle(pose);
      out.position = [0.001 + 0.001 * a, 0, 0];
      out.normal = [Math.sin(a * 0.1), -Math.cos(a * 0.1), 0];
      return out;
    };
    input.target = () => ({ position: [0, 0, 0], surfaceNormal: [1, 0, 0] });
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("unreached");
    expect(result.constraintStatus).toBe("feasible");
    expect(result.pad.position[0]).toBeGreaterThanOrEqual(-0.000001);
    expect(result.normalAlignment).toBeLessThan(0.9);
  });

  it("repairs only feasibility without forcing a rest digit onto a contact target", () => {
    const input = fixture();
    input.mode = "repair-only";
    delete input.minimumNormalAlignment;
    input.target = () => ({ position: [0.01, 0, 0] });
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("reached");
    expect(result.constraintStatus).toBe("feasible");
    expect(result.distance).toBeGreaterThan(0.002);
    expect(result.pad.position[0]).toBeGreaterThanOrEqual(-0.000001);
  });

  it.each(["contact", "repair-only"] as const)(
    "keeps %s restoration independent of the contact target",
    (mode) => {
      const solve = (targetY: number) => {
        const input = fixture();
        input.mode = mode;
        input.iterations = 1;
        delete input.minimumNormalAlignment;
        input.sample = (pose, out) => {
          const a = angle(pose);
          out.position = [-0.001 + 0.001 * Math.max(0, Math.abs(a) - 1), 0.001 * a, 0];
          out.normal = [-1, 0, 0];
          return out;
        };
        input.target = () => ({ position: [0.006, targetY, 0] });
        return solveFingerSurfaceTarget(input);
      };
      const below = solve(-0.008);
      const above = solve(0.008);
      expect(below.constraintStatus).toBe("feasible");
      expect(above.constraintStatus).toBe("feasible");
      expect(above.degrees).toEqual(below.degrees);
      expect(above.pad.position).toEqual(below.pad.position);
    },
  );

  it("re-evaluates dynamic constraints against the same candidate pose and target", () => {
    const input = fixture();
    let latest = Number.NaN;
    let constraintSamples = 0;
    const sample = input.sample;
    input.sample = (pose, out) => {
      latest = angle(pose);
      return sample(pose, out);
    };
    input.target = (pad) => ({ position: [0.001, pad.position[1], 0] });
    delete input.minimumNormalAlignment;
    if (!input.inequalities) throw new Error("missing fixture constraints");
    input.inequalities.sample = (pose, pad, contact, margins) => {
      expect(angle(pose)).toBe(latest);
      expect(pad.position[0]).toBeCloseTo(-0.001 + 0.001 * latest, 12);
      expect(contact.position[1]).toBe(pad.position[1]);
      margins[0] = -0.001 + 0.001 * angle(pose);
      constraintSamples++;
    };
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("reached");
    expect(constraintSamples).toBe(result.constraintSamples);
    expect(constraintSamples).toBeGreaterThan(3);
  });

  it("makes tangential contact progress with duplicate and opposing active inequalities", () => {
    const input = fixture();
    input.sample = (pose, out) => {
      out.position = [0.001 * angle(pose), 0.001 * angle(pose, 1), 0];
      out.normal = [-1, 0, 0];
      return out;
    };
    input.target = () => ({ position: [-0.001, 0.005, 0], surfaceNormal: [1, 0, 0] });
    input.tolerance = 0.0011;
    input.inequalities = {
      definitions: [
        { id: "station-low", allowanceMeters: 0 },
        { id: "station-high", allowanceMeters: 0 },
        { id: "coincident-skin", allowanceMeters: 0 },
      ],
      sample: (_pose, pad, _contact, margins) => {
        margins[0] = pad.position[0];
        margins[1] = -pad.position[0];
        margins[2] = pad.position[0];
      },
    };
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("reached");
    expect(result.pad.position[0]).toBe(0);
    expect(result.pad.position[1]).toBeGreaterThan(0.0045);
    expect(result.normalAlignment).toBe(1);
    expect(result.constraintStatus).toBe("feasible");
  });

  it("restores a coupled margin while preserving other feasible inequalities", () => {
    const input = fixture();
    input.sample = (pose, out) => {
      out.position = [0.001 * angle(pose), 0.001 * angle(pose, 1), 0];
      out.normal = [-1, 0, 0];
      return out;
    };
    input.target = () => ({ position: [0.001, 0.003, 0], surfaceNormal: [1, 0, 0] });
    input.inequalities = {
      definitions: [
        { id: "coupled-plane", allowanceMeters: 0.000001 },
        { id: "station-low", allowanceMeters: 0 },
        { id: "other-station-low", allowanceMeters: 0 },
      ],
      sample: (_pose, pad, _contact, margins) => {
        margins[0] = (pad.position[0] + pad.position[1] - 0.003) / Math.SQRT2;
        margins[1] = pad.position[0];
        margins[2] = pad.position[1];
      },
    };
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("reached");
    expect(result.constraintStatus).toBe("feasible");
    expect(result.distance).toBeLessThanOrEqual(input.tolerance as number);
    expect(result.pad.position[0]).toBeGreaterThanOrEqual(0);
    expect(result.pad.position[1]).toBeGreaterThanOrEqual(0);
    expect(result.constraints?.[0]?.marginMeters).toBeGreaterThanOrEqual(-0.000001);
  });

  it.each(["throw", "unwritten", "nan"])(
    "keeps caller buffers untouched for callback %s",
    (failure) => {
      const input = fixture();
      input.out = new Float32Array(input.rotations.length).fill(7);
      const source = input.rotations.slice();
      const output = input.out.slice();
      let calls = 0;
      if (!input.inequalities) throw new Error("missing fixture constraints");
      input.inequalities.sample = (_pose, pad, _contact, margins) => {
        if (++calls === 3) {
          if (failure === "throw") throw new Error("constraint callback failed");
          if (failure === "nan") margins[0] = Number.NaN;
          return;
        }
        margins[0] = pad.position[0];
      };
      expect(() => solveFingerSurfaceTarget(input)).toThrow();
      expect(input.rotations).toEqual(source);
      expect(input.out).toEqual(output);
    },
  );

  it.each([
    [{ id: "", allowanceMeters: 0 }],
    [{ id: "clearance", allowanceMeters: -1 }],
    [{ id: "clearance", allowanceMeters: Number.NaN }],
    [
      { id: "same", allowanceMeters: 0 },
      { id: "same", allowanceMeters: 0 },
    ],
    [],
  ])("rejects invalid immutable definitions %j", (...definitions) => {
    const input = fixture();
    if (!input.inequalities) throw new Error("missing fixture constraints");
    input.inequalities.definitions = definitions;
    expect(() => solveFingerSurfaceTarget(input)).toThrow(/inequalit/);
  });

  it("snapshots definitions before a caller callback can mutate their original storage", () => {
    const input = fixture();
    const definitions = [{ id: "clearance", allowanceMeters: 0.000001 }];
    input.inequalities = {
      definitions,
      sample: (_pose, pad, _contact, margins) => {
        definitions[0] = { id: "changed", allowanceMeters: 1 };
        margins[0] = pad.position[0];
      },
    };
    const result = solveFingerSurfaceTarget(input);
    expect(result.status).toBe("reached");
    expect(result.constraints?.[0]?.id).toBe("clearance");
    expect(result.constraints?.[0]?.allowanceMeters).toBe(0.000001);
  });

  it("requires inequalities and forbids a contact-normal threshold in repair-only mode", () => {
    const input = fixture();
    input.mode = "repair-only";
    expect(() => solveFingerSurfaceTarget(input)).toThrow(/repair-only/);
    delete input.minimumNormalAlignment;
    delete input.inequalities;
    expect(() => solveFingerSurfaceTarget(input)).toThrow(/repair-only/);
  });
});
