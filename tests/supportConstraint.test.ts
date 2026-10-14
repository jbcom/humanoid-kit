/** Internal negative controls for exact-key authored support alignment. */
import { describe, expect, it } from "vitest";
import { sampleClip } from "../src/animation/clip.ts";
import { SupportConstraint } from "../src/animation/supportConstraint.ts";
import { clip, rig } from "./animationHarness.ts";
import { drillSupport } from "./drillHarness.ts";

const bones = rig.bones.length;
const sourceAt = (id: string, time: number) =>
  sampleClip(clip(id), time, new Float32Array(bones * 4));

describe("authored support constraint", () => {
  it("uses only the declared leg chain and respects its authored rotation budget", () => {
    const kneel = clip("kneel_pray");
    const tracks = kneel.supportTracks;
    if (!tracks) throw new Error("kneel_pray has no authored support track");
    const source = sourceAt("kneel_pray", kneel.duration);
    const out = new Float32Array(source.length);
    const figure = drillSupport({ age: 25, gender: 0.5 });
    const track = tracks[0];
    if (!track) throw new Error("kneel_pray has no first authored support track");

    expect(new SupportConstraint(figure).apply(kneel, kneel.duration, source, out)).toMatchObject({
      state: "satisfied",
    });
    const allowed = new Set(track.chains.map((name) => figure.restBones.names.indexOf(name)));
    for (let bone = 0; bone < figure.restBones.names.length; bone++) {
      const at = bone * 4;
      if (!allowed.has(bone)) {
        expect(Array.from(out.subarray(at, at + 4))).toEqual(
          Array.from(source.subarray(at, at + 4)),
        );
        continue;
      }
      const dot = Math.min(
        1,
        Math.abs(
          (source[at] as number) * (out[at] as number) +
            (source[at + 1] as number) * (out[at + 1] as number) +
            (source[at + 2] as number) * (out[at + 2] as number) +
            (source[at + 3] as number) * (out[at + 3] as number),
        ),
      );
      expect(2 * Math.acos(dot)).toBeLessThanOrEqual(track.quality.maxRotationRadians + 1e-5);
    }
  });

  it("keeps clips without an exact support key byte-identical", () => {
    const source = sourceAt("walk_normal", 0.2);
    const out = new Float32Array(source.length);
    const constraint = new SupportConstraint(drillSupport({ age: 25, gender: 0.5 }));

    expect(constraint.apply(clip("walk_normal"), 0.2, source, out)).toMatchObject({
      state: "idle",
    });
    expect(out).toEqual(source);
  });

  it("leaves the source sample untouched when its legal rotation budget cannot reach support", () => {
    const kneel = clip("kneel_pray");
    const tracks = kneel.supportTracks;
    if (!tracks) throw new Error("kneel_pray has no authored support track");
    const source = sourceAt("kneel_pray", kneel.duration);
    const out = new Float32Array(source.length);
    const constrained = {
      ...kneel,
      supportTracks: tracks.map((track) => ({
        ...track,
        quality: { ...track.quality, maxRotationRadians: 0.000001 },
      })),
    };
    const constraint = new SupportConstraint(drillSupport({ age: 25, gender: 0.5 }));

    expect(constraint.apply(constrained, kneel.duration, source, out)).toMatchObject({
      state: "unreachable",
      clip: "kneel_pray",
      tolerance: 0.015,
    });
    expect(out).toEqual(source);
  });
});
