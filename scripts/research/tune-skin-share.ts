/**
 * Finds `SKIN_DUAL_SHARE` (src/rig/skinShare.ts): the scheme each bone asks
 * for, from linear blending (0) to dual quaternions (1).
 *
 *   node scripts/research/tune-skin-share.ts
 *
 * Each limb's bones are searched together, one bone at a time over a few
 * shares (coordinate descent from all-linear, until nothing improves), for the
 * lowest loss over the joint cases of scripts/lib/skinBench.ts at four body
 * types. The loss charges what each scheme does wrong at a joint: a girth that
 * falls short of 1 (pinch), vertices well below it (the candy wrapper's neck),
 * vertices well above it (the bulge dual quaternions leave at a bend) and the
 * volume lost. The child body type is held out, to check the table is not tuned
 * to the four.
 */
import { skinPositionsBlended } from "../../src/rig/dual.ts";
import { rigData } from "../../src/rig/pose.ts";
import { skinDualShare } from "../../src/rig/skinShare.ts";
import { loadFixtureAssets } from "../../tests/fixtures.ts";
import { type Reading, type Scheme, SkinBench } from "../lib/skinBench.ts";

const GROUPS: Record<"arm" | "leg", string[]> = {
  arm: ["clavicle", "shoulder01", "upperarm01", "upperarm02", "lowerarm01", "lowerarm02", "wrist"],
  leg: ["pelvis", "upperleg01", "upperleg02", "lowerleg01", "lowerleg02", "foot"],
};
const STEPS = [0, 0.25, 0.5, 0.75, 1];

/** What a reading costs: pinch, collapsed vertices, bulge, volume lost. */
export function loss(r: Reading): number {
  const pinch = Math.max(0, 1 - r.mean);
  const neck = Math.max(0, 0.85 - r.p5);
  const bulge = Math.max(0, r.p95 - 1.08);
  const volume = Math.max(0, -r.dV) / 10;
  return 6 * pinch ** 2 + neck ** 2 + 8 * bulge ** 2 + volume ** 2;
}

const assets = loadFixtureAssets();
const bones = rigData(assets).bones;
const tuned = new SkinBench(assets, [
  "average",
  "tall lean man",
  "short full woman",
  "muscular man",
]);
const heldOut = new SkinBench(assets, ["child"]);

const schemeOf = (table: Record<string, number>): Scheme => {
  const share = skinDualShare(bones, table);
  return (rest, rotations, positions, skinIndex, skinWeight, out) =>
    skinPositionsBlended(rest, rotations, positions, skinIndex, skinWeight, out, share);
};
const total = (bench: SkinBench, table: Record<string, number>, group: "arm" | "leg") =>
  bench.readings(schemeOf(table), group).reduce((sum, r) => sum + loss(r), 0);

const table: Record<string, number> = {};
for (const group of ["arm", "leg"] as const) {
  for (const bone of GROUPS[group]) table[bone] = 0;
  let best = total(tuned, table, group);
  console.log(`${group}: all linear loss ${best.toFixed(2)}`);
  for (let sweep = 0; sweep < 4; sweep++) {
    let improved = false;
    for (const bone of GROUPS[group]) {
      const keep = table[bone] as number;
      let bestStep = keep;
      for (const step of STEPS) {
        if (step === keep) continue;
        table[bone] = step;
        const l = total(tuned, table, group);
        if (l < best - 1e-9) {
          best = l;
          bestStep = step;
          improved = true;
        }
      }
      table[bone] = bestStep;
    }
    console.log(`  sweep ${sweep + 1}: loss ${best.toFixed(2)}  ${JSON.stringify(table)}`);
    if (!improved) break;
  }
  const allLinear = Object.fromEntries(GROUPS[group].map((b) => [b, 0]));
  const allDual = Object.fromEntries(GROUPS[group].map((b) => [b, 1]));
  for (const [name, t] of [
    ["linear", allLinear],
    ["dual", allDual],
    ["tuned", table],
  ] as const)
    console.log(
      `  ${name.padEnd(7)} tuned bodies ${total(tuned, t, group).toFixed(2)}  held-out child ${total(heldOut, t, group).toFixed(2)}`,
    );
}
console.log(JSON.stringify(table, null, 2));
