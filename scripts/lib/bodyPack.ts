/**
 * The committed body pack read from disk, as the packers that bind to it (hair,
 * clothing) and the texture survey (`textureNeeds`) parse it.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  type BodyManifest,
  type BodyPackData,
  parseHumanoidAssets,
} from "../../src/format/assetFormat.ts";

/** A gzipped pack file under `dir`, decompressed. */
export function gunzipFile(dir: string, file: string): ArrayBuffer {
  const b = gunzipSync(fs.readFileSync(path.join(dir, file)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** The body pack in `bodyDir` (its data directory), every target file included, unparsed. */
export function bodyPackFiles(bodyDir: string): BodyPackData {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bodyDir, "manifest.json"), "utf8"),
  ) as BodyManifest;
  return {
    manifest,
    body: gunzipFile(bodyDir, manifest.body.file),
    targets: Object.fromEntries(manifest.targets.map((f) => [f.id, gunzipFile(bodyDir, f.file)])),
    attachments: gunzipFile(bodyDir, manifest.attachments.file),
    ...(manifest.bodyOcclusion && {
      bodyOcclusion: gunzipFile(bodyDir, manifest.bodyOcclusion.file),
    }),
  };
}

/** The body pack in `bodyDir`, parsed: what the hair and garments bind to and bake against. */
export function readBodyPack(bodyDir: string) {
  const data = bodyPackFiles(bodyDir);
  return { manifest: data.manifest, assets: parseHumanoidAssets(data) };
}
