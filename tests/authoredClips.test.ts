import { describe, expect, it } from "vitest";
import {
  AUTHORED_LICENCE,
  authoredClip,
  authoredClips,
  channelCurve,
  mirrorChannels,
} from "../scripts/lib/authoredClips.ts";
import { loadFixtureAssets } from "./fixtures.ts";

const { manifest } = loadFixtureAssets();
const shipped = manifest.poses.filter((p) => p.name === "tpose");
const bones = manifest.skeleton.bones.map((b) => b.name);

const good = {
  id: "test",
  title: "Test",
  description: "A test clip.",
  tags: ["test"],
  base: "tpose",
  fps: 30,
  duration: 1,
  loop: false,
  rootMotion: false,
  grounded: true,
  keys: [
    { t: 0, rotations: { "upperarm01.L": { Zrotation: 0 } } },
    { t: 1, rotations: { "upperarm01.L": { Zrotation: 60 } } },
  ],
};
const make = (over: object, file = "test.json") =>
  authoredClip(file, { ...good, ...over }, shipped, bones);

describe("authored clips", () => {
  it("every file in scripts/clips/ samples on the body's skeleton at 30 fps", () => {
    const clips = authoredClips(shipped, bones);
    expect(clips.length).toBeGreaterThan(0);
    for (const c of clips) {
      expect(c.fps, c.id).toBe(30);
      expect(c.frames, c.id).toBeGreaterThan(1);
      expect(c.file, c.id).toBe(`scripts/clips/${c.id}.json`);
      expect(c.sha256, c.id).toMatch(/^[0-9a-f]{64}$/);
      for (let f = 0; f < c.frames; f++)
        for (const b of c.frame(f).keys()) expect(bones[b], `${c.id}: ${b}`).toBeDefined();
    }
    expect(AUTHORED_LICENCE).toMatch(/^CC0 1\.0 Universal/);
  });

  it("holds each key on its frame and keeps a plain clip's frame count one past its last", () => {
    const c = make({});
    expect(c.frames).toBe(31);
    const arm = bones.indexOf("upperarm01.L");
    // The first key is the rest pose, so frame 0 turns nothing; the last holds the 60° turn.
    expect(c.frame(0).get(arm)).toBeUndefined();
    const q1 = c.frame(30).get(arm);
    expect(q1).toBeDefined();
    const degrees = (2 * Math.acos(Math.min(1, Math.abs(q1?.[3] ?? 1))) * 180) / Math.PI;
    expect(degrees).toBeCloseTo(60, 6);
    // A loop's last frame leads back to the first, so it is not stored twice.
    // Its keys stop short of the duration, the curve closing through the first.
    expect(() => make({ loop: true })).toThrow(/past/);
    const loop = make({ loop: true, keys: [good.keys[0], { ...good.keys[1], t: 0.5 }] });
    expect(loop.frames).toBe(30);
  });

  it("preserves an authored support track only when it names actual keys, supports and primary legs", () => {
    const supportTracks = [
      {
        times: [0, 1],
        supports: [
          { kind: "sole", bone: "foot.L" },
          { kind: "surface", landmark: "knee.R", radius: 0.1 },
        ],
        chains: ["upperleg01.L", "lowerleg01.L", "foot.L"],
        quality: { contactTolerance: 0.015, maxRotationRadians: 0.7, iterations: 24 },
      },
    ];
    expect(make({ supportTracks }).supportTracks).toEqual(supportTracks);
    expect(() => make({ supportTracks: [{ ...supportTracks[0], times: [0.5] }] })).toThrow(
      /authored keys/,
    );
    expect(() =>
      make({
        supportTracks: [
          {
            ...supportTracks[0],
            supports: [{ kind: "sole", bone: "toe2-1.L" }],
          },
        ],
      }),
    ).toThrow(/sole contact/);
    expect(() =>
      make({ supportTracks: [{ ...supportTracks[0], chains: ["upperleg02.L"] }] }),
    ).toThrow(/primary leg bones/);
  });

  it("curves through every key without overshooting a run that only rises", () => {
    const curve = channelCurve([0, 1, 2], [0, 10, 40], null);
    expect(curve(0)).toBeCloseTo(0, 9);
    expect(curve(1)).toBeCloseTo(10, 9);
    expect(curve(2)).toBeCloseTo(40, 9);
    let prev = Number.NEGATIVE_INFINITY;
    for (let t = 0; t <= 2; t += 0.05) {
      const v = curve(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("mirrors a pose across the body's midline", () => {
    const m = mirrorChannels(
      new Map([
        ["upperarm01.L/Xrotation", 10],
        ["upperarm01.L/Yrotation", 20],
        ["spine01/Zrotation", 5],
      ]),
    );
    expect(m.get("upperarm01.R/Xrotation")).toBe(10);
    expect(m.get("upperarm01.R/Yrotation")).toBe(-20);
    expect(m.has("upperarm01.L/Xrotation")).toBe(false);
    expect(m.get("spine01/Zrotation")).toBe(-5);
  });

  it("refuse a file that would pack a broken clip", () => {
    expect(() => make({}, "other.json")).toThrow(/id/);
    expect(() => make({ id: "Bad-Id" }, "Bad-Id.json")).toThrow(/snake_case/);
    expect(() => make({ title: "" })).toThrow(/title/);
    expect(() => make({ description: 3 })).toThrow(/description/);
    expect(() => make({ tags: [] })).toThrow(/tags/);
    expect(() => make({ base: "dab" })).toThrow(/base/);
    expect(() => make({ fps: 24 })).toThrow(/fps/);
    expect(() => make({ duration: 0 })).toThrow(/duration/);
    expect(() => make({ loop: "yes" })).toThrow(/loop/);
    expect(() => make({ supportTracks: [] })).toThrow(/supportTracks/);
    expect(() => make({ keys: [good.keys[0]] })).toThrow(/two keys/);
    expect(() => make({ keys: [{ ...good.keys[0], t: 0.5 }, good.keys[1]] })).toThrow(/time 0/);
    expect(() => make({ keys: [good.keys[0], { ...good.keys[1], t: 2 }] })).toThrow(/past/);
    expect(() => make({ keys: [good.keys[1], good.keys[0]] })).toThrow();
    expect(() => make({ keys: [good.keys[0], { t: 1, mirror: 3 }] })).toThrow(/mirror/);
    expect(() => make({ keys: [good.keys[0], { t: 1, rotations: {}, extra: 1 }] })).toThrow(
      /extra/,
    );
    expect(() =>
      make({ keys: [good.keys[0], { t: 1, rotations: { nope: { Zrotation: 1 } } }] }),
    ).toThrow(/no joint/);
    expect(() =>
      make({
        keys: [
          { t: 0, rotations: { "upperarm01.L": { Zrotation: 0 } } },
          { t: 1, rotations: { "upperarm01.L": { Zrotation: 0 } } },
        ],
      }),
    ).toThrow(/rotates nothing/);
  });
});
