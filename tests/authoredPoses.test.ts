import { describe, expect, it } from "vitest";
import { authoredPose, authoredPoses } from "../scripts/lib/authoredPoses.ts";
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
    expect(() => make({ rotations: { nope: { Yrotation: 1 } } })).toThrow(/no joint/);
    expect(() => make({ rotations: { "upperarm01.L": { Xposition: 1 } } })).toThrow(/channel/);
    expect(() => make({ rotations: { "upperarm01.L": { Yrotation: "a" } } })).toThrow(/number/);
    expect(() => make({ rotations: { "upperarm01.L": { Yrotation: null } } })).toThrow(/number/);
  });
});
