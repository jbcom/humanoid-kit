/**
 * Quaternius's Universal Animation Libraries 1 and 2 (CC0 by the `License.txt`
 * in each archive), retargeted onto MakeHuman's default skeleton through a T-pose
 * on both rigs (`retarget.ts`), as clips of the animations pack.
 *
 * Only the copies vendored with their SHA-256 are used
 * (`~/src/reference-codebases/vendored-cc0/quaternius`, pinned below): Quaternius
 * moved later releases to a licence that is not CC0, on 2026-08-28, and these
 * were downloaded before. The in-place variants (not `_RM`) are used: where a clip
 * carries a figure is derived from the figure's feet, not authored.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type BodyManifest, jointPosition } from "../../src/format/assetFormat.ts";
import { frameRotations } from "../../src/rig/pose.ts";
import { readRig } from "./gltf.ts";
import { readBody } from "./packHair.ts";
import { type RetargetTarget, retarget } from "./retarget.ts";
import { readZip } from "./zip.ts";

/** One library of the archives, pinned. */
export interface QuaterniusLibrary {
  /** What its clips' ids and tags call it. */
  id: "ual1" | "ual2";
  title: string;
  archive: string;
  sha256: string;
  /** The in-place glb inside it. */
  glb: string;
  licenceFile: string;
}

export const QUATERNIUS_LIBRARIES: readonly QuaterniusLibrary[] = [
  {
    id: "ual1",
    title: "Universal Animation Library",
    archive: "Universal Animation Library[Standard].zip",
    sha256: "cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724",
    glb: "Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb",
    licenceFile: "Universal Animation Library[Standard]/License.txt",
  },
  {
    id: "ual2",
    title: "Universal Animation Library 2",
    archive: "Universal Animation Library 2[Standard].zip",
    sha256: "4008ea208a604773a2b2177d965f0f5d3195498b5bf838c3f5785d68e95f2a68",
    glb: "Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb",
    licenceFile: "Universal Animation Library 2[Standard]/License.txt",
  },
];

/** Frames per second of the libraries' animations. */
const FPS = 30;

/** The animation holding the libraries' rest as a T-pose. */
const TPOSE_ANIMATION = "A_TPose";

/** Clips whose figure is not standing on the ground, so its feet are not held. */
const AIRBORNE = /Swim|Jump|Roll|Sitting|LayToIdle|Death|Climb|Slide|Driving|Sprint|Jog/i;
/** Clips that carry the figure. */
const CARRIES = /^(Walk|Jog|Sprint|Crouch_Fwd|Zombie_Walk)/i;

/** The target rig the retarget fills: the body pack's skeleton at the default figure, and its T-pose. */
export function retargetTarget(bodyDir: string): RetargetTarget {
  const { manifest, assets } = readBody(bodyDir);
  const bones = (manifest as BodyManifest).skeleton.bones;
  const names = bones.map((b) => b.name);
  const index = new Map(names.map((n, i) => [n, i]));
  const parents = Int16Array.from(bones, (b) =>
    b.parent === null ? -1 : (index.get(b.parent) ?? -1),
  );
  const heads = new Float32Array(bones.length * 3);
  bones.forEach((b, i) => {
    jointPosition(assets, assets.positions, b.head, heads, i * 3);
  });
  const pose = (manifest as BodyManifest).poses.find((p) => p.name === "tpose");
  if (!pose) throw new Error("the body pack has no tpose");
  const tpose = new Float32Array(bones.length * 4);
  for (let b = 0; b < bones.length; b++) tpose[b * 4 + 3] = 1;
  for (const [b, q] of frameRotations({ bones: names }, pose.joints, pose.frame))
    tpose.set(q, b * 4);
  return { bones: names, parents, heads, tpose };
}

export interface QuaterniusClip {
  id: string;
  title: string;
  description: string;
  tags: string[];
  fps: number;
  loop: boolean;
  rootMotion: boolean;
  grounded: boolean;
  /** `frames × bones × 4` local rotations of every bone of the target. */
  frames: number;
  rotations: Float32Array;
  source: { archive: string; archiveSha256: string; file: string; author: string; licence: string };
  /** The licence evidence for PROVENANCE. */
  evidence: string;
}

const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** How far the last frame is from the first, against a typical step: a clip whose last frame repeats its first is near 0. */
function seam(
  rot: Float32Array,
  frames: number,
  bones: number,
): { first: number; typical: number } {
  const dist = (a: number, b: number) => {
    let sum = 0;
    for (let k = 0; k < bones; k++) {
      let dot = 0;
      for (let c = 0; c < 4; c++)
        dot += (rot[(a * bones + k) * 4 + c] as number) * (rot[(b * bones + k) * 4 + c] as number);
      sum += 2 * Math.acos(Math.min(1, Math.abs(dot)));
    }
    return (sum * 180) / Math.PI;
  };
  const steps = Array.from({ length: frames - 1 }, (_, i) => dist(i, i + 1)).sort((x, y) => x - y);
  return { first: dist(frames - 1, 0), typical: steps[Math.floor(steps.length / 2)] ?? 0 };
}

/**
 * Every animation of the vendored libraries (but the T-pose), retargeted to `target`.
 * Throws if an archive is not the pinned one or its licence file does not say CC0.
 */
export function quaterniusClips(dir: string, target: RetargetTarget): QuaterniusClip[] {
  const out: QuaterniusClip[] = [];
  for (const lib of QUATERNIUS_LIBRARIES) {
    const file = fs.readFileSync(path.join(dir, lib.archive));
    const hash = createHash("sha256").update(file).digest("hex");
    if (hash !== lib.sha256)
      throw new Error(`${lib.archive} is ${hash}, not the pinned ${lib.sha256}`);
    const zip = readZip(file);
    const licence = zip.read(lib.licenceFile).toString("utf8");
    if (!/CC0 1\.0 Universal/.test(licence) || !/Public Domain Dedication/.test(licence))
      throw new Error(`${lib.archive}: License.txt does not say CC0 1.0 Universal`);
    const rig = readRig(zip.read(lib.glb));
    const tpose = rig.animations.find((a) => a.name === TPOSE_ANIMATION) ?? null;
    if (!tpose) throw new Error(`${lib.archive} has no ${TPOSE_ANIMATION}`);
    for (const anim of rig.animations) {
      if (anim.name === TPOSE_ANIMATION) continue;
      const r = retarget(rig, anim, tpose, target, FPS);
      const looped = /_Loop$/.test(anim.name);
      let frames = r.frames;
      let loop = looped;
      if (looped) {
        // A loop's last frame either repeats its first (the cycle is the frames before it) or
        // leads into it like any other step; a clip that jumps there is not a loop.
        const s = seam(r.rotations, r.frames, target.bones.length);
        if (s.first < 0.5 * s.typical) frames = r.frames - 1;
        else if (s.first > 2 * s.typical) loop = false;
      }
      const tokens = anim.name
        .split("_")
        .filter((t) => t.toLowerCase() !== "loop")
        .map((t) => t.toLowerCase());
      out.push({
        id: snake(anim.name),
        title: anim.name.replace(/_Loop$/, "").replace(/_/g, " "),
        description: `${lib.title} (Quaternius): ${anim.name.replace(/_/g, " ")}, retargeted onto MakeHuman's skeleton through a T-pose`,
        tags: [...new Set([lib.id, ...tokens])],
        fps: FPS,
        loop,
        rootMotion: CARRIES.test(anim.name),
        grounded: !AIRBORNE.test(anim.name),
        frames,
        rotations: r.rotations.subarray(0, frames * target.bones.length * 4),
        source: {
          archive: lib.archive,
          archiveSha256: lib.sha256,
          file: lib.glb,
          author: "Quaternius",
          licence: "CC0 1.0 Universal (the archive's License.txt)",
        },
        evidence: `${lib.archive} (sha256 ${lib.sha256}): License.txt "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication"`,
      });
    }
  }
  const ids = out.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`two Quaternius clips are called ${dup}`);
  return out;
}
