/**
 * Build the verified adult sculpt cache: download and hash-check the community
 * sculpts, regenerate their cuts with Blender and check each against `cuts.json`
 * (`scripts/lib/detail/sculptSources.ts`). The default test run never does this (it
 * is hermetic: no network, no Blender); the packer, `pnpm test:adult-sculpts` and the
 * opt-in `adult-sculpts` workflow do. Exits non-zero, naming the file, on a failed
 * download, a hash mismatch, a missing Blender or a cut that came out differently.
 *
 * Blender: `$BLENDER` (a path), else one on the PATH or in a standard install, else the
 * pinned macOS arm64 release extracted into `$HK_BLENDER_TOOLS` (default
 * `.cache/blender/`). The cache is `.cache/adult-sculpts/`, or `$HK_ADULT_SOURCE_CACHE`.
 */
import path from "node:path";
import { ensureSculptSources, findBlender, sculptCacheRoot } from "./lib/detail/sculptSources.ts";
import { provisionBlender } from "./lib/provisionBlender.ts";

const REPO = path.resolve(import.meta.dirname, "..");

try {
  const blender =
    findBlender() ??
    (await provisionBlender({
      toolDir: process.env.HK_BLENDER_TOOLS
        ? path.resolve(process.env.HK_BLENDER_TOOLS)
        : path.join(REPO, ".cache/blender"),
    }));
  console.log(`using Blender at ${blender}`);
  await ensureSculptSources({ blender: () => blender });
  console.log(`adult sculpt sources verified in ${sculptCacheRoot()}`);
} catch (e) {
  console.error(`adult sculpt sources: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
