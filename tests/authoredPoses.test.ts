import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTHORED_POSES_DIR, authoredPose, authoredPoses } from "../scripts/lib/authoredPoses.ts";
import { bodyPoseRotations, jointChannelRotations, rigData } from "../src/rig/pose.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const { manifest } = loadFixtureAssets();
const shipped = manifest.poses.filter((p) => p.name === "tpose" || p.name === "benchmark");
const bones = manifest.skeleton.bones.map((b) => b.name);

describe("authored body poses", () => {
  it("are packed exactly as their files say (re-run pnpm pack:data after editing one)", () => {
    const authored = authoredPoses(shipped, bones);
    expect(authored.length).toBeGreaterThan(0);
    for (const { pose } of authored)
      expect(manifest.poses.find((p) => p.name === pose.name)).toEqual(pose);
  });

  it("refuse a file that would pack a broken or inert pose", () => {
    const good = {
      name: "test",
      title: "Test",
      description: "A test pose.",
      base: "tpose",
      rotations: { "upperarm01.L": { Yrotation: 10 } },
    };
    const make = (over: object, file = "test.json") =>
      authoredPose(file, { ...good, ...over }, shipped, bones);
    expect(make({}).frame.some((v) => v === 10)).toBe(true);
    expect(() => make({}, "other.json")).toThrow(/name/);
    expect(() => make({ name: "tpose" }, "tpose.json")).toThrow(/MakeHuman/);
    expect(() => make({ title: "" })).toThrow(/title/);
    expect(() => make({ description: undefined })).toThrow(/description/);
    expect(() => make({ base: "dab" })).toThrow(/base/);
    expect(() => make({ rotations: undefined })).toThrow(/rotations/);
    expect(() => make({ rotations: {} })).toThrow(/rotates nothing/);
    expect(() => make({ rotations: { "upperarm01.L": {} } })).toThrow(/rotates nothing/);
    expect(() => make({ rotations: { "upperarm01.L": { Yrotation: 0 } } })).toThrow(
      /rotates nothing/,
    );
    expect(() => make({ rotations: { nope: { Yrotation: 1 } } })).toThrow(/no joint/);
    expect(() => make({ rotations: { "upperarm01.L": { Xposition: 1 } } })).toThrow(/channel/);
    expect(() => make({ rotations: { "upperarm01.L": { Yrotation: "a" } } })).toThrow(/number/);
    expect(() => make({ rotations: { "upperarm01.L": { Yrotation: null } } })).toThrow(/number/);
  });
});

describe("joints posed by hand", () => {
  const rig = rigData(loadFixtureAssets());

  it("pose a bone exactly as the same entry in an authored pose file does", () => {
    for (const { file, pose } of authoredPoses(shipped, bones)) {
      const spec = JSON.parse(fs.readFileSync(path.join(AUTHORED_POSES_DIR, file), "utf8"));
      const byHand = jointChannelRotations(rig, spec.rotations);
      const packed = bodyPoseRotations(rig, pose.name);
      byHand.forEach((v, i) => {
        expect(v, `${pose.name} [${i}]`).toBeCloseTo(packed[i] as number, 6);
      });
    }
  });

  it("replace the joints they name and keep every other joint of the pose under them", () => {
    const seated = bodyPoseRotations(rig, "seated");
    const out = jointChannelRotations(rig, { "upperarm01.L": { Yrotation: -90 } }, seated.slice());
    const arm = rig.bones.indexOf("upperarm01.L");
    const alone = jointChannelRotations(rig, { "upperarm01.L": { Yrotation: -90 } });
    out.forEach((v, i) => {
      const own = i >= arm * 4 && i < arm * 4 + 4;
      expect(v).toBeCloseTo((own ? alone : seated)[i] as number, 6);
    });
  });

  it("refuse a joint or channel the rig does not have", () => {
    expect(() => jointChannelRotations(rig, { nope: { Xrotation: 1 } })).toThrow(/joint/);
    expect(() => jointChannelRotations(rig, { "upperarm01.L": { Xposition: 1 } as never })).toThrow(
      /channel/,
    );
  });
});
