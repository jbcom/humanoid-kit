/**
 * Download and verify the adult pack's community sculpts, and regenerate their cuts,
 * into the gitignored sculpt cache (`scripts/lib/detail/sculptSources.ts`). The packer
 * and the tests do this themselves; run this to warm the cache or to see why it fails.
 * Exits non-zero, naming the file, on a failed download, a hash mismatch, a missing
 * Blender or a cut that came out differently.
 */
import { ensureSculptSources, sculptCacheRoot } from "./lib/detail/sculptSources.ts";

try {
  await ensureSculptSources();
  console.log(`adult sculpt sources verified in ${sculptCacheRoot()}`);
} catch (e) {
  console.error(`adult sculpt sources: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
