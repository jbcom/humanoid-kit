/**
 * Rebakes only the body pack's age surface map (`scripts/lib/ageSurfaceMap.ts`)
 * against the committed body pack, and records it in the pack's manifest and
 * PROVENANCE.md exactly as `scripts/pack-makehuman.ts` does when it packs the
 * whole body, so the two never disagree and the map can change without
 * re-encoding every target.
 *
 *   node scripts/pack-age-surface.ts <system-assets-dir>
 *
 * The argument is the extracted "MakeHuman system assets" pack
 * (makehuman_system_assets_cc0.zip), as `pack-makehuman.ts` takes it.
 */
import fs from "node:fs";
import path from "node:path";
import type { BodyManifest } from "../src/format/assetFormat.ts";
import { ageSurfaceProvenance, writeAgeSurfaceMap } from "./lib/ageSurfaceMap.ts";
import { readBodyPack } from "./lib/bodyPack.ts";

const system = process.argv[2];
if (!system) throw new Error("usage: node scripts/pack-age-surface.ts <system-assets-dir>");
const BODY_OUT = path.resolve(import.meta.dirname, "../packs/body/data");

const { assets } = readBodyPack(BODY_OUT);
const out = await writeAgeSurfaceMap(assets, path.resolve(system), BODY_OUT);

const manifestPath = path.join(BODY_OUT, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BodyManifest;
manifest.ageSurface = out.entry;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

// PROVENANCE.md: the map's section before the texture sizes (where pack-makehuman puts
// it), and its row in the outputs table.
const provenancePath = path.join(BODY_OUT, "PROVENANCE.md");
let text = fs.readFileSync(provenancePath, "utf8");
const section = ageSurfaceProvenance(out).join("\n");
const start = text.indexOf("## Age surface map");
if (start >= 0) {
  const end = text.indexOf("\n## ", start + 1);
  text = `${text.slice(0, start)}${section}${text.slice(end)}`;
} else {
  const at = text.indexOf("## Texture sizes");
  if (at < 0) throw new Error("PROVENANCE.md has no texture sizes section to place the map before");
  text = `${text.slice(0, at)}${section}\n${text.slice(at)}`;
}
const row = `| ${out.entry.file} | \`${out.entry.sha256}\` |`;
const rowAt = text.indexOf(`| ${out.entry.file} |`);
if (rowAt >= 0) {
  const lineEnd = text.indexOf("\n", rowAt);
  text = `${text.slice(0, rowAt)}${row}${text.slice(lineEnd)}`;
} else text = `${text.trimEnd()}\n${row}\n`;
fs.writeFileSync(provenancePath, text);
console.log(`wrote ${out.entry.file} (${out.entry.sha256})`);
