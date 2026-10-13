import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { EyeManifest } from "../src/eyes/library.ts";
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
export const hairDir = path.join(root, "packs/hair/data");

const arrayBuffer = (b: Uint8Array): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
/** A pack file's bytes as shipped. */
export const readPackFile = (file: string): ArrayBuffer => arrayBuffer(fs.readFileSync(file));
const decompressed = new Map<string, ArrayBuffer>();
/**
 * A gzipped pack file, decompressed (tests are synchronous; the runtime uses
 * `gunzip`). Decoded once per test file: the parsed assets only read it.
 */
export const readGzipPackFile = (file: string): ArrayBuffer => {
  let bytes = decompressed.get(file);
  if (!bytes) {
    bytes = arrayBuffer(gunzipSync(fs.readFileSync(file)));
    decompressed.set(file, bytes);
  }
  return bytes;
};

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

/** The eye pack's manifest, as shipped. */
export const eyeManifest = JSON.parse(
  fs.readFileSync(path.join(root, "packs/eyes/data/manifest.json"), "utf8"),
) as EyeManifest;

/** The clothing pack's manifest and, unless `withGarments` is false, its decompressed binary. */
export const clothingPackData = (withGarments = true) => ({
  manifest: clothingManifest,
  ...(withGarments && {
    garments: readGzipPackFile(path.join(clothingDir, clothingManifest.garments.file)),
  }),
});

/**
 * A second clothing pack as a consumer would ship one: the shipped pack's
 * garments and binary under ids and texture names that start with `prefix`.
 * Its textures are never fetched by a load, only resolved to URLs.
 */
export function consumerClothingManifest(prefix: string): ClothingManifest {
  const renamed = <T extends string | null | undefined>(t: T): T => (t ? `${prefix}_${t}` : t) as T;
  return {
    ...clothingManifest,
    garments: {
      ...clothingManifest.garments,
      entries: clothingManifest.garments.entries.map((g) => ({
        ...g,
        id: `${prefix}/${g.id}`,
        material: {
          ...g.material,
          texture: renamed(g.material.texture),
          ...(g.material.normalTexture !== undefined && {
            normalTexture: renamed(g.material.normalTexture),
          }),
        },
      })),
    },
  };
}

let clothed: HumanoidAssets | undefined;

/** The packed assets with the clothing pack's garments loaded, parsed once per test file. */
export function loadClothedAssets(): HumanoidAssets {
  clothed ??= parseHumanoidAssets(bodyPackData(), undefined, clothingPackData());
  return clothed;
}

/** The body pack's proxy file, decompressed. */
export const proxyPackFile = (): ArrayBuffer => {
  const listed = bodyManifest.proxies;
  if (!listed) throw new Error("the body pack has no proxies");
  return readGzipPackFile(path.join(bodyDir, listed.file));
};

let miniature: HumanoidAssets | undefined;

/** The packed assets with the garments and the proxy bodies loaded, parsed once per test file. */
export function loadMiniatureAssets(): HumanoidAssets {
  miniature ??= parseHumanoidAssets(
    { ...bodyPackData(), proxies: proxyPackFile() },
    undefined,
    clothingPackData(),
  );
  return miniature;
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
