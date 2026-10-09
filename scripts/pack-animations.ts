/**
 * Packs MakeHuman's CC0 animation clips into `packs/animations`.
 *
 *   node scripts/pack-animations.ts <makehuman2_additional_assets_cc0.zip>
 *
 * The archive is hashed and must be the pinned one (`ADDITIONAL_ASSETS`), then
 * unpacked to a temporary directory with the system `unzip`. The clips are on
 * the default skeleton of the committed body pack (`packs/body/data`), so a
 * changed skeleton needs this rerun. See `scripts/lib/packAnimations.ts`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packAnimations } from "./lib/packAnimations.ts";

const arg = process.argv[2];
if (!arg)
  throw new Error("usage: node scripts/pack-animations.ts <makehuman2_additional_assets_cc0.zip>");
const archive = path.resolve(arg);
const archiveSha256 = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hk-animations-"));
try {
  execFileSync("unzip", ["-q", archive, "poses/*", "-d", tmp]);
  packAnimations({
    archiveDir: tmp,
    archiveSha256,
    bodyDir: path.resolve(import.meta.dirname, "../packs/body/data"),
    outDir: path.resolve(import.meta.dirname, "../packs/animations/data"),
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
