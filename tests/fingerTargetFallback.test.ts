import { expect, it } from "vitest";
import { fingerChannelLimits, solveFingerSurfaceTarget } from "../src/rig/fingerTarget.ts";
import { IDENTITY_POSE, type RigData, restBonesFrom } from "../src/rig/pose.ts";

it("continues from an accepted coordinate fallback to reach a surface target", () => {
  const names = [1, 2, 3].map((joint) => `finger2-${joint}.R`);
  const rig: RigData = {
    bones: names,
    faceUnits: { names: [], joints: [], frames: [] },
    poses: [
      {
        name: "tpose",
        title: "Finger solver fixture",
        description: "Three declared joints with one movable source channel.",
        joints: names.map((name) => ({
          name,
          channels: ["Xrotation", "Yrotation", "Zrotation"],
        })),
        frame: Array(9).fill(0),
      },
    ],
  };
  const rest = restBonesFrom(names, new Int16Array([-1, 0, 1]), new Float32Array(9));
  const rotations = IDENTITY_POSE(names.length);
  const before = rotations.slice();
  const channels = fingerChannelLimits(rig, 2, "R", 0, 0);
  const movable = channels.find((channel) => channel.channel === "Xrotation");
  if (!movable) throw new Error("fixture needs an X rotation channel");
  movable.minDegrees = -75;
  movable.maxDegrees = 75;

  const result = solveFingerSurfaceTarget({
    rest,
    rig,
    rotations,
    side: "R",
    digit: 2,
    channels,
    sample: (pose, out) => {
      const degrees = (2 * Math.atan2(pose[0] as number, pose[3] as number) * 180) / Math.PI;
      // A flat initial response requires the coordinate fallback; its accepted
      // position then has a slope that lets the ordinary DLS steps reach contact.
      out.position = [0.001 * Math.max(0, Math.abs(degrees) - 1), 0, 0];
      out.normal = [-1, 0, 0];
      return out;
    },
    target: () => ({ position: [0.01, 0, 0] }),
    tolerance: 0.00001,
    iterations: 24,
  });

  expect(result.status).toBe("reached");
  expect(result.distance).toBeLessThanOrEqual(0.00001);
  expect(result.pad.position[0]).toBeCloseTo(0.01, 4);
  expect(rotations).toEqual(before);
  expect(result.degrees.slice(1)).toEqual(Array(8).fill(0));
});
