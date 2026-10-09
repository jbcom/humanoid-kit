import { describe, expect, it } from "vitest";
import {
  mirrorFrame,
  mirrorJoint,
  symmetrizeFaceUnits,
  type UnitJoint,
} from "../scripts/lib/faceUnits.ts";
import { mirrorUnit } from "../src/rig/faceMirror.ts";
import { bodyManifest } from "./fixtures.ts";

const ROT = ["Xrotation", "Yrotation", "Zrotation"];
const joints: UnitJoint[] = [
  { name: "root", channels: ["Xposition", "Yposition", "Zposition", ...ROT] },
  { name: "lid.L", channels: ROT },
  { name: "lid.R", channels: ROT },
  { name: "chin", channels: ROT },
];
const width = joints.reduce((n, j) => n + j.channels.length, 0);
/** A frame with `values` set by joint name and channel, everything else 0. */
function frame(values: Record<string, number[]>): number[] {
  const out: number[] = [];
  for (const j of joints) out.push(...(values[j.name] ?? new Array(j.channels.length).fill(0)));
  expect(out.length).toBe(width);
  return out;
}

describe("mirroring a face unit", () => {
  it("names the unit across the face, and a central unit as itself", () => {
    expect(mirrorUnit("LeftBrowDown")).toBe("RightBrowDown");
    expect(mirrorUnit("RightCheekUp")).toBe("LeftCheekUp");
    expect(mirrorUnit("MouthLeftPullUp")).toBe("MouthRightPullUp");
    expect(mirrorUnit("JawDrop")).toBe("JawDrop");
    expect(mirrorUnit("NoseWrinkler")).toBe("NoseWrinkler");
    // The left eye turning right is the right eye turning left, reflected.
    expect(mirrorUnit("LeftEyeturnRight")).toBe("RightEyeturnLeft");
    expect(mirrorUnit("ChinLeft")).toBe("ChinRight");
  });

  it("pairs joints by their side suffix and leaves central ones", () => {
    expect(mirrorJoint("lid.L")).toBe("lid.R");
    expect(mirrorJoint("lid.R")).toBe("lid.L");
    expect(mirrorJoint("chin")).toBe("chin");
  });

  it("reflects a frame in the face's midplane: X position and the Y and Z rotations change sign", () => {
    const f = frame({
      root: [1, 2, 3, 4, 5, 6],
      "lid.L": [7, 8, 9],
      "lid.R": [-1, -2, -3],
      chin: [10, 11, 12],
    });
    expect(mirrorFrame(joints, f)).toEqual(
      frame({
        root: [-1, 2, 3, 4, -5, -6],
        "lid.L": [-1, 2, 3],
        "lid.R": [7, -8, -9],
        chin: [10, -11, -12],
      }),
    );
  });

  it("is its own inverse", () => {
    const f = frame({ root: [1, 2, 3, 4, 5, 6], "lid.L": [7, 8, 9], chin: [1, 2, 3] });
    expect(mirrorFrame(joints, mirrorFrame(joints, f))).toEqual(f);
  });
});

describe("symmetrising the face units", () => {
  const names = ["Rest", "LeftWink", "RightWink", "Pucker"];
  const frames = [
    frame({}),
    frame({ "lid.L": [10, 4, 2] }),
    // The right unit is not the left's mirror: its lid is turned a further 2 degrees.
    frame({ "lid.R": [10, -6, -2] }),
    frame({ chin: [8, 3, 1], "lid.L": [2, 0, 0], "lid.R": [4, 0, 0] }),
  ];
  const out = symmetrizeFaceUnits(names, joints, frames);

  it("makes every unit the mirror of its partner", () => {
    names.forEach((n, i) => {
      const partner = names.indexOf(mirrorUnit(n));
      const m = mirrorFrame(joints, out[partner] as number[]);
      (out[i] as number[]).forEach((v, k) => {
        expect(v, `${n} channel ${k}`).toBeCloseTo(m[k] as number, 9);
      });
    });
  });

  it("averages the authored side with the reflection of the other, favouring neither", () => {
    // Left unit's lid.L Y 4 against the right's reflected 6: both become 5.
    expect(out[1]).toEqual(frame({ "lid.L": [10, 5, 2] }));
    expect(out[2]).toEqual(frame({ "lid.R": [10, -5, -2] }));
  });

  it("brings a central unit's two sides level and takes its centre off the midline", () => {
    // Lids 2 and 4 become 3 and 3; the chin's sideways Y and Z turns, which a central unit cannot have, go.
    expect(out[3]).toEqual(frame({ chin: [8, 0, 0], "lid.L": [3, 0, 0], "lid.R": [3, 0, 0] }));
  });

  it("leaves a symmetric unit as it was, and rest at rest", () => {
    expect(out[0]).toEqual(frames[0]);
    const again = symmetrizeFaceUnits(names, joints, out);
    again.forEach((row, i) => {
      expect(row).toEqual(out[i]);
    });
  });

  it("refuses a unit with no partner, and joints that do not pair", () => {
    expect(() => symmetrizeFaceUnits(["LeftWink"], joints, [frame({})])).toThrow(/RightWink/);
    expect(() =>
      symmetrizeFaceUnits(["Rest"], [{ name: "lid.L", channels: ROT }], [[0, 0, 0]]),
    ).toThrow(/lid\.R/);
  });
});

describe("the shipped face units", () => {
  const {
    names,
    joints: packed,
    frames,
  } = bodyManifest.faceUnits as unknown as {
    names: string[];
    joints: UnitJoint[];
    frames: number[][];
  };

  it("are each the mirror of their partner's, to the pack's rounding", () => {
    const worst: string[] = [];
    names.forEach((n, i) => {
      const partner = names.indexOf(mirrorUnit(n));
      expect(partner, `${n} has a partner`).toBeGreaterThanOrEqual(0);
      const m = mirrorFrame(packed, frames[partner] as number[]);
      (frames[i] as number[]).forEach((v, k) => {
        if (Math.abs(v - (m[k] as number)) > 0.0011) worst.push(`${n}[${k}]`);
      });
    });
    expect(worst).toEqual([]);
  });
});
