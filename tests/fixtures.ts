import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  type AdultAnatomyManifest,
  type BodyManifest,
  type ClothingManifest,
  type HumanoidAssets,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";

const root = path.resolve(import.meta.dirname, "..");
export const bodyDir = path.join(root, "packs/body/data");
export const adultDir = path.join(root, "packs/adult-anatomy/data");

const arrayBuffer = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
/** A pack file's bytes as shipped. */
export const readPackFile = (file: string): ArrayBuffer => arrayBuffer(fs.readFileSync(file));
/** A gzipped pack file, decompressed (tests are synchronous; the runtime uses `gunzip`). */
export const readGzipPackFile = (file: string): ArrayBuffer =>
  arrayBuffer(gunzipSync(fs.readFileSync(file)));

export const bodyManifest = JSON.parse(
  fs.readFileSync(path.join(bodyDir, "manifest.json"), "utf8"),
) as BodyManifest;
export const adultManifest = JSON.parse(
  fs.readFileSync(path.join(adultDir, "manifest.json"), "utf8"),
) as AdultAnatomyManifest;

let core: HumanoidAssets | undefined;
let withAdult: HumanoidAssets | undefined;

/** The body pack's target files by id, decompressed; `only` limits them to those ids. */
export const bodyTargetFiles = (only?: readonly string[]): Record<string, ArrayBuffer> =>
  Object.fromEntries(
    bodyManifest.targets
      .filter((f) => !only || only.includes(f.id))
      .map((f) => [f.id, readGzipPackFile(path.join(bodyDir, f.file))]),
  );

export const bodyPackData = (only?: readonly string[]) => ({
  manifest: bodyManifest,
  body: readGzipPackFile(path.join(bodyDir, bodyManifest.body.file)),
  targets: bodyTargetFiles(only),
  attachments: readGzipPackFile(path.join(bodyDir, bodyManifest.attachments.file)),
  ...(bodyManifest.bodyOcclusion && {
    bodyOcclusion: readGzipPackFile(path.join(bodyDir, bodyManifest.bodyOcclusion.file)),
  }),
});

export const adultPackData = () => ({
  manifest: adultManifest,
  targets: readGzipPackFile(path.join(adultDir, adultManifest.targets.file)),
});

export const clothingDir = path.join(root, "packs/clothing/data");
export const clothingManifest = JSON.parse(
  fs.readFileSync(path.join(clothingDir, "manifest.json"), "utf8"),
) as ClothingManifest;

/** The clothing pack's manifest and, unless `withGarments` is false, its decompressed binary. */
export const clothingPackData = (withGarments = true) => ({
  manifest: clothingManifest,
  ...(withGarments && {
    garments: readGzipPackFile(path.join(clothingDir, clothingManifest.garments.file)),
  }),
});

let clothed: HumanoidAssets | undefined;

/** The packed assets with the clothing pack's garments loaded, parsed once per test file. */
export function loadClothedAssets(): HumanoidAssets {
  clothed ??= parseHumanoidAssets(bodyPackData(), undefined, clothingPackData());
  return clothed;
}

/** The packed assets read from disk, parsed once per test file. */
export function loadFixtureAssets(adultAnatomy = false): HumanoidAssets {
  if (!adultAnatomy) {
    core ??= parseHumanoidAssets(bodyPackData());
    return core;
  }
  withAdult ??= parseHumanoidAssets(bodyPackData(), adultPackData());
  return withAdult;
}
