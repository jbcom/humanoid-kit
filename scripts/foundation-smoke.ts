/** Measure smoke geometry without overwriting the reviewed baseline by default.
 * node scripts/foundation-smoke.ts [--output-dir <new-directory>]
 * After actual maintainer review, explicitly record a reviewed candidate:
 * node scripts/foundation-smoke.ts --update-reviewed-baseline --review-reference <review-url>
 * The reference records claimed review provenance; this script cannot verify approval.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseHumanoidAssets } from "../src/format/assetFormat.ts";
import { SMOKE_STRIDE, smokeModelOptions } from "../src/foundation/smoke.ts";
import { smokeSummary } from "../src/foundation/smokeReport.ts";
import { runFoundation, suiteTable } from "../src/foundation/suite.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { adultPackData, bodyPackData } from "../tests/fixtures.ts";
import { foundationSmokeOutput } from "./lib/foundationSmokeOutput.ts";

const root = path.resolve(import.meta.dirname, "..");
const intent = foundationSmokeOutput(process.argv.slice(2));
// A new directory prevents output-only runs from overwriting committed evidence.
const output = intent.updateBaseline
  ? path.join(root, "docs/evidence")
  : intent.outputDir
    ? path.resolve(intent.outputDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), "foundation-smoke-"));
if (!intent.updateBaseline && intent.outputDir) fs.mkdirSync(output);
const adult = adultPackData();
const model = new HumanoidModel(parseHumanoidAssets(bodyPackData(), adult), smokeModelOptions);
const rows = runFoundation(model, "smoke", { adult: adult.manifest, stride: SMOKE_STRIDE });
fs.writeFileSync(path.join(output, "foundation-smoke.json"), `${JSON.stringify(rows, null, 2)}\n`);
fs.writeFileSync(
  path.join(output, "FOUNDATION-SMOKE.md"),
  `# Foundation smoke: REST acceptance and POSED regression budget

Measured by \`node scripts/foundation-smoke.ts\` from the invariant suite
(src/foundation/invariants.ts), using every ${SMOKE_STRIDE}th welded vertex.
Tone changes no position; each row holds for tones 1, 3 and 6.
${intent.updateBaseline ? `Claimed review reference: ${intent.reviewReference}. Actual maintainer review is required.` : "Measurement candidate only; the reviewed baseline was not changed."}

\`\`\`text
${smokeSummary(rows)}
\`\`\`

REST is the only approved hard-gated pose family. POSED failures remain failures
within a passing numeric regression budget. A baseline update never promotes a
pose family: promotion requires a separate reviewed source policy change and
current invariant and visual acceptance evidence for that family.

${suiteTable(rows)}
`,
);
console.log(smokeSummary(rows));
console.log(`wrote ${rows.length} measurement rows to ${output}`);
