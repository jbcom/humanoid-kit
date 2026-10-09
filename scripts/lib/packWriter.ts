/**
 * Writes compiled attachments into a pack directory and generates the pack's
 * `index.js` / `index.d.ts`, which export one literal
 * `new URL("./data/<file>", import.meta.url)` per file so bundlers emit every
 * binary and texture without configuration.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import type { BodyOcclusion, BodyOcclusionEntry } from "../../src/format/assetFormat.ts";
import type { CompiledAsset } from "./compileAsset.ts";

type Range = { offset: number; byteLength: number };

/** A garment's entry: an attachment's without the occlusion bytes. */
export interface GarmentEntry {
  id: string;
  kind: string;
  name: string;
  zDepth: number;
  vertexCount: number;
  faceCount: number;
  scale: CompiledAsset["scale"];
  material: CompiledAsset["material"];
  layout: Record<keyof CompiledAsset["arrays"], Range>;
}

export interface AttachmentEntry extends Omit<GarmentEntry, "layout"> {
  layout: GarmentEntry["layout"] & { occlusion: Range };
}

export const sha256 = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex");

export interface TextureOptions {
  /** Longest edge shipped; larger sources are scaled down, smaller ones are kept. */
  max?: number;
  /** WebP quality, 1-100. */
  quality?: number;
  /** WebP quality of normal maps (files whose name ends `_normal.webp`), default `quality`. */
  normalQuality?: number;
}

/** Longest texture edge shipped. On-screen, an eye or a mouth never needs more. */
const TEXTURE_MAX = 1024;

/**
 * Encodes a texture for the web: WebP at quality 88 with lossless alpha (the
 * eye's cornea is cut by its alpha, which must not blur), at most
 * TEXTURE_MAX pixels on a side. Output is deterministic for a sharp version.
 */
async function writeTexture(src: string, dest: string, options: TextureOptions): Promise<void> {
  const max = options.max ?? TEXTURE_MAX;
  const quality = options.quality ?? 88;
  await sharp(src)
    .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
    .webp({
      quality: dest.endsWith("_normal.webp") ? (options.normalQuality ?? quality) : quality,
      alphaQuality: 100,
      effort: 6,
    })
    .toFile(dest);
}

/** Writes the attachments' textures, replacing any left from an earlier pack. */
export async function writeAttachmentTextures(
  dataDir: string,
  assets: readonly CompiledAsset[],
  options: TextureOptions = {},
): Promise<void> {
  for (const f of fs.readdirSync(dataDir))
    if (/\.(png|jpe?g|webp)$/i.test(f)) fs.rmSync(path.join(dataDir, f));
  for (const a of assets)
    for (const [src, name] of a.textures)
      await writeTexture(src, path.join(dataDir, name), options);
}

/**
 * Packs attachment arrays and their baked occlusion (one byte per vertex per
 * bake, 255 = open: one bake per corner of the occlusion keys' cube) into one
 * 4-byte-aligned binary, gzipped. The occlusion is baked from the packed
 * figure, so the packer writes once with every vertex open, bakes, and writes
 * again; the layout is the same both times.
 */
export function writeAttachments(
  dataDir: string,
  file: string,
  assets: readonly CompiledAsset[],
  occlusion: readonly Uint8Array[] | null,
  bakes: number,
) {
  return writePacked<AttachmentEntry>(dataDir, file, assets, (a, i) => {
    const baked = occlusion?.[i] ?? new Uint8Array(a.vertexCount * bakes).fill(255);
    if (baked.length !== a.vertexCount * bakes)
      throw new Error(
        `${a.id}: ${baked.length} occlusion values for ${a.vertexCount} vertices × ${bakes} bakes`,
      );
    return [["occlusion", baked]];
  });
}

/** Packs garments: attachments without occlusion, which a garment does not carry. */
export function writeGarments(dataDir: string, file: string, assets: readonly CompiledAsset[]) {
  return writePacked<GarmentEntry>(dataDir, file, assets, () => []);
}

function writePacked<E extends GarmentEntry>(
  dataDir: string,
  file: string,
  assets: readonly CompiledAsset[],
  extra: (asset: CompiledAsset, index: number) => [string, ArrayBufferView][],
) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const entries: E[] = [];
  for (const [i, a] of assets.entries()) {
    const layout: Record<string, Range> = {};
    for (const [key, arr] of [...Object.entries(a.arrays), ...extra(a, i)] as [
      string,
      ArrayBufferView,
    ][]) {
      size = Math.ceil(size / 4) * 4;
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      layout[key] = { offset: size, byteLength: bytes.byteLength };
      chunks.push(bytes);
      size += bytes.byteLength;
    }
    entries.push({
      id: a.id,
      kind: a.kind,
      name: a.name,
      zDepth: a.zDepth,
      vertexCount: a.vertexCount,
      faceCount: a.faceCount,
      scale: a.scale,
      material: a.material,
      layout,
    } as E);
  }
  const bin = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    o = Math.ceil(o / 4) * 4;
    bin.set(c, o);
    o += c.byteLength;
  }
  // Gzipped for transfer, like every pack binary; offsets refer to the decoded file.
  const gz = new Uint8Array(gzipSync(bin, { level: 9 }));
  fs.writeFileSync(path.join(dataDir, file), gz);
  return { entries, sha256: sha256(gz), raw: bin };
}

/**
 * The body occlusion file's bytes (`BodyOcclusionEntry`): the vertex indices
 * (u32, little-endian), then the corner bakes, one byte each.
 */
export function encodeBodyOcclusion(
  occlusion: BodyOcclusion,
  keys: readonly string[],
): { raw: Uint8Array; entry: Pick<BodyOcclusionEntry, "keys" | "count"> } {
  const count = occlusion.vertices.length;
  const corners = 2 ** keys.length;
  if (occlusion.values.length !== count * corners)
    throw new Error(
      `body occlusion: ${occlusion.values.length} values for ${count} vertices × ${corners} corners`,
    );
  const raw = new Uint8Array(count * (4 + corners));
  const view = new DataView(raw.buffer);
  occlusion.vertices.forEach((v, i) => {
    view.setUint32(i * 4, v, true);
  });
  raw.set(occlusion.values, count * 4);
  return { raw, entry: { keys: [...keys], count } };
}

/** Writes the body occlusion gzipped, like every pack binary, and returns its manifest entry. */
export function writeBodyOcclusion(
  dataDir: string,
  file: string,
  occlusion: BodyOcclusion,
  keys: readonly string[],
): BodyOcclusionEntry {
  const { raw, entry } = encodeBodyOcclusion(occlusion, keys);
  const gz = new Uint8Array(gzipSync(raw, { level: 9 }));
  fs.writeFileSync(path.join(dataDir, file), gz);
  return { file, sha256: sha256(gz), ...entry };
}

/** Generates `index.js` and `index.d.ts` exporting `exportName` with a literal URL per data file. */
export function writePackEntry(packDir: string, exportName: string, description: string): void {
  const dataDir = path.join(packDir, "data");
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f !== "manifest.json" && f !== "PROVENANCE.md")
    .sort();
  const url = (f: string) => `new URL(${JSON.stringify(`./data/${f}`)}, import.meta.url).href`;
  const js = [
    "// Generated by scripts/pack-makehuman.ts; do not edit.",
    "/**",
    ` * ${description}`,
    " * Every file is a literal `new URL(..., import.meta.url)` so bundlers emit it automatically.",
    " */",
    `export const ${exportName} = {`,
    `\tmanifest: ${url("manifest.json")},`,
    "\tfiles: {",
    ...files.map((f) => `\t\t${JSON.stringify(f)}: ${url(f)},`),
    "\t},",
    "};",
    "",
  ].join("\n");
  const dts = [
    "// Generated by scripts/pack-makehuman.ts; do not edit.",
    `/** ${description} */`,
    `export declare const ${exportName}: {`,
    "\treadonly manifest: string;",
    `\treadonly files: Readonly<Record<${files.map((f) => JSON.stringify(f)).join(" | ")}, string>>;`,
    "};",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(packDir, "index.js"), js);
  fs.writeFileSync(path.join(packDir, "index.d.ts"), dts);
}
