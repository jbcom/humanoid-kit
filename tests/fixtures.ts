import fs from "node:fs";
import path from "node:path";
import {
  type AdultAnatomyManifest,
  type BodyManifest,
  type HumanoidAssets,
  parseHumanoidAssets,
} from "../src/format/assetFormat.ts";

const root = path.resolve(import.meta.dirname, "..");
const bodyDir = path.join(root, "packs/body/data");
const adultDir = path.join(root, "packs/adult-anatomy/data");

const buf = (file: string): ArrayBuffer => {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

export const bodyManifest = JSON.parse(
  fs.readFileSync(path.join(bodyDir, "manifest.json"), "utf8"),
) as BodyManifest;
export const adultManifest = JSON.parse(
  fs.readFileSync(path.join(adultDir, "manifest.json"), "utf8"),
) as AdultAnatomyManifest;

let core: HumanoidAssets | undefined;
let withAdult: HumanoidAssets | undefined;

const bodyPackData = () => ({
  manifest: bodyManifest,
  body: buf(path.join(bodyDir, "body.bin")),
  targets: buf(path.join(bodyDir, "targets.bin")),
  attachments: buf(path.join(bodyDir, "attachments.bin")),
});

/** The packed assets read from disk, parsed once per test file. */
export function loadFixtureAssets(adultAnatomy = false): HumanoidAssets {
  if (!adultAnatomy) {
    core ??= parseHumanoidAssets(bodyPackData());
    return core;
  }
  withAdult ??= parseHumanoidAssets(bodyPackData(), {
    manifest: adultManifest,
    targets: buf(path.join(adultDir, "targets.bin")),
  });
  return withAdult;
}
