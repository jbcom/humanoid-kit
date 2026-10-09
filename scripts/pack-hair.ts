/**
 * Packs the CC0 scalp hair of the MakeHuman system assets into `packs/hair`.
 *
 *   node scripts/pack-hair.ts <system-assets-dir>
 *
 * The argument is the extracted "MakeHuman system assets" pack
 * (makehuman_system_assets_cc0.zip). The hair binds to, and is baked against,
 * the body pack committed in `packs/body/data`, so a changed body pack needs
 * this rerun (`pack-makehuman.ts` runs it last). See `scripts/lib/packHair.ts`.
 */
import path from "node:path";
import { packHair } from "./lib/packHair.ts";

const arg = process.argv[2];
if (!arg) throw new Error("usage: node scripts/pack-hair.ts <system-assets-dir>");

await packHair({
  systemDir: path.resolve(arg),
  bodyDir: path.resolve(import.meta.dirname, "../packs/body/data"),
  outDir: path.resolve(import.meta.dirname, "../packs/hair/data"),
});
