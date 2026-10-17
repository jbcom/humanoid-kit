/** Measure the period drill's acceptance worklist without overwriting the reviewed one by default.
 * node scripts/drill-worklist.ts [--output-dir <new-directory>]
 * After actual maintainer review, explicitly record a reviewed candidate:
 * node scripts/drill-worklist.ts --update-reviewed-baseline --review-reference <review-url>
 * The reference records claimed review provenance; this script cannot verify approval.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { measureDrillWorklist } from "./lib/drillWorklist.ts";
import { foundationSmokeOutput } from "./lib/foundationSmokeOutput.ts";

const root = path.resolve(import.meta.dirname, "..");
const intent = foundationSmokeOutput(process.argv.slice(2));
const output = intent.updateBaseline
  ? path.join(root, "docs/evidence")
  : intent.outputDir
    ? path.resolve(intent.outputDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), "drill-worklist-"));
if (!intent.updateBaseline && intent.outputDir) fs.mkdirSync(output);
const worklist = measureDrillWorklist();
fs.writeFileSync(
  path.join(output, "drill-worklist.json"),
  `${JSON.stringify(
    {
      ...(intent.reviewReference && { reviewReference: intent.reviewReference }),
      ...worklist,
    },
    null,
    2,
  )}\n`,
);
const misses = Object.entries(worklist.misses);
console.log(
  `drill worklist (NOT acceptance): ${worklist.missingKeys.length} counts without a key, ${misses.length} contact misses`,
);
for (const id of worklist.missingKeys) console.log(`  no key: ${id}`);
for (const [id, metres] of misses) console.log(`  miss: ${id}: ${(metres * 1000).toFixed(1)} mm`);
console.log(`wrote the worklist to ${output}`);
