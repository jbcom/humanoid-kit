/**
 * Upscales, for inspection, every packed texture whose original is too coarse
 * for its closest QA framing (docs/evidence/upscale.md), by its channel class,
 * judged by the gates, and written out with its provenance manifest.
 *
 *   node scripts/upscale.ts <system-assets-dir> <out-dir>
 *
 * A texture is a candidate when the edge it needs (`scripts/lib/texelBudget.ts`,
 * capped at `TEXTURE_CEILING`) exceeds its source's; where the source is large
 * enough the packers re-source it instead. The packers ship none of these: no
 * method measured visibly closer to a larger original than the GPU's own
 * magnification (scripts/research/upscale-eval.ts). This shows what an upscale
 * would be, and how it fares at the gates, for any texture that falls short.
 * `<out-dir>` must lie outside the repository.
 */
import fs from "node:fs";
import path from "node:path";
import { textureNeeds, upscaleCandidates } from "./lib/textureNeeds.ts";
import {
  MANIFEST_FILE,
  MANIFEST_FORMAT,
  sha256File,
  type UpscaleManifest,
} from "./lib/upscale/provenance.ts";
import { writeRaster } from "./lib/upscale/raster.ts";
import { upscaleTexture } from "./lib/upscale/upscaleTexture.ts";

const [systemArg, outArg] = process.argv.slice(2);
if (!systemArg || !outArg)
  throw new Error("usage: node scripts/upscale.ts <system-assets-dir> <out-dir>");
const systemDir = path.resolve(systemArg);
const outDir = path.resolve(outArg);
const repo = path.resolve(import.meta.dirname, "..");
if (!path.relative(repo, outDir).startsWith(".."))
  throw new Error(`${outDir} is inside the repository; write upscales for inspection outside it`);
fs.mkdirSync(outDir, { recursive: true });

const manifest: UpscaleManifest = { format: MANIFEST_FORMAT, entries: [] };
for (const c of upscaleCandidates(await textureNeeds(path.join(repo, "packs"), systemDir))) {
  const { raster, entry } = await upscaleTexture({ ...c, systemDir });
  const output = `${entry.source.replace(/[\\/]/g, "__").replace(/\.[^.]+$/, "")}.png`;
  await writeRaster(raster, path.join(outDir, output));
  manifest.entries.push({ ...entry, output, outputSha256: sha256File(path.join(outDir, output)) });
  console.log(
    `${entry.source}: ${entry.sourceSize[0]}→${entry.outputSize[0]} ${entry.class} ` +
      `${entry.pass ? "passes" : "FAILS"} the gates`,
  );
}
fs.writeFileSync(path.join(outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`${manifest.entries.length} upscaled: ${path.join(outDir, MANIFEST_FILE)}`);
