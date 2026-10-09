/**
 * Measures how the skinning schemes deform the body at the joint extremes: the
 * numbers behind docs/ARCHITECTURE.md, "Skinning artefacts".
 *
 *   node scripts/research/skinning-artefacts.ts [--json out.json]
 *
 * `HK_SCHEMES` lists the schemes to compare (default: all). What is measured,
 * and how, is in scripts/lib/skinBench.ts.
 */
import fs from "node:fs";
import { skinPositionsBlended, skinPositionsDual } from "../../src/rig/dual.ts";
import { rigData, skinPositionsLinear } from "../../src/rig/pose.ts";
import { poseShare, skinDualShare } from "../../src/rig/skinShare.ts";
import { loadFixtureAssets } from "../../tests/fixtures.ts";
import { type Reading, type Scheme, SkinBench, table } from "../lib/skinBench.ts";

const assets = loadFixtureAssets();
const share = skinDualShare(rigData(assets).bones);

const ALL: Record<string, Scheme> = {
  LBS: skinPositionsLinear,
  DQS: skinPositionsDual,
  "LBS+DQS": (rest, rotations, positions, skinIndex, skinWeight, out) =>
    skinPositionsBlended(
      rest,
      rotations,
      positions,
      skinIndex,
      skinWeight,
      out,
      poseShare(rest, rotations, share),
    ),
};
const only = process.env.HK_SCHEMES?.split(",");
const schemes = only
  ? Object.fromEntries(Object.entries(ALL).filter(([k]) => only.includes(k)))
  : ALL;

const bench = new SkinBench(assets);
const all: Record<string, Reading[]> = {};
for (const [name, scheme] of Object.entries(schemes)) all[name] = bench.readings(scheme);
console.log(table(all));
const i = process.argv.indexOf("--json");
if (i > 0) fs.writeFileSync(process.argv[i + 1] as string, JSON.stringify(all, null, 1));
