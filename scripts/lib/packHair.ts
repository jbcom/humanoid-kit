/**
 * Packs MakeHuman's CC0 scalp hair into `packs/hair/data`: one binary and one
 * strand map per style, a manifest that pins the body pack it binds to, and a
 * PROVENANCE.md.
 *
 * Styles come from the MakeHuman system assets pack (`hair/<name>/`), every file
 * of which opens with "This asset was explicitly released as CC0 in september
 * 2020". `compileAsset` proves that from the `.mhclo`, the `.obj` and the
 * `.mhmat` themselves and refuses anything else, so a hair from a community
 * pack, whose licence is the uploader's claim and is sometimes contradicted by
 * a sibling file, cannot be packed by listing it here.
 *
 * It reads the committed body pack (not MakeHuman's data directory), which it
 * binds to and bakes occlusion against, so it can run alone
 * (`pnpm pack:hair <system-assets-dir>`) and `pnpm pack:data` runs it last.
 */
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import {
  type AttachmentEntry,
  type BodyManifest,
  type BoundAsset,
  type HairManifest,
  type HairStyleEntry,
  parseHumanoidAssets,
} from "../../src/format/assetFormat.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import { type CompiledAsset, compileAsset } from "./compileAsset.ts";
import { sha256, writeAttachments, writePackEntry } from "./packWriter.ts";
import { strandMapFromRgba } from "./strandMap.ts";

export interface HairStyleSpec {
  /** The folder name under the system assets' `hair/`, and the style's id. */
  id: string;
  label: string;
  tags: string[];
  /**
   * `strandMapFromRgba`'s `flatten`, for an atlas whose painted-in shading reads as a
   * net or as dirt under the renderer's own lighting (afro01's cell pattern, braid01's
   * dark blotches). The sigma must be well under the blotch size to follow it, and
   * well over a strand's width to leave the strands alone.
   */
  flatten?: number;
}

/**
 * The styles shipped, best first: broad silhouettes before niche ones. Chosen
 * from the audit of the system pack (cards, binding range, polygon cost); the
 * ten are every scalp hair in it.
 */
export const HAIR_STYLES: readonly HairStyleSpec[] = [
  { id: "short02", label: "Short, tousled", tags: ["short", "tousled"] },
  { id: "bob02", label: "Bob with a side fringe", tags: ["bob", "straight", "fringe"] },
  { id: "long01", label: "Long, straight", tags: ["long", "straight"] },
  { id: "afro01", label: "Afro", tags: ["short", "curly", "afro"], flatten: 0.007 },
  { id: "short04", label: "Short, slicked back", tags: ["short", "slicked"] },
  { id: "short03", label: "Short, side-swept", tags: ["short", "swept", "fringe"] },
  { id: "ponytail01", label: "Ponytail", tags: ["long", "ponytail", "tied"] },
  { id: "short01", label: "Short, textured", tags: ["short", "textured"] },
  { id: "bob01", label: "Side-swept bob", tags: ["bob", "swept", "fringe"] },
  { id: "braid01", label: "Side braid", tags: ["long", "braid", "tied"], flatten: 0.012 },
];

/** Longest strand-map edge shipped: hair covers the head, which fills a fraction of the screen. */
const TEXTURE_MAX = 1024;

/** The source archive audited for these styles (see docs/research/HAIR-COLOUR.md and PROVENANCE.md). */
const SOURCE_ARCHIVE = "makehuman_system_assets_cc0.zip";
const SOURCE_ARCHIVE_SHA256 = "b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107";

const TEXTURE_FILE = /\.(png|jpe?g|webp)$/i;

export interface PackHairOptions {
  /** The extracted MakeHuman system assets pack (holds `hair/<style>/`). */
  systemDir: string;
  /** The body pack's data directory: what the hair binds to and bakes against. */
  bodyDir: string;
  /** The hair pack's data directory. */
  outDir: string;
}

/** The committed body pack, parsed with every target file, as the hair is baked against it. */
function readBody(bodyDir: string) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bodyDir, "manifest.json"), "utf8"),
  ) as BodyManifest;
  const gz = (file: string): ArrayBuffer => {
    const b = gunzipSync(fs.readFileSync(path.join(bodyDir, file)));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const assets = parseHumanoidAssets({
    manifest,
    body: gz(manifest.body.file),
    targets: Object.fromEntries(manifest.targets.map((f) => [f.id, gz(f.file)])),
    attachments: gz(manifest.attachments.file),
  });
  return { manifest, assets };
}

/** Writes a style's strand map and measures its strand direction. */
export async function writeStrandMap(src: string, dest: string, flatten?: number) {
  const { data, info } = await sharp(src)
    .resize({ width: TEXTURE_MAX, height: TEXTURE_MAX, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const map = strandMapFromRgba(
    new Uint8Array(data),
    info.width,
    info.height,
    flatten === undefined ? {} : { flatten },
  );
  await sharp(Buffer.from(map.rgba), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    // Lossy alpha: a strand's edge moving by a level is invisible, and lossless alpha is most of a curly style's size.
    .webp({ quality: 80, alphaQuality: 85, effort: 4 })
    .toFile(dest);
  return { angle: map.strandAngle, coherence: map.coherence };
}

/** What `bakeHairOcclusion` and the binding evaluation need of a compiled style: its arrays and entry. */
function boundFrom(c: CompiledAsset): BoundAsset {
  const zero = { offset: 0, byteLength: 0 };
  const entry: AttachmentEntry = {
    id: c.id,
    kind: c.kind,
    name: c.name,
    zDepth: c.zDepth,
    vertexCount: c.vertexCount,
    faceCount: c.faceCount,
    scale: c.scale,
    material: c.material,
    layout: {
      refVerts: zero,
      weights: zero,
      offsets: zero,
      faceVerts: zero,
      faceUvs: zero,
      uvs: zero,
      deleteVerts: zero,
      occlusion: zero,
    },
  };
  return { entry, ...c.arrays, occlusion: new Uint8Array(c.vertexCount) };
}

function writeProvenance(
  dir: string,
  evidence: Record<string, string>,
  outputs: [string, string][],
): void {
  const byKind = new Map<string, string[]>();
  for (const [file, ev] of Object.entries(evidence))
    byKind.set(ev, [...(byKind.get(ev) ?? []), file]);
  const lines = [
    "# humanoid-kit-hair data provenance",
    "",
    "Generated by `scripts/pack-makehuman.ts` (or `pnpm pack:hair`); do not edit.",
    "",
    `Source: the MakeHuman system assets pack (\`${SOURCE_ARCHIVE}\`, sha256 \`${SOURCE_ARCHIVE_SHA256}\`,`,
    'listed as "System assets, shared under CC0" on the MakeHuman community asset packs page), directory `hair/`.',
    'Only asset data is used; no MakeHuman code. "MakeHuman" is the upstream project\'s name; this package is not',
    "affiliated with it, and CC0 does not license trademarks (CC0 1.0 §4a).",
    "",
    "Every source file was checked for CC0 from its own content before packing; each style's `.mhclo`, `.obj` and",
    "`.mhmat` had to carry the header, and a texture is accepted only through the `.mhmat` that references it:",
    "",
    ...[...byKind].map(
      ([ev, files]) =>
        `- ${files.length} file(s) — ${ev}${files.length <= 4 ? `: ${files.join(", ")}` : ""}`,
    ),
    "",
    "Each shipped texture is a strand map: the source atlas's luminance, normalised to a fixed mean, with its alpha",
    "unchanged (`scripts/lib/strandMap.ts`). It carries no colour of the original atlas.",
    "",
    "| Output | SHA-256 |",
    "| --- | --- |",
    ...outputs.map(([f, h]) => `| ${f} | \`${h}\` |`),
    "",
  ];
  fs.writeFileSync(path.join(dir, "PROVENANCE.md"), lines.join("\n"));
}

/** Packs every style of `HAIR_STYLES` and returns the manifest it wrote. */
export async function packHair(options: PackHairOptions): Promise<HairManifest> {
  const { systemDir, bodyDir, outDir } = options;
  const { manifest: body, assets } = readBody(bodyDir);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir))
    if (/\.(bin\.gz|webp)$/.test(f)) fs.rmSync(path.join(outDir, f));
  const model = new HumanoidModel(assets);

  const evidence: Record<string, string> = {};
  const styles: HairStyleEntry[] = [];
  const outputs: [string, string][] = [];
  for (const spec of HAIR_STYLES) {
    const dir = path.join(systemDir, "hair", spec.id);
    const compiled = compileAsset(path.join(dir, `${spec.id}.mhclo`), spec.id, "hair");
    for (const [file, ev] of Object.entries(compiled.evidence))
      evidence[path.relative(systemDir, file)] = ev;
    if (compiled.arrays.deleteVerts.length > 0)
      throw new Error(`${spec.id}: hair has delete_verts, which MakeHuman's hair never does`);
    const [source] = [...compiled.textures.keys()];
    if (!source || compiled.textures.size !== 1)
      throw new Error(`${spec.id}: expected exactly one diffuse texture`);
    if (!TEXTURE_FILE.test(source)) throw new Error(`${spec.id}: ${source} is not an image`);

    const textureFile = `${spec.id}.webp`;
    const strand = await writeStrandMap(source, path.join(outDir, textureFile), spec.flatten);
    compiled.material.texture = textureFile;

    const occlusion = Uint8Array.from(model.bakeHairOcclusion(boundFrom(compiled)), (v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255),
    );
    const file = `${spec.id}.bin.gz`;
    const written = writeAttachments(outDir, file, [compiled], [occlusion], 1);
    const [entry] = written.entries;
    if (!entry) throw new Error(`${spec.id}: nothing written`);
    styles.push({
      ...entry,
      label: spec.label,
      tags: spec.tags,
      file,
      sha256: written.sha256,
      strand,
    });
    outputs.push([file, written.sha256]);
    outputs.push([
      textureFile,
      sha256(new Uint8Array(fs.readFileSync(path.join(outDir, textureFile)))),
    ]);
  }

  const manifest: HairManifest = {
    format: 1,
    kind: "hair",
    topology: body.topology,
    bodySha256: body.body.sha256,
    source: {
      project: `MakeHuman system assets (${SOURCE_ARCHIVE}, github.com/makehumancommunity/makehuman asset packs)`,
      commit: `release archive, sha256 ${SOURCE_ARCHIVE_SHA256}`,
      license: "CC0-1.0",
      note: "Asset data only; no MakeHuman code. Textures are luminance strand maps.",
    },
    styles,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  writeProvenance(outDir, evidence, outputs);
  writePackEntry(
    path.dirname(outDir),
    "hairPack",
    "URLs of the humanoid-kit-hair pack files. Pass to `loadHumanoidAssets({ hair })`.",
  );
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  console.log(
    `packed ${styles.length} hair styles: ` +
      styles
        .map(
          (s) =>
            `${s.id} ${kb(fs.statSync(path.join(outDir, s.file)).size + fs.statSync(path.join(outDir, s.material.texture as string)).size)}`,
        )
        .join(", "),
  );
  return manifest;
}
