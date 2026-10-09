import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  type AdultAnatomyManifest,
  type BodyManifest,
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

export const bodyPackData = () => ({
  manifest: bodyManifest,
  body: readPackFile(path.join(bodyDir, bodyManifest.body.file)),
  targets: readGzipPackFile(path.join(bodyDir, bodyManifest.targets.file)),
  attachments: readPackFile(path.join(bodyDir, bodyManifest.attachments.file)),
});

export const adultPackData = () => ({
  manifest: adultManifest,
  targets: readGzipPackFile(path.join(adultDir, adultManifest.targets.file)),
});

/** The packed assets read from disk, parsed once per test file. */
export function loadFixtureAssets(adultAnatomy = false): HumanoidAssets {
  if (!adultAnatomy) {
    core ??= parseHumanoidAssets(bodyPackData());
    return core;
  }
  withAdult ??= parseHumanoidAssets(bodyPackData(), adultPackData());
  return withAdult;
}
