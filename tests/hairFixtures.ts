import fs from "node:fs";
import path from "node:path";
import {
  addHairStyle,
  type HairManifest,
  type HumanoidAssets,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";
import { bodyPackData, hairDir, readGzipPackFile } from "./fixtures.ts";

export { hairDir };

export const hairManifest = JSON.parse(
  fs.readFileSync(path.join(hairDir, "manifest.json"), "utf8"),
) as HairManifest;

/** The scalp styles: the ones with a hairline, growth and a strand map, which most hair tests are about. */
export const scalpStyles = hairManifest.styles.filter((s) => s.kind === "scalp");

/** One style's decompressed binary. */
export const hairStyleBin = (id: string): ArrayBuffer => {
  const style = hairManifest.styles.find((s) => s.id === id);
  if (!style) throw new Error(`no hair style ${id}`);
  return readGzipPackFile(path.join(hairDir, style.file));
};

let loaded: HumanoidAssets | undefined;

/**
 * The body pack with the hair pack's manifest and every style's geometry, parsed
 * once per test file. Targets are the body pack's, every file.
 */
export function loadHairFixtureAssets(): HumanoidAssets {
  if (!loaded) {
    loaded = parseHumanoidAssets(bodyPackData(), undefined, undefined, { manifest: hairManifest });
    for (const s of hairManifest.styles) addHairStyle(loaded, s.id, hairStyleBin(s.id));
  }
  return loaded;
}
