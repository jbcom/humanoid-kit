/**
 * Packs the CC0 eye materials into `packs/eyes`.
 *
 *   node scripts/pack-eyes.ts <makehuman-assets-research/packs>
 *
 * The directory holds `system_eye_materials01/` and `system_eye_materials02/`, each
 * with its pinned zip (`EYE_PACKS`, hashed before use). The numbers measured from
 * each texture are against the built-in eye's, in the committed body pack
 * (`packs/body/data`). See `scripts/lib/packEyes.ts`.
 */
import path from "node:path";
import { packEyes } from "./lib/packEyes.ts";

const archives = process.argv[2];
if (!archives) throw new Error("usage: node scripts/pack-eyes.ts <packs directory>");
const manifest = await packEyes({
  archives: path.resolve(archives),
  bodyDir: path.resolve(import.meta.dirname, "../packs/body/data"),
  outDir: path.resolve(import.meta.dirname, "../packs/eyes/data"),
});
console.log(`packed ${manifest.materials.length} eye materials`);
