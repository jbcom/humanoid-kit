/**
 * Packs MakeHuman's CC0 animation clips into `packs/animations/data`: one
 * binary per clip (its frames' local rotations, in the figure's axes), a
 * manifest and a PROVENANCE.md.
 *
 * The clips are punkduck's, in `makehuman2_additional_assets_cc0.zip`
 * (`poses/*.bvh`), on MakeHuman's own default skeleton, so no retargeting is
 * needed: a BVH joint is a bone of the rig by name. Every clip is judged by the
 * licence rule (`judgeAsset`, docs/licence-history.md §4) with the asset-pack
 * listing page that calls the archive CC0 and the clip's own `.meta`
 * (`license CC0`), and the archive is pinned by its SHA-256, so a changed
 * archive fails the pack. MakeHuman's own `walk.bvh` and `zombie.bvh` are AGPL3
 * and are not here.
 *
 * Only rotations are packed. A BVH's root translation is not: it is the
 * source figure's, and where a clip carries a figure is derived from the
 * figure's own feet (`src/animation/locomotion.ts`).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { AnimationManifest, ClipEntry, ClipSource } from "../../src/animation/clip.ts";
import type { BodyManifest } from "../../src/format/assetFormat.ts";
import { frameRotations } from "../../src/rig/pose.ts";
import { parseBvh } from "./bvh.ts";
import { type CommunityPage, isCc0, judgeAsset, type SourceFile } from "./licenceRule.ts";
import { quaterniusClips, retargetTarget } from "./packQuaternius.ts";
import { sha256, writePackEntry } from "./packWriter.ts";
import { readZip } from "./zip.ts";

/** The archive the clips come from, pinned. */
export const ADDITIONAL_ASSETS = {
  archive: "makehuman2_additional_assets_cc0.zip",
  sha256: "3f458815a4aca79a3cc510a0c4da7232ca0c1e6d6f9a3949f96adf24f91d7f67",
  url: "https://files2.makehumancommunity.org/functional/makehuman2_additional_assets/makehuman2_additional_assets_cc0.zip",
} as const;

/**
 * The page that calls the archive CC0: the asset pack listing the MakeHuman
 * community's tools read (`assetpacks.json`, entry `makehuman2::additional_assets`,
 * `"license": "cc0"`), as read on 2026-10-09; its date is the archive's
 * Last-Modified.
 */
export const ADDITIONAL_ASSETS_PAGE: CommunityPage = {
  url: "https://files2.makehumancommunity.org/functional/assetpacks.json",
  submitter: "MakeHuman Community asset pack listing",
  submitted: "2026-06-25",
  licence: "cc0",
  retrieved: "2026-10-09",
};

export interface ClipSpec {
  /** The clip's file name under the archive's `poses/` without its extension, and its id. */
  id: string;
  title: string;
  /** Whether the last frame leads back into the first (checked against the data). */
  loop: boolean;
  /** Whether the clip carries the figure along; false for an idle or a clip that is not on the ground. */
  rootMotion: boolean;
  /** Whether the figure stands on the ground in the clip; false for a swim. */
  grounded: boolean;
  tags: string[];
}

/** The clips packed: every punkduck animation of the archive (the others there are single-frame poses). */
export const PUNKDUCK_CLIPS: readonly ClipSpec[] = [
  {
    id: "walk_normal",
    title: "Walk",
    loop: true,
    rootMotion: true,
    grounded: true,
    tags: ["walk", "locomotion"],
  },
  {
    id: "walk_female",
    title: "Walk, hips",
    loop: true,
    rootMotion: true,
    grounded: true,
    tags: ["walk", "locomotion"],
  },
  {
    id: "idle1",
    title: "Idle",
    loop: true,
    rootMotion: false,
    grounded: true,
    tags: ["idle", "standing"],
  },
  {
    id: "idle2",
    title: "Idle, shifting",
    loop: true,
    rootMotion: false,
    grounded: true,
    tags: ["idle", "standing"],
  },
  {
    id: "idlehips",
    title: "Idle, hips",
    loop: true,
    rootMotion: false,
    grounded: true,
    tags: ["idle", "standing"],
  },
  {
    id: "swimcrawlstroke",
    title: "Swim, crawl",
    loop: true,
    rootMotion: false,
    grounded: false,
    tags: ["swim", "water"],
  },
];

/** A bone is stored if any frame turns it by more than this, degrees. */
const MOVED_DEGREES = 0.02;

/** The most a loop's seam may step, as a multiple of the clip's median step: a seam is no larger than any other step. */
const SEAM_LIMIT = 2;

/** Sum over bones of the angle between two frames' rotations, degrees: how far a frame is from another. */
function frameDistance(a: Float32Array, b: Float32Array, bones: number): number {
  let sum = 0;
  for (let k = 0; k < bones; k++) {
    const dot = Math.abs(
      (a[k * 4] as number) * (b[k * 4] as number) +
        (a[k * 4 + 1] as number) * (b[k * 4 + 1] as number) +
        (a[k * 4 + 2] as number) * (b[k * 4 + 2] as number) +
        (a[k * 4 + 3] as number) * (b[k * 4 + 3] as number),
    );
    sum += 2 * Math.acos(Math.min(1, dot));
  }
  return (sum * 180) / Math.PI;
}

export interface EncodedClip {
  /** The bones the clip moves, in the rig's order. */
  bones: string[];
  frames: number;
  fps: number;
  /** `frames × bones × 4` quaternions (x, y, z, w), sign-continuous. */
  rotations: Float32Array;
  /** How large the step from the last frame to the first is, against the median step: a clean loop is under 1. */
  seamRatio: number;
}

/**
 * Frames of local rotations as an encoded clip: `frame(f, b)` is bone `b`'s
 * rotation at frame `f` (undefined: none), over `count` frames at `fps`. The bones that
 * ever move are kept, in the rig's order, each in one hemisphere from frame to frame.
 */
export function encodeFrames(
  rigBones: readonly string[],
  fps: number,
  count: number,
  frame: (f: number, bone: number) => ArrayLike<number> | undefined,
): EncodedClip {
  const angle = (q: ArrayLike<number>) => 2 * Math.acos(Math.min(1, Math.abs(q[3] as number)));
  const moved = rigBones
    .map((_, b) => b)
    .filter((b) => {
      for (let f = 0; f < count; f++) {
        const q = frame(f, b);
        if (q !== undefined && (angle(q) * 180) / Math.PI > MOVED_DEGREES) return true;
      }
      return false;
    });
  const n = moved.length;
  const rotations = new Float32Array(count * n * 4);
  for (let i = 0; i < count; i++) {
    moved.forEach((b, k) => {
      const q = frame(i, b) ?? [0, 0, 0, 1];
      const o = (i * n + k) * 4;
      // The same rotation has two quaternions; keep each bone in one hemisphere from frame to frame.
      const prev = i > 0 ? rotations.subarray(o - n * 4, o - n * 4 + 4) : null;
      const flip =
        prev &&
        (prev[0] as number) * (q[0] as number) +
          (prev[1] as number) * (q[1] as number) +
          (prev[2] as number) * (q[2] as number) +
          (prev[3] as number) * (q[3] as number) <
          0
          ? -1
          : 1;
      for (let c = 0; c < 4; c++)
        rotations[o + c] = (q[c] as number) * (prev ? (flip as number) : 1);
    });
  }
  const at = (i: number) => rotations.subarray(i * n * 4, (i + 1) * n * 4);
  const steps = Array.from({ length: count - 1 }, (_, i) =>
    frameDistance(at(i), at(i + 1), n),
  ).sort((x, y) => x - y);
  const median = steps[Math.floor(steps.length / 2)] ?? 0;
  const seam = frameDistance(at(count - 1), at(0), n);
  return {
    bones: moved.map((b) => rigBones[b] as string),
    frames: count,
    fps,
    rotations,
    seamRatio: median > 0 ? seam / median : 0,
  };
}

/**
 * A BVH's frames as the rig's local rotations (MakeHuman's Z-up axes turned
 * into the figure's, `frameRotations`), keeping the bones that ever move.
 */
export function encodeClip(rigBones: readonly string[], bvhText: string): EncodedClip {
  const bvh = parseBvh(bvhText);
  const unknown = bvh.joints.filter((j) => !rigBones.includes(j.name)).map((j) => j.name);
  if (unknown.length)
    throw new Error(`the BVH has joints the rig lacks: ${unknown.slice(0, 5).join(", ")}`);
  const frames = bvh.frames.map((f) => frameRotations({ bones: rigBones }, bvh.joints, f));
  return encodeFrames(rigBones, Math.round(1 / bvh.frameTime), frames.length, (f, b) =>
    frames[f]?.get(b),
  );
}

export interface PackAnimationsOptions {
  /** The MakeHuman additional assets archive (`ADDITIONAL_ASSETS.archive`), whose hash must be the pinned one. */
  archive: Buffer;
  /** The body pack's data directory: whose skeleton the clips are on. */
  bodyDir: string;
  /** The animation pack's data directory. */
  outDir: string;
  /** The directory holding the vendored Quaternius archives; without it only punkduck's clips are packed. */
  quaternius?: string;
  clips?: readonly ClipSpec[];
}

const metaField = (meta: string, key: string) =>
  meta.match(new RegExp(`^${key}\\s+(.*)$`, "m"))?.[1]?.trim() ?? "";

/** What a clip's manifest entry says besides what the encoding gives. */
interface ClipMeta {
  id: string;
  title: string;
  description: string;
  tags: string[];
  loop: boolean;
  rootMotion: boolean;
  grounded: boolean;
  source: ClipSource;
}

export function packAnimations(options: PackAnimationsOptions): void {
  const archiveHash = createHash("sha256").update(options.archive).digest("hex");
  if (archiveHash !== ADDITIONAL_ASSETS.sha256)
    throw new Error(
      `${ADDITIONAL_ASSETS.archive} is ${archiveHash}, not the pinned ${ADDITIONAL_ASSETS.sha256}`,
    );
  const zip = readZip(options.archive);
  const body = JSON.parse(
    fs.readFileSync(path.join(options.bodyDir, "manifest.json"), "utf8"),
  ) as BodyManifest;
  const rigBones = body.skeleton.bones.map((b) => b.name);
  fs.mkdirSync(options.outDir, { recursive: true });
  for (const f of fs.readdirSync(options.outDir)) fs.rmSync(path.join(options.outDir, f));
  const evidence: [string, string][] = [];
  const outputs: [string, string][] = [];
  const clips: ClipEntry[] = [];

  /** Writes one clip's binary and adds its entry. */
  const emit = (meta: ClipMeta, clip: EncodedClip) => {
    if (meta.loop && clip.seamRatio > SEAM_LIMIT)
      throw new Error(
        `${meta.id}: marked as a loop, but its last frame is ${clip.seamRatio.toFixed(1)}× a typical step from its first`,
      );
    const gz = new Uint8Array(
      gzipSync(
        new Uint8Array(clip.rotations.buffer, clip.rotations.byteOffset, clip.rotations.byteLength),
        { level: 9 },
      ),
    );
    const file = `${meta.id}.bin.gz`;
    fs.writeFileSync(path.join(options.outDir, file), gz);
    outputs.push([file, sha256(gz)]);
    clips.push({
      id: meta.id,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      fps: clip.fps,
      frames: clip.frames,
      duration: (meta.loop ? clip.frames : clip.frames - 1) / clip.fps,
      loop: meta.loop,
      rootMotion: meta.rootMotion,
      grounded: meta.grounded,
      bones: clip.bones,
      file,
      sha256: sha256(gz),
      source: meta.source,
    });
  };

  for (const spec of options.clips ?? PUNKDUCK_CLIPS) {
    const bvhText = zip.read(`poses/${spec.id}.bvh`).toString("utf8");
    const meta = zip.read(`poses/${spec.id}.meta`).toString("utf8");
    const files: SourceFile[] = [
      { name: `${spec.id}.meta`, text: meta },
      { name: `${spec.id}.bvh`, text: bvhText.slice(0, 4096) },
    ];
    const judgement = judgeAsset(files, ADDITIONAL_ASSETS_PAGE);
    if (!judgement.pass)
      throw new Error(`${spec.id}: licence rule refuses it: ${judgement.reason}`);
    // The page governs; the clip's own .meta must agree (a BVH has no place for a licence line).
    const stated = metaField(meta, "license");
    if (!isCc0(stated)) throw new Error(`${spec.id}: its .meta states "${stated}", not CC0`);
    evidence.push([
      spec.id,
      `clause ${judgement.clause}; ${judgement.evidence[`${spec.id}.meta`]}; its .meta states "license ${stated}", author ${metaField(meta, "author")}`,
    ]);
    emit(
      {
        id: spec.id,
        title: spec.title,
        description: metaField(meta, "description"),
        tags: spec.tags,
        loop: spec.loop,
        rootMotion: spec.rootMotion,
        grounded: spec.grounded,
        source: {
          archive: ADDITIONAL_ASSETS.archive,
          archiveSha256: ADDITIONAL_ASSETS.sha256,
          file: `poses/${spec.id}.bvh`,
          author: metaField(meta, "author"),
          licence: metaField(meta, "license"),
        },
      },
      encodeClip(rigBones, bvhText),
    );
  }

  const quaterniusEvidence = new Map<string, string>();
  if (options.quaternius) {
    const target = retargetTarget(options.bodyDir);
    for (const q of quaterniusClips(options.quaternius, target)) {
      const n = target.bones.length;
      quaterniusEvidence.set(q.source.archive, q.evidence);
      emit(
        {
          id: q.id,
          title: q.title,
          description: q.description,
          tags: q.tags,
          loop: q.loop,
          rootMotion: q.rootMotion,
          grounded: q.grounded,
          source: q.source,
        },
        encodeFrames(rigBones, q.fps, q.frames, (f, b) =>
          q.rotations.subarray((f * n + b) * 4, (f * n + b) * 4 + 4),
        ),
      );
    }
  }
  const ids = clips.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`two clips are called ${dup}`);
  const manifest: AnimationManifest = { version: 1, clips };
  fs.writeFileSync(path.join(options.outDir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  writeProvenance(options.outDir, evidence, outputs, [...quaterniusEvidence.values()], clips);
  writePackEntry(
    path.resolve(options.outDir, ".."),
    "animationsPack",
    "URLs of the humanoid-kit-animations pack files. Pass to `loadAnimationLibrary`.",
    "scripts/pack-animations.ts",
  );
}

function writeProvenance(
  dir: string,
  evidence: [string, string][],
  outputs: [string, string][],
  quaternius: string[],
  clips: ClipEntry[],
) {
  const fromQuaternius = clips.filter((c) => c.source.author === "Quaternius");
  const lines = [
    "# humanoid-kit-animations data provenance",
    "",
    "Generated by `scripts/pack-animations.ts`; do not edit.",
    "",
    "## MakeHuman's additional assets",
    "",
    `Source: \`${ADDITIONAL_ASSETS.archive}\` (sha256 \`${ADDITIONAL_ASSETS.sha256}\`), <${ADDITIONAL_ASSETS.url}>,`,
    "directory `poses/`: punkduck's animation clips, on MakeHuman's default skeleton. Only asset data is used; no MakeHuman",
    'code. "MakeHuman" is the upstream project\'s name; this package is not affiliated with it, and CC0 does not license',
    "trademarks (CC0 1.0 §4a).",
    "",
    `Licence: the archive is listed as CC0 in the community's asset pack listing (<${ADDITIONAL_ASSETS_PAGE.url}>,`,
    `entry \`makehuman2::additional_assets\`, \`"license": "cc0"\`, read ${ADDITIONAL_ASSETS_PAGE.retrieved}), and each clip's own`,
    "`.meta` states `license CC0` and its author. Each clip passed the repository's licence rule",
    "(`scripts/lib/licenceRule.ts`, docs/licence-history.md, clause B) with the listing, and its `.meta` was checked to agree, before packing:",
    "",
    ...evidence.map(([id, ev]) => `- ${id}: ${ev}`),
    "",
    "MakeHuman's own `walk.bvh` and `zombie.bvh` (AGPL3) are not used.",
    "",
    "Only each frame's bone rotations are packed, converted to the figure's axes (`src/rig/pose.ts`); the BVH's",
    "root translation is not (where a clip carries a figure is derived from the figure's feet).",
    "",
    ...(quaternius.length
      ? [
          "## Quaternius's Universal Animation Libraries",
          "",
          `${fromQuaternius.length} clips, from the copies vendored with their SHA-256 (the archives below; Quaternius moved later`,
          "releases to a licence that is not CC0, on 2026-08-28, and these were downloaded before). Each archive's own",
          "`License.txt` is CC0 1.0 Universal, checked when packing:",
          "",
          ...quaternius.map((e) => `- ${e}`),
          "",
          "Each is the library's in-place animation, retargeted onto MakeHuman's default skeleton through a T-pose on both",
          "rigs (`scripts/lib/retarget.ts`): a source bone's turn from its T-pose in the world is applied to the target bone",
          "from its own T-pose, the spine's by height, the pelvis to both legs' pelvis bones and the lowest spine bone. Only",
          "rotations are packed; where a clip carries a figure is derived from the figure's feet.",
          "",
        ]
      : []),
    "## Outputs",
    "",
    "| Output | SHA-256 |",
    "| --- | --- |",
    ...outputs.map(([f, h]) => `| ${f} | \`${h}\` |`),
    "",
  ];
  fs.writeFileSync(path.join(dir, "PROVENANCE.md"), lines.join("\n"));
}
