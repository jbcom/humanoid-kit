/**
 * Build the verified adult sculpt cache on a CI host: download and hash-check the
 * community sculpts, provision the pinned Blender if the host has none, regenerate the
 * cuts and check each against `cuts.json` (`scripts/lib/detail/sculptSources.ts`). The
 * cache directory (`.cache/adult-sculpts/`, or `$HK_ADULT_SOURCE_CACHE`) is what the
 * unit-test jobs then download; they re-check every file's hash as they read it, so a
 * tampered artifact fails closed. Exits non-zero, naming the file, on any failure.
 *
 * `BLENDER` (a path) wins; else a Blender on the host; else the pinned Linux release
 * is extracted into `$HK_BLENDER_TOOLS` (default `.cache/blender/`).
 */
import path from "node:path";
import { ensureSculptSources, findBlender, sculptCacheRoot } from "../lib/detail/sculptSources.ts";
import { provisionBlender } from "../lib/provisionBlender.ts";

const REPO = path.resolve(import.meta.dirname, "../..");

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
  console.log(`adult sculpt cache verified in ${sculptCacheRoot()}`);
} catch (e) {
  console.error(`adult sculpt cache: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
