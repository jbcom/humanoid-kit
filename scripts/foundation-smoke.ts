/**
 * Runs the foundation's invariant suite over the smoke tier and writes its
 * table (docs/evidence/FOUNDATION-SMOKE.md) and the measures behind it
 * (docs/evidence/foundation-smoke.json), the foundation lanes' worklist. The
 * smoke test holds every row to no worse than the file, so a lane that fixes
 * a failure rewrites the file in its commit, and one that breaks a row fails.
 *
 *   node scripts/foundation-smoke.ts
 */
import fs from "node:fs";
import path from "node:path";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { SMOKE_STRIDE, smokeModelOptions } from "../src/foundation/smoke.ts";
import { runFoundation, suiteTable } from "../src/foundation/suite.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { adultPackData, bodyPackData } from "../tests/fixtures.ts";

const root = path.resolve(import.meta.dirname, "..");
const adult = adultPackData();
const model = new HumanoidModel(parseHumanoidAssets(bodyPackData(), adult), smokeModelOptions);
const rows = runFoundation(model, "smoke", { adult: adult.manifest, stride: SMOKE_STRIDE });
fs.writeFileSync(
  path.join(root, "docs/evidence/foundation-smoke.json"),
  `${JSON.stringify(rows, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(root, "docs/evidence/FOUNDATION-SMOKE.md"),
  `# The foundation's smoke tier: invariant failures

Written by \`node scripts/foundation-smoke.ts\` from the invariant suite
(src/foundation/invariants.ts) over the smoke tier (the cross set's six shape
extremes, rest, seated, overhead and the deep squat). Tone changes no
position, so each row holds for tones 1, 3 and 6. Penetration samples every
${SMOKE_STRIDE}th welded vertex. This is the foundation lanes' worklist: the
smoke test fails if a row gets worse, and a lane that fixes one rewrites this
file in its commit.

${suiteTable(rows)}
`,
);
console.log(`wrote ${rows.length} rows`);
