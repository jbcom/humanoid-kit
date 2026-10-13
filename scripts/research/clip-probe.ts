/**
 * Numbers for an authored clip, for iterating on its key poses: where named
 * joints sit (the head of each bone, in metres in the figure's frame, the
 * figure lifted onto the ground as the renderer lifts it) at chosen times.
 * The figure's left is +x or -x as the rest pose prints it; the probe prints
 * the rest pose first so a reading never rests on a remembered convention.
 *
 *   node scripts/research/clip-probe.ts <clip.json> [--at 0,1,2] [--bones wrist.L,head]
 *     [--figure average@25]
 */
import path from "node:path";
import type { MacroValues } from "../../src/makehuman/macro.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { createRecipe } from "../../src/recipe/recipe.ts";
import { posedBoneHeads } from "../../src/rig/bones.ts";
import { IDENTITY_POSE, restBones, rigData } from "../../src/rig/pose.ts";
import { loadFixtureAssets } from "../../tests/fixtures.ts";
import { authoredClips } from "../lib/authoredClips.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1] ?? fallback;
  args.splice(i, 2);
  return v;
};
const names = option("bones", "head,wrist.L,wrist.R,lowerarm01.L,lowerarm01.R,foot.L,foot.R").split(
  ",",
);
const atArg = option("at", "");
const [type = "average", age = "25"] = option("figure", "average@25").split("@");
const [clipFile] = args;
if (!clipFile) throw new Error("usage: clip-probe.ts <clip.json> [--at t,t] [--bones a,b]");

const TYPES: Record<string, Partial<MacroValues>> = {
  slim: { gender: 1, weight: 0.1 },
  average: { gender: 0.5 },
  heavy: { gender: 0, weight: 0.95, muscle: 0.8 },
};
const assets = loadFixtureAssets();
const rig = rigData(assets);
const clip = authoredClips(rig.poses, rig.bones, path.dirname(path.resolve(clipFile))).find((c) =>
  c.file.endsWith(`/${path.basename(clipFile)}`),
);
if (!clip) throw new Error(`no clip in ${clipFile}`);
const ev = new HumanoidModel(assets, { subdivision: 0 }).evaluate(
  createRecipe({ macros: { age: Number(age), ...TYPES[type] } }),
);
const rest = restBones(assets, ev.control);
const index = names.map((n) => {
  const i = rig.bones.indexOf(n);
  if (i < 0) throw new Error(`no bone ${n}`);
  return i;
});

const row = (label: string, heads: Float32Array) => {
  let low = Number.POSITIVE_INFINITY;
  for (let b = 0; b < rig.bones.length; b++) low = Math.min(low, heads[b * 3 + 1] as number);
  const cells = index.map((b, k) => {
    const [x, y, z] = [0, 1, 2].map((a) => (heads[b * 3 + a] as number) - (a === 1 ? low : 0));
    return `${names[k]}=(${x?.toFixed(2)},${y?.toFixed(2)},${z?.toFixed(2)})`;
  });
  console.log(`${label.padEnd(7)} ${cells.join(" ")}`);
};

row("rest", posedBoneHeads(rest, IDENTITY_POSE(rig.bones.length)));
const times = atArg
  ? atArg.split(",").map(Number)
  : Array.from({ length: 9 }, (_, i) => ((clip.frames - 1) / 30) * (i / 8));
for (const t of times) {
  const f = Math.min(clip.frames - 1, Math.round(t * 30));
  const rotations = IDENTITY_POSE(rig.bones.length);
  for (const [b, q] of clip.frame(f)) rotations.set(q, b * 4);
  row(`t=${(f / 30).toFixed(2)}`, posedBoneHeads(rest, rotations));
}
