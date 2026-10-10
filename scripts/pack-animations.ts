/**
 * Packs the animation clips into `packs/animations`.
 *
 *   node scripts/pack-animations.ts <makehuman2_additional_assets_cc0.zip> [<quaternius-dir>]
 *
 * The first archive is hashed and must be the pinned one (`ADDITIONAL_ASSETS`). With
 * a directory holding the vendored Quaternius archives (`~/src/reference-codebases/
 * vendored-cc0/quaternius`, each pinned and checked for its CC0 `License.txt`), their
 * clips are packed too. The clips are on the default skeleton of the committed body
 * pack (`packs/body/data`), so a changed skeleton needs this rerun. See
 * `scripts/lib/packAnimations.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { packAnimations } from "./lib/packAnimations.ts";

const archive = process.argv[2];
if (!archive)
  throw new Error(
    "usage: node scripts/pack-animations.ts <makehuman2_additional_assets_cc0.zip> [<quaternius-dir>]",
  );
const quaternius = process.argv[3];
packAnimations({
  archive: fs.readFileSync(path.resolve(archive)),
  bodyDir: path.resolve(import.meta.dirname, "../packs/body/data"),
  outDir: path.resolve(import.meta.dirname, "../packs/animations/data"),
  ...(quaternius && { quaternius: path.resolve(quaternius) }),
});
