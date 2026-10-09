/**
 * Animation clips (src/animation, packs/animations): the pack's integrity and
 * licence, the sampling and blending of clips, the animator, and how a figure
 * walks: where it is carried, and whether the feet it plants stay planted.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRig } from "../scripts/lib/gltf.ts";
import { ADDITIONAL_ASSETS, encodeClip, PUNKDUCK_CLIPS } from "../scripts/lib/packAnimations.ts";
import { QUATERNIUS_LIBRARIES, retargetTarget } from "../scripts/lib/packQuaternius.ts";
import { retarget } from "../scripts/lib/retarget.ts";
import { readZip } from "../scripts/lib/zip.ts";
import { Animator, DEFAULT_FADE } from "../src/animation/animator.ts";
import { CLEARANCE_TOLERANCE, overlaps } from "../src/animation/clearance.ts";
import {
  blendRotations,
  clipTime,
  parseClip,
  sampleClip,
  setIdentity,
  slerpInto,
} from "../src/animation/clip.ts";
import { FootLock } from "../src/animation/footlock.ts";
import { createAnimationLibrary } from "../src/animation/library.ts";
import { contactPoints, planRootMotion, rootDisplacement } from "../src/animation/locomotion.ts";
import { posedBones } from "../src/rig/bones.ts";
import {
  allFigures,
  assets,
  clip,
  clipBinary,
  entry,
  figure,
  manifest,
  PACK,
  rig,
  stanceDrift,
} from "./animationHarness.ts";

const BONES = rig.bones;

describe("the animation pack", () => {
  it("holds punkduck's clips the packer lists and Quaternius's two libraries' animations, each id once, each with a frame rate and a duration that agree", () => {
    expect(manifest.version).toBe(1);
    const ids = manifest.clips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, PUNKDUCK_CLIPS.length)).toEqual(PUNKDUCK_CLIPS.map((c) => c.id));
    // Each library has 43 animations, one of them the T-pose the retarget goes through.
    expect(manifest.clips.filter((c) => c.tags.includes("ual1"))).toHaveLength(42);
    expect(manifest.clips.filter((c) => c.tags.includes("ual2"))).toHaveLength(42);
    for (const c of manifest.clips) {
      expect(c.fps, c.id).toBe(c.source.author === "punkduck" ? 24 : 30);
      expect(c.frames, c.id).toBeGreaterThan(1);
      expect(c.duration, c.id).toBeCloseTo((c.loop ? c.frames : c.frames - 1) / c.fps, 9);
      expect(c.description, c.id).not.toBe("");
      // A clip that carries the figure stands on the ground.
      if (c.rootMotion) expect(c.loop, c.id).toBe(true);
    }
    for (const id of ["walk_loop", "jog_fwd_loop", "idle_loop", "swim_fwd_loop", "sprint_loop"])
      expect(ids, id).toContain(id);
    expect(entry("swim_fwd_loop").grounded).toBe(false);
    expect(entry("walk_loop")).toMatchObject({ rootMotion: true, grounded: true, loop: true });
  });

  it("is what its manifest and provenance say: each binary's hash, bones the rig has, pinned archives, CC0 by each source's own file", () => {
    const provenance = fs.readFileSync(path.join(PACK, "PROVENANCE.md"), "utf8");
    expect(provenance).toContain(ADDITIONAL_ASSETS.sha256);
    for (const l of QUATERNIUS_LIBRARIES) expect(provenance, l.archive).toContain(l.sha256);
    for (const c of manifest.clips) {
      const bytes = fs.readFileSync(path.join(PACK, c.file));
      expect(createHash("sha256").update(bytes).digest("hex"), c.id).toBe(c.sha256);
      expect(provenance, c.id).toContain(c.sha256);
      for (const b of c.bones) expect(BONES, `${c.id}: ${b}`).toContain(b);
      expect(new Set(c.bones).size, c.id).toBe(c.bones.length);
      if (c.source.author === "punkduck") {
        expect(c.source.archiveSha256, c.id).toBe(ADDITIONAL_ASSETS.sha256);
        expect(c.source.licence, c.id).toBe("CC0");
        expect(provenance, c.id).toMatch(new RegExp(`- ${c.id}: clause B`));
      } else {
        const lib = QUATERNIUS_LIBRARIES.find((l) => l.archive === c.source.archive);
        expect(lib, c.id).toBeDefined();
        expect(c.source.archiveSha256, c.id).toBe(lib?.sha256);
        expect(c.source.author, c.id).toBe("Quaternius");
        expect(c.source.licence, c.id).toMatch(/^CC0 1\.0 Universal/);
      }
    }
    expect(provenance).toMatch(/walk\.bvh.*zombie\.bvh.*AGPL3.*not used/s);
    expect(provenance).toMatch(/2026-08-28/);
  });

  it("decodes every clip to unit quaternions, each bone in one hemisphere from frame to frame", () => {
    for (const c of manifest.clips) {
      const k = clip(c.id);
      const n = k.boneIndex.length;
      expect(k.rotations.length, c.id).toBe(k.frames * n * 4);
      for (let i = 0; i < k.frames * n; i++) {
        const q = k.rotations.subarray(i * 4, i * 4 + 4);
        expect(
          Math.hypot(q[0] as number, q[1] as number, q[2] as number, q[3] as number),
          c.id,
        ).toBeCloseTo(1, 5);
        if (i >= n) {
          const p = k.rotations.subarray((i - n) * 4, (i - n) * 4 + 4);
          const dot =
            (p[0] as number) * (q[0] as number) +
            (p[1] as number) * (q[1] as number) +
            (p[2] as number) * (q[2] as number) +
            (p[3] as number) * (q[3] as number);
          expect(dot, `${c.id} frame ${Math.floor(i / n)} bone ${i % n}`).toBeGreaterThan(-1e-6);
        }
      }
      expect(
        Array.from(k.boneIndex).every((b) => b >= 0),
        c.id,
      ).toBe(true);
    }
  });

  it("loops without a jump: the step from the last frame to the first is no larger than any other", () => {
    for (const spec of PUNKDUCK_CLIPS.filter((s) => s.loop)) {
      const k = clip(spec.id);
      const q = new Float32Array(BONES.length * 4);
      const p = new Float32Array(BONES.length * 4);
      const step = (a: number, b: number) => {
        sampleClip(k, a / k.fps, q);
        sampleClip(k, b / k.fps, p);
        let sum = 0;
        for (let i = 0; i < q.length; i += 4) {
          const dot = Math.abs(
            (q[i] as number) * (p[i] as number) +
              (q[i + 1] as number) * (p[i + 1] as number) +
              (q[i + 2] as number) * (p[i + 2] as number) +
              (q[i + 3] as number) * (p[i + 3] as number),
          );
          sum += 2 * Math.acos(Math.min(1, dot));
        }
        return sum;
      };
      const steps = Array.from({ length: k.frames - 1 }, (_, i) => step(i, i + 1)).sort(
        (a, b) => a - b,
      );
      const median = steps[Math.floor(steps.length / 2)] as number;
      expect(step(k.frames - 1, k.frames), spec.id).toBeLessThan(2 * median);
    }
  });

  it("refuses a binary of the wrong length, and a manifest of another version", async () => {
    const e = entry("walk_normal");
    expect(() => parseClip(e, BONES, new ArrayBuffer(12))).toThrow(/bytes for 24 frames/);
    const library = createAnimationLibrary(manifest, async () => new ArrayBuffer(0));
    await expect(library.load("walk_normal", BONES)).rejects.toThrow(/bytes for 24 frames/);
    await expect(library.load("nope", BONES)).rejects.toThrow(/no animation clip nope/);
  });

  it("fetches a clip once however many figures play it, and forgets a failed fetch", async () => {
    let fetched = 0;
    let fail = true;
    const library = createAnimationLibrary(manifest, async (e) => {
      fetched++;
      if (fail) throw new Error("offline");
      return clipBinary(e);
    });
    await expect(library.load("idle1", BONES)).rejects.toThrow(/offline/);
    fail = false;
    const [a, b] = await Promise.all([library.load("idle1", BONES), library.load("idle1", BONES)]);
    expect(a).toBe(b);
    expect(library.loaded("idle1", BONES)).toBe(a);
    expect(library.loaded("idle1", [...BONES])).toBeUndefined();
    expect(fetched).toBe(2);
    expect(library.entry("idle1")?.title).toBe("Idle");
  });
});

describe("encoding a BVH", () => {
  const bvh = (frames: string[]) =>
    [
      "HIERARCHY",
      "ROOT root",
      "{",
      " OFFSET 0 0 0",
      " CHANNELS 6 Xposition Yposition Zposition Xrotation Yrotation Zrotation",
      " JOINT spine05",
      " {",
      "  OFFSET 0 0 1",
      "  CHANNELS 3 Xrotation Yrotation Zrotation",
      "  End Site",
      "  {",
      "   OFFSET 0 0 1",
      "  }",
      " }",
      "}",
      "MOTION",
      `Frames: ${frames.length}`,
      "Frame Time: 0.041667",
      ...frames,
    ].join("\n");

  it("keeps the bones that ever turn, in the rig's order and the figure's axes, as unit quaternions", () => {
    const e = encodeClip(
      BONES,
      bvh(["0 0 0 0 0 0 0 0 0", "0 0 0 0 0 90 30 0 0", "0 0 0 0 0 0 0 0 0"]),
    );
    expect(e.frames).toBe(3);
    expect(e.fps).toBe(24);
    // The root turns about BVH's Z (up), which is the figure's Y; the spine about its X.
    expect(e.bones).toEqual(
      ["root", "spine05"].sort((a, b) => BONES.indexOf(a) - BONES.indexOf(b)),
    );
    const r = e.bones.indexOf("root");
    const q = e.rotations.subarray((1 * e.bones.length + r) * 4, (1 * e.bones.length + r) * 4 + 4);
    expect(q[1]).toBeCloseTo(Math.sin(Math.PI / 4), 5);
    expect(q[3]).toBeCloseTo(Math.cos(Math.PI / 4), 5);
  });

  it("leaves a bone that never turns out, and refuses a joint the rig lacks", () => {
    expect(encodeClip(BONES, bvh(["0 0 0 0 0 0 0 0 0", "0 0 0 0 0 0 0 0 0"])).bones).toEqual([]);
    expect(() =>
      encodeClip(BONES, bvh(["0 0 0 0 0 0 0 0 0"]).replace("JOINT spine05", "JOINT nope")),
    ).toThrow(/joints the rig lacks: nope/);
  });

  it("flips a quaternion that wandered into the other hemisphere, so a slerp takes the short way", () => {
    // 350° and 10° about Y are 20° apart, and the first quaternion's w is negative.
    const e = encodeClip(BONES, bvh(["0 0 0 0 350 0 0 0 0", "0 0 0 0 10 0 0 0 0"]));
    const n = e.bones.length;
    const dot =
      (e.rotations[0] as number) * (e.rotations[n * 4] as number) +
      (e.rotations[1] as number) * (e.rotations[n * 4 + 1] as number) +
      (e.rotations[2] as number) * (e.rotations[n * 4 + 2] as number) +
      (e.rotations[3] as number) * (e.rotations[n * 4 + 3] as number);
    expect(dot).toBeGreaterThan(0.98);
  });
});

describe("sampling and blending", () => {
  const walk = clip("walk_normal");
  const out = () => new Float32Array(BONES.length * 4);

  it("is the stored frame at a frame's time, and the shortest-arc blend of two between", () => {
    const a = sampleClip(walk, 5 / walk.fps, out());
    const n = walk.boneIndex.length;
    for (let k = 0; k < n; k++) {
      const b = walk.boneIndex[k] as number;
      for (let c = 0; c < 4; c++)
        expect(a[b * 4 + c], `bone ${b}`).toBeCloseTo(
          walk.rotations[(5 * n + k) * 4 + c] as number,
          6,
        );
    }
    const mid = sampleClip(walk, 5.5 / walk.fps, out());
    const p = sampleClip(walk, 5 / walk.fps, out());
    const q = sampleClip(walk, 6 / walk.fps, out());
    const want = out();
    for (let i = 0; i < want.length; i += 4) slerpInto(want, i, p, i, q, i, 0.5);
    for (let i = 0; i < want.length; i++) expect(mid[i], `${i}`).toBeCloseTo(want[i] as number, 6);
  });

  it("wraps a loop, the last frame leading into the first, and holds a clip that does not loop", () => {
    expect(clipTime(walk, walk.duration + 0.25)).toBeCloseTo(0.25, 9);
    expect(clipTime(walk, -0.25)).toBeCloseTo(walk.duration - 0.25, 9);
    const wrapped = sampleClip(walk, walk.duration, out());
    const first = sampleClip(walk, 0, out());
    for (let i = 0; i < first.length; i++)
      expect(wrapped[i], `${i}`).toBeCloseTo(first[i] as number, 6);
    const stopping = { ...walk, loop: false, duration: (walk.frames - 1) / walk.fps };
    expect(clipTime(stopping, 99)).toBeCloseTo(stopping.duration, 9);
    expect(clipTime(stopping, -1)).toBe(0);
    const end = sampleClip(stopping, 99, out());
    const last = sampleClip(stopping, stopping.duration, out());
    for (let i = 0; i < end.length; i++) expect(end[i], `${i}`).toBeCloseTo(last[i] as number, 6);
  });

  it("leaves every bone the clip does not move at no rotation", () => {
    const a = sampleClip(walk, 0.4, out());
    const moved = new Set(walk.boneIndex);
    for (let b = 0; b < BONES.length; b++) {
      if (moved.has(b)) continue;
      expect(Array.from(a.subarray(b * 4, b * 4 + 4)), BONES[b]).toEqual([0, 0, 0, 1]);
    }
  });

  it("blends by weight along the shortest arc: the ends are the ends, and q and -q are one rotation", () => {
    const a = sampleClip(walk, 0.1, out());
    const b = sampleClip(walk, 0.6, out());
    expect(blendRotations(a, b, 0)).toEqual(a);
    expect(blendRotations(a, b, 1)).toEqual(b);
    const flipped = b.map((x) => -x);
    const m1 = blendRotations(a, b, 0.3);
    const m2 = blendRotations(a, flipped, 0.3);
    for (let i = 0; i < m1.length; i++) expect(m2[i], `${i}`).toBeCloseTo(m1[i] as number, 5);
    for (let i = 0; i < m1.length; i += 4)
      expect(
        Math.hypot(m1[i] as number, m1[i + 1] as number, m1[i + 2] as number, m1[i + 3] as number),
      ).toBeCloseTo(1, 5);
    // In place, as the animator does it.
    const inPlace = new Float32Array(a);
    blendRotations(inPlace, b, 0.3, inPlace);
    for (let i = 0; i < m1.length; i++) expect(inPlace[i], `${i}`).toBeCloseTo(m1[i] as number, 6);
    expect(setIdentity(new Float32Array(8))).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]));
  });
});

describe("the animator", () => {
  it("plays a clip at its speed, and a figure with no skeleton is not carried", () => {
    const walk = clip("walk_normal");
    const an = new Animator(BONES.length);
    an.play(walk, { speed: 2 });
    an.update(0.25);
    expect(an.playing?.time).toBeCloseTo(0.5, 9);
    expect(an.root).toEqual([0, 0]);
    const want = sampleClip(walk, 0.5, new Float32Array(BONES.length * 4));
    expect(Array.from(an.rotations)).toEqual(Array.from(want));
    an.setSpeed(0);
    an.update(1);
    expect(an.playing?.time).toBeCloseTo(0.5, 9);
  });

  it("fades one clip into the next over the time asked, ending on the next exactly", () => {
    const an = new Animator(BONES.length);
    an.play(clip("idle1"));
    an.update(0.5);
    an.play(clip("walk_normal"), { fade: 0.4 });
    expect(an.fading).toBe(true);
    const before = an.rotations.slice();
    an.update(0.2);
    // Half way: neither clip's pose.
    const walkPose = sampleClip(clip("walk_normal"), 0.2, new Float32Array(BONES.length * 4));
    expect(Array.from(an.rotations)).not.toEqual(Array.from(walkPose));
    expect(Array.from(an.rotations)).not.toEqual(Array.from(before));
    an.update(0.25);
    expect(an.fading).toBe(false);
    const done = sampleClip(
      clip("walk_normal"),
      an.playing?.time as number,
      new Float32Array(BONES.length * 4),
    );
    for (let i = 0; i < done.length; i++)
      expect(an.rotations[i], `${i}`).toBeCloseTo(done[i] as number, 6);
    expect(DEFAULT_FADE).toBeGreaterThan(0);
  });

  it("carries a figure along only by a clip that carries it, forward, and by what its own feet do", () => {
    for (const fig of [figure("average", 25), figure("average", 6)]) {
      const an = new Animator(BONES.length, fig.rest, fig.ground);
      an.play(clip("idle1"));
      for (let i = 0; i < 120; i++) an.update(1 / 60);
      expect(an.root, `${fig.name} idling`).toEqual([0, 0]);
      an.play(clip("walk_normal"), { fade: 0 });
      an.resetRoot();
      const walk = clip("walk_normal");
      const cycles = 3;
      for (let i = 0; i < Math.round(cycles * walk.duration * 60); i++) an.update(1 / 60);
      const stride = an.root[1] / cycles;
      // Forward (the figure faces +Z), not sideways, and a stride its legs could make.
      expect(Math.abs(an.root[0] / cycles), fig.name).toBeLessThan(0.02);
      expect(stride, fig.name).toBeGreaterThan(0.2);
      const legs = Math.abs(
        (fig.rest.heads[fig.rest.names.indexOf("foot.L") * 3 + 1] as number) -
          (fig.rest.heads[fig.rest.names.indexOf("upperleg01.L") * 3 + 1] as number),
      );
      expect(stride, fig.name).toBeLessThan(2 * legs);
    }
  });

  it("walks a child's shorter stride and an adult's longer, whatever the clip: the stride follows the legs", () => {
    const strides = [6, 25].map((age) => {
      const fig = figure("average", age);
      return planRootMotion(fig.rest, clip("walk_normal"), fig.ground).cycle[1];
    });
    expect(strides[0] as number).toBeLessThan(0.6 * (strides[1] as number));
    expect(strides[0] as number).toBeGreaterThan(0.3 * (strides[1] as number));
  });

  it("sums a plan over any stretch of time, forwards or back, around the loop", () => {
    const fig = figure("average", 25);
    const walk = clip("walk_normal");
    const plan = planRootMotion(fig.rest, walk, fig.ground);
    const whole = rootDisplacement(plan, 0.3, walk.duration);
    expect(whole[0]).toBeCloseTo(plan.cycle[0], 5);
    expect(whole[1]).toBeCloseTo(plan.cycle[1], 5);
    const a = rootDisplacement(plan, 0.1, 0.37);
    const b = rootDisplacement(plan, 0.47, walk.duration - 0.37);
    expect(a[1] + b[1]).toBeCloseTo(plan.cycle[1], 5);
    const back = rootDisplacement(plan, 0.47, -0.37);
    expect(back[1]).toBeCloseTo(-a[1], 5);
    expect(rootDisplacement(plan, 0.1, 0)).toEqual([0, 0]);
    expect(rootDisplacement(plan, 0.1, 3 * walk.duration)[1]).toBeCloseTo(3 * plan.cycle[1], 4);
  });
});

describe("a walking figure's feet", () => {
  // `stanceDrift`: how far a planted heel or ball moves in the world while it is on the ground.
  it("stay put on every body and age: a planted foot of the walk moves under 15 mm, over nine figures", () => {
    const drifts = allFigures().map((fig) => ({
      fig: fig.name,
      ...stanceDrift(fig, clip("walk_normal")),
    }));
    for (const d of drifts) {
      expect(d.stances, d.fig).toBeGreaterThanOrEqual(8);
      expect(d.worst, `${d.fig}: ${(d.worst * 1000).toFixed(1)} mm`).toBeLessThan(0.015);
    }
    const sorted = drifts.map((d) => d.worst).sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)] as number, "median").toBeLessThan(0.008);
  });

  it("stay put to a few centimetres in the hip-swaying walk, whose hand-keyed feet do not agree with their own body's pace", () => {
    for (const fig of allFigures()) {
      const d = stanceDrift(fig, clip("walk_female"));
      expect(d.worst, `${fig.name}: ${(d.worst * 1000).toFixed(1)} mm`).toBeLessThan(0.035);
    }
  });

  it("stay put in Quaternius's walks, mocap that plants its feet: 3 mm, over nine figures", () => {
    for (const id of ["walk_loop", "walk_formal_loop", "walk_carry_loop"]) {
      for (const fig of allFigures()) {
        const d = stanceDrift(fig, clip(id));
        expect(d.stances, `${id} on ${fig.name}`).toBeGreaterThanOrEqual(8);
        expect(d.worst, `${id} on ${fig.name}: ${(d.worst * 1000).toFixed(1)} mm`).toBeLessThan(
          0.008,
        );
      }
    }
  });

  it("stay put to a few centimetres in the gaits that shuffle: a crouch walk and a zombie's drag their feet", () => {
    const limit: Record<string, number> = { crouch_fwd_loop: 0.05, zombie_walk_fwd_loop: 0.08 };
    for (const [id, bound] of Object.entries(limit))
      for (const fig of allFigures()) {
        const d = stanceDrift(fig, clip(id));
        expect(d.worst, `${id} on ${fig.name}: ${(d.worst * 1000).toFixed(1)} mm`).toBeLessThan(
          bound,
        );
      }
  });

  it("slide without the lock: the same walk, root motion only, skates far further", () => {
    const fig = figure("average", 25);
    const locked = stanceDrift(fig, clip("walk_normal"));
    const free = stanceDrift(fig, { ...clip("walk_normal"), grounded: false });
    expect(free.worst).toBeGreaterThan(2 * locked.worst);
    expect(free.worst).toBeGreaterThan(0.02);
  });

  it("do not move in an idle, which carries nobody: the lock holds them where they stand", () => {
    for (const id of ["idle1", "idle2", "idlehips"]) {
      for (const fig of [figure("average", 25), figure("heavy", 75), figure("slim", 6)]) {
        const d = stanceDrift(fig, clip(id), 3);
        expect(d.worst, `${id} ${fig.name}: ${(d.worst * 1000).toFixed(1)} mm`).toBeLessThan(0.01);
      }
    }
  });
});

/**
 * The clips in which the body touches itself or rests on the ground, with the deepest
 * overlap of the coarse capsules, metres, on any of the nine figures (to the next
 * centimetre and one more): sitting and kneeling with the hands on the thighs, a roll,
 * a landing, a sword's swing across the body. A capsule is a coarse stand-in for a
 * limb, so these are bounds to hold the clips to, not collisions to fix.
 */
const CONTACT_CLIPS: Record<string, number> = {
  death01: 0.047,
  fixing_kneeling: 0.114,
  jump_land: 0.103,
  pistol_aim_down: 0.097,
  roll: 0.097,
  sitting_enter: 0.097,
  sitting_exit: 0.11,
  sitting_idle_loop: 0.064,
  climb_up_1m: 0.058,
  idle_fold_arms_loop: 0.063,
  ninja_jump_land: 0.107,
  slide_exit: 0.127,
  sword_dash: 0.078,
  sword_heavy_combo: 0.061,
  sword_regular_a: 0.093,
  sword_regular_c: 0.079,
  sword_regular_combo: 0.093,
  zombie_scratch: 0.088,
};

describe("clearance: no part of the body through another", () => {
  const q = () => new Float32Array(BONES.length * 4);

  it("measures a capsule per part from the figure's own skin: plausible radii, larger on the heavy body than the slim", () => {
    const slim = figure("slim", 25).segments;
    const heavy = figure("heavy", 25).segments;
    expect(slim).toHaveLength(14);
    const r = (segs: typeof slim, id: string) => segs.find((x) => x.id === id)?.radius as number;
    expect(r(slim, "torso")).toBeGreaterThan(0.07);
    expect(r(slim, "torso")).toBeLessThan(0.16);
    expect(r(slim, "thigh.L")).toBeGreaterThan(0.045);
    expect(r(slim, "thigh.L")).toBeLessThan(0.1);
    expect(r(heavy, "thigh.L")).toBeGreaterThan(r(slim, "thigh.L"));
    expect(r(figure("average", 6).segments, "thigh.L")).toBeLessThan(
      r(figure("average", 25).segments, "thigh.L"),
    );
  });

  it("finds legs crossed through each other, and finds nothing in the rest pose", () => {
    const fig = figure("average", 25);
    const r = setIdentity(q());
    const turn = (bone: string, axis: 0 | 1 | 2, degrees: number) => {
      const half = (degrees * Math.PI) / 360;
      const v = [0, 0, 0, Math.cos(half)];
      v[axis] = Math.sin(half);
      r.set(v, BONES.indexOf(bone) * 4);
    };
    // Both thighs swung 25 degrees across the midline: the shins pass through one another.
    turn("upperleg01.L", 2, -25);
    turn("upperleg01.R", 2, 25);
    const hit = overlaps(fig.rest, fig.segments, r).sort((a, b) => b.depth - a.depth)[0];
    expect(hit?.depth, `${hit?.a} ${hit?.b}`).toBeGreaterThan(CLEARANCE_TOLERANCE);
    expect([hit?.a, hit?.b].sort().join(" ")).toMatch(/shin|foot/);
    for (const o of overlaps(fig.rest, fig.segments, setIdentity(q())))
      expect(o.depth, `${o.a} ${o.b}`).toBeLessThan(0);
  });

  it("holds in every frame of every clip on nine figures: no part is through another by more than the capsules' tolerance, but in the clips where the body touches itself", () => {
    for (const c of manifest.clips) {
      const k = clip(c.id);
      const allowed = CONTACT_CLIPS[c.id] ?? CLEARANCE_TOLERANCE;
      for (const fig of allFigures()) {
        const r = q();
        let worst = { depth: Number.NEGATIVE_INFINITY, pair: "", frame: 0 };
        for (let f = 0; f < k.frames; f++) {
          sampleClip(k, f / k.fps, r);
          for (const o of overlaps(fig.rest, fig.segments, r))
            if (o.depth > worst.depth) worst = { depth: o.depth, pair: `${o.a} ${o.b}`, frame: f };
        }
        expect(
          worst.depth,
          `${c.id} on ${fig.name}: ${worst.pair} at frame ${worst.frame}`,
        ).toBeLessThan(allowed);
      }
    }
  });

  it("is clean in every walk, idle, jog, sprint and swim: only the clips where a limb rests on or crosses the body overlap it", () => {
    // 72 of the 90 clips (every locomotion and standing idle among them) stay within the tolerance.
    const touching = Object.keys(CONTACT_CLIPS);
    expect(touching).toHaveLength(18);
    for (const c of manifest.clips)
      if (/walk|jog|sprint|^idle|swim|crouch/i.test(c.id) && !/fold_arms/.test(c.id))
        expect(touching, c.id).not.toContain(c.id);
  });
});

describe("the retarget", () => {
  const vendored = path.join(
    process.env.HOME ?? "",
    "src/reference-codebases/vendored-cc0/quaternius",
  );
  const have = QUATERNIUS_LIBRARIES.every((l) => fs.existsSync(path.join(vendored, l.archive)));

  // The libraries' own T-pose, put through the retarget, is the target's own: every bone, mapped or not.
  it.skipIf(!have)("takes a source in its T-pose to the target in its own", () => {
    const lib = QUATERNIUS_LIBRARIES[0] as (typeof QUATERNIUS_LIBRARIES)[number];
    const zip = readZip(fs.readFileSync(path.join(vendored, lib.archive)));
    const rig = readRig(zip.read(lib.glb));
    const tpose = rig.animations.find((a) => a.name === "A_TPose");
    if (!tpose) throw new Error("no A_TPose");
    const target = retargetTarget(path.resolve(import.meta.dirname, "../packs/body/data"));
    const r = retarget(rig, tpose, tpose, target, 30);
    for (const f of [0, 20, 60]) {
      for (let b = 0; b < target.bones.length; b++) {
        const got = r.rotations.subarray(
          (f * target.bones.length + b) * 4,
          (f * target.bones.length + b) * 4 + 4,
        );
        const want = target.tpose.subarray(b * 4, b * 4 + 4);
        const dot = Math.abs(
          [0, 1, 2, 3].reduce((sum, c) => sum + (got[c] as number) * (want[c] as number), 0),
        );
        expect(dot, `${target.bones[b]} at frame ${f}`).toBeGreaterThan(0.99999);
      }
    }
  });
});

describe("clearance under the foot lock", () => {
  it("holds with the legs turned to keep the feet planted: no leg through the other, on nine figures", () => {
    for (const id of ["walk_normal", "walk_female"]) {
      for (const fig of allFigures()) {
        const an = new Animator(BONES.length, fig.rest, fig.ground);
        an.play(clip(id));
        let worst = Number.NEGATIVE_INFINITY;
        let pair = "";
        for (let i = 0; i < 180; i++) {
          an.update(1 / 60);
          if (i < 60) continue;
          for (const o of overlaps(fig.rest, fig.segments, an.rotations))
            if (o.depth > worst) {
              worst = o.depth;
              pair = `${o.a} ${o.b}`;
            }
        }
        expect(worst, `${id} on ${fig.name}: ${pair}`).toBeLessThan(CLEARANCE_TOLERANCE);
      }
    }
  });
});

describe("the foot lock", () => {
  const fig = figure("average", 25);
  const pose = () => sampleClip(clip("idle1"), 0, new Float32Array(BONES.length * 4));
  const world = (rotations: Float32Array, root: number) => {
    const buf = new Float32Array(18);
    contactPoints(fig.rest, rotations, fig.ground, buf);
    return Array.from({ length: 6 }, (_, k) => [
      buf[k * 3] as number,
      (buf[k * 3 + 2] as number) + root,
    ]);
  };

  it("holds a planted foot where it is while the figure is carried past it, turning the leg and keeping the foot's orientation", () => {
    const lock = new FootLock(fig.rest, fig.ground);
    const first = pose();
    lock.apply(first, [0, 0]);
    const start = world(first, 0);
    const before = posedBones(fig.rest, first).world;
    // Carried forward 2 cm: the legs must give 2 cm back to keep the soles where they were.
    const second = pose();
    lock.apply(second, [0, 0.02]);
    const moved = world(second, 0.02);
    for (let k = 0; k < 6; k++) {
      expect(
        Math.hypot(
          (moved[k]?.[0] as number) - (start[k]?.[0] as number),
          (moved[k]?.[1] as number) - (start[k]?.[1] as number),
        ),
        `point ${k}`,
      ).toBeLessThan(0.0015);
    }
    // Without the lock the same pose is carried 2 cm: the soles go with it.
    const free = world(pose(), 0.02);
    expect((free[3]?.[1] as number) - (start[3]?.[1] as number)).toBeCloseTo(0.02, 3);
    // The feet themselves keep their orientation: only the leg turned.
    const after = posedBones(fig.rest, second).world;
    for (const side of ["L", "R"]) {
      const f = BONES.indexOf(`foot.${side}`);
      const dot = Math.abs(
        [0, 1, 2, 3].reduce(
          (sum, c) => sum + (before[f * 4 + c] as number) * (after[f * 4 + c] as number),
          0,
        ),
      );
      expect(dot, side).toBeGreaterThan(0.99999);
    }
  });

  it("touches nothing else: the arms, the spine, every bone but the legs' are as the clip had them", () => {
    const lock = new FootLock(fig.rest, fig.ground);
    const a = pose();
    const b = pose();
    lock.apply(a, [0, 0]);
    lock.apply(b, [0, 0.02]);
    const legs = new Set(
      ["upperleg01", "lowerleg01", "foot"]
        .flatMap((n) => [`${n}.L`, `${n}.R`])
        .map((n) => BONES.indexOf(n)),
    );
    const clean = pose();
    for (let bone = 0; bone < BONES.length; bone++) {
      if (legs.has(bone)) continue;
      expect(Array.from(b.subarray(bone * 4, bone * 4 + 4)), BONES[bone]).toEqual(
        Array.from(clean.subarray(bone * 4, bone * 4 + 4)),
      );
    }
  });
});

describe("the rig the clips are on", () => {
  it("is the body pack's skeleton, every clip bone a bone of it", () => {
    expect(BONES.length).toBe(assets.manifest.skeleton.bones.length);
  });
});
