/**
 * Whole-body poses authored for this package (dedicated to the public domain
 * under CC0 1.0, like the data they pose): one JSON file each in
 * `scripts/poses/`, giving BVH channel values in degrees per joint over the
 * joint layout of a MakeHuman pose (`base`). Every other channel is zero, the
 * rest pose. The packer turns each into a pose entry exactly like the CC0 BVH
 * poses; a test rebuilds them from the files and compares with the pack.
 */
import fs from "node:fs";
import path from "node:path";
import type { BodyPoseEntry } from "../../src/format/assetFormat.ts";

export const AUTHORED_POSES_DIR = path.resolve(import.meta.dirname, "../poses");

/** The pack entry for one authored pose file, checked against its base and the skeleton. */
export function authoredPose(
  file: string,
  spec: unknown,
  shipped: readonly BodyPoseEntry[],
  bones: readonly string[],
): BodyPoseEntry {
  const fail = (why: string): never => {
    throw new Error(`poses/${file}: ${why}`);
  };
  if (typeof spec !== "object" || spec === null) return fail("not an object");
  const { name, title, description, base: baseName, rotations } = spec as Record<string, unknown>;
  if (typeof name !== "string" || `${name}.json` !== file) return fail(`name ${String(name)}`);
  if (typeof title !== "string" || !title) return fail("needs a title");
  if (typeof description !== "string" || !description) return fail("needs a description");
  if (shipped.some((p) => p.name === name)) return fail(`${name} is a MakeHuman pose's name`);
  const base = shipped.find((p) => p.name === baseName);
  if (!base) return fail(`unknown base ${String(baseName)}`);
  if (typeof rotations !== "object" || rotations === null) return fail("needs rotations");
  const values = new Map<string, number>();
  for (const [joint, channels] of Object.entries(rotations)) {
    const j = base.joints.find((b) => b.name === joint);
    if (!j) return fail(`${String(baseName)} has no joint ${joint}`);
    // A BVH joint with no bone of the same name would move nothing.
    if (!bones.includes(joint)) return fail(`${joint} is not a bone of the skeleton`);
    if (typeof channels !== "object" || channels === null) return fail(`${joint}: not an object`);
    for (const [c, v] of Object.entries(channels)) {
      if (!j.channels.includes(c) || !c.endsWith("rotation"))
        fail(`${joint} has no rotation channel ${c}`);
      if (typeof v !== "number" || !Number.isFinite(v)) fail(`${joint} ${c}: not a number`);
      values.set(`${joint}/${c}`, v as number);
    }
  }
  return {
    name,
    title,
    description,
    joints: base.joints,
    frame: base.joints.flatMap((j) => j.channels.map((c) => values.get(`${j.name}/${c}`) ?? 0)),
  };
}

/** Every authored pose, in file-name order. */
export function authoredPoses(
  shipped: readonly BodyPoseEntry[],
  bones: readonly string[],
): { file: string; pose: BodyPoseEntry }[] {
  return fs
    .readdirSync(AUTHORED_POSES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({
      file,
      pose: authoredPose(
        file,
        JSON.parse(fs.readFileSync(path.join(AUTHORED_POSES_DIR, file), "utf8")),
        shipped,
        bones,
      ),
    }));
}
