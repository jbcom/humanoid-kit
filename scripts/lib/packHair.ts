/**
 * Packs MakeHuman's CC0 scalp hair, eyebrows and eyelashes into
 * `packs/hair/data`: one binary and one texture per style, a manifest that pins
 * the body pack it binds to, and a PROVENANCE.md. A scalp style's texture is a
 * strand map; an eyebrow's or an eyelash's is an alpha mask in white (the
 * source's own colour is near black, and the figure's hair colour tints it).
 *
 * Styles come from the MakeHuman system assets pack (`hair/<name>/`,
 * `eyebrows/<name>/`, `eyelashes/<name>/`), every file
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
  type HairKind,
  type HairManifest,
  type HairStyleEntry,
  parseHumanoidAssets,
} from "../../src/format/assetFormat.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import {
  BODY_HAIR_CARDS,
  CARD_STRAND_MAP,
  cardFields,
  generateCards,
  generateStrandMap,
} from "./bodyHairCards.ts";
import { type CompiledAsset, compileAsset } from "./compileAsset.ts";
import { sha256, writeAttachments, writePackEntry } from "./packWriter.ts";
import { strandMapFromRgba } from "./strandMap.ts";

export interface HairStyleSpec {
  /** The folder name under the system assets' `hair/`, and the style's id. */
  id: string;
  label: string;
  tags: string[];
  /**
   * Whether the hairline thins out (default true). `afro01`'s dense curls end in a
   * fuzzy edge of their own; thinned, its roots show the dark inside of the
   * volume as a band.
   */
  feather?: boolean;
  /** What the entry is; default `scalp`. Body hair cards are generated, not packed from a file. */
  kind?: AssetHairKind;
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
  { id: "afro01", label: "Afro", tags: ["short", "curly", "afro"], flatten: 0.004, feather: false },
  { id: "short04", label: "Short, slicked back", tags: ["short", "slicked"] },
  { id: "short03", label: "Short, side-swept", tags: ["short", "swept", "fringe"] },
  { id: "ponytail01", label: "Ponytail", tags: ["long", "ponytail", "tied"] },
  { id: "short01", label: "Short, textured", tags: ["short", "textured"] },
  { id: "bob01", label: "Side-swept bob", tags: ["bob", "swept", "fringe"] },
  { id: "braid01", label: "Side braid", tags: ["long", "braid", "tied"], flatten: 0.012 },
];

/**
 * The eyebrows shipped: all twelve of the system assets (decal quads of 124
 * vertices bound to the body), whose masks differ in how much they cover.
 */
export const BROW_STYLES: readonly HairStyleSpec[] = [
  { id: "eyebrow001", label: "Eyebrows 01", tags: ["medium"], kind: "brows" },
  { id: "eyebrow002", label: "Eyebrows 02", tags: ["medium"], kind: "brows" },
  { id: "eyebrow003", label: "Eyebrows 03", tags: ["medium"], kind: "brows" },
  { id: "eyebrow004", label: "Eyebrows 04", tags: ["medium"], kind: "brows" },
  { id: "eyebrow005", label: "Eyebrows 05", tags: ["medium"], kind: "brows" },
  { id: "eyebrow006", label: "Eyebrows 06, thin", tags: ["thin", "fine"], kind: "brows" },
  { id: "eyebrow007", label: "Eyebrows 07, thin", tags: ["thin", "fine"], kind: "brows" },
  { id: "eyebrow008", label: "Eyebrows 08, full", tags: ["thick"], kind: "brows" },
  { id: "eyebrow009", label: "Eyebrows 09, bushy", tags: ["thick", "bushy"], kind: "brows" },
  { id: "eyebrow010", label: "Eyebrows 10", tags: ["medium"], kind: "brows" },
  { id: "eyebrow011", label: "Eyebrows 11, fine", tags: ["thin", "fine"], kind: "brows" },
  { id: "eyebrow012", label: "Eyebrows 12, thick", tags: ["thick"], kind: "brows" },
];

/** The eyelashes shipped: all four of the system assets. */
export const LASH_STYLES: readonly HairStyleSpec[] = [
  { id: "eyelashes01", label: "Eyelashes 01", tags: ["natural"], kind: "lashes" },
  { id: "eyelashes02", label: "Eyelashes 02, full", tags: ["full"], kind: "lashes" },
  { id: "eyelashes03", label: "Eyelashes 03, full", tags: ["full"], kind: "lashes" },
  { id: "eyelashes04", label: "Eyelashes 04, full", tags: ["full"], kind: "lashes" },
];

/** The kinds packed from MakeHuman's files (body hair cards are generated: `bodyHairCards.ts`). */
type AssetHairKind = Exclude<HairKind, "beard">;

/** The folder of the system assets each kind of entry lives in. */
const SOURCE_DIR: Record<AssetHairKind, string> = {
  scalp: "hair",
  brows: "eyebrows",
  lashes: "eyelashes",
};

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
    ...(manifest.bodyOcclusion && { bodyOcclusion: gz(manifest.bodyOcclusion.file) }),
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

/**
 * A style's texture cut-out as the scalp measurement reads it: the shipped strand
 * map's alpha at no more than 256 px a side, decoded the same way by the packer
 * and by the test that re-measures the pack.
 */
export async function cutoutOf(webp: string) {
  const { data, info } = await sharp(webp)
    .resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, alpha: new Uint8Array(data) };
}

/**
 * Writes an eyebrow's or eyelash's texture: the source's alpha, with its colour
 * (near black) replaced by white, so the hair colour is the only colour it takes.
 * Its strand direction is none.
 */
export async function writeAlphaMask(src: string, dest: string) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(data.length, 255);
  for (let i = 3; i < data.length; i += 4) rgba[i] = data[i] as number;
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp({ quality: 60, alphaQuality: 85, effort: 4 })
    .toFile(dest);
  return { angle: 0, coherence: 0 };
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
    'listed as "System assets, shared under CC0" on the MakeHuman community asset packs page), directories `hair/`, `eyebrows/` and `eyelashes/`.',
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
    "Each scalp style's texture is a strand map: the source atlas's luminance, normalised to a fixed mean, with its alpha",
    "unchanged (`scripts/lib/strandMap.ts`). It carries no colour of the original atlas. For styles whose atlas has",
    "painted-in blotches (" +
      HAIR_STYLES.filter((s) => s.flatten !== undefined)
        .map((s) => `\`${s.id}\``)
        .join(", ") +
      ") the atlas's own coarse shading is also divided out.",
    "",
    "An eyebrow's or eyelash's texture is the source's alpha with its near-black colour replaced by white, so the figure's",
    "hair colour is the only colour it takes; they carry no growth, hairline, fin or scalp.",
    "",
    "Each style's binary also carries what the packer measured of its cards against the body at rest: growth,",
    "hairline fade, fin and scalp (`src/surface/hairFields.ts`).",
    "",
    "The body hair cards (" +
      "kind `beard`) come from no source file: `scripts/lib/bodyHairCards.ts` generates them over the body pack's",
    "base mesh from a seed, with their strand map, so they are this project's own work under its licence.",
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
  for (const spec of [...HAIR_STYLES, ...BROW_STYLES, ...LASH_STYLES]) {
    const kind = spec.kind ?? "scalp";
    const dir = path.join(systemDir, SOURCE_DIR[kind], spec.id);
    const compiled = compileAsset(
      path.join(dir, `${spec.id}.mhclo`),
      spec.id,
      kind === "scalp" ? "hair" : kind === "brows" ? "eyebrows" : "eyelashes",
    );
    for (const [file, ev] of Object.entries(compiled.evidence))
      evidence[path.relative(systemDir, file)] = ev;
    if (compiled.arrays.deleteVerts.length > 0)
      throw new Error(
        `${spec.id}: hair has delete_verts, which MakeHuman's hair, eyebrows and eyelashes never do`,
      );
    const [source] = [...compiled.textures.keys()];
    if (!source || compiled.textures.size !== 1)
      throw new Error(`${spec.id}: expected exactly one diffuse texture`);
    if (!TEXTURE_FILE.test(source)) throw new Error(`${spec.id}: ${source} is not an image`);

    const textureFile = `${spec.id}.webp`;
    const textureDest = path.join(outDir, textureFile);
    // An eyebrow or eyelash is a decal on the skin: a white alpha mask, with nothing
    // measured of strands, a hairline or a scalp, and nothing baked, since a lid's or a
    // brow ridge's shade is the skin's own.
    const strand =
      kind === "scalp"
        ? await writeStrandMap(source, textureDest, spec.flatten)
        : await writeAlphaMask(source, textureDest);
    compiled.material.texture = textureFile;

    const occlusion =
      kind === "scalp"
        ? Uint8Array.from(model.bakeHairOcclusion(boundFrom(compiled)), (v) =>
            Math.round(Math.min(1, Math.max(0, v)) * 255),
          )
        : new Uint8Array(compiled.vertexCount).fill(255);
    const fields =
      kind === "scalp"
        ? model.bakeHairFields(boundFrom(compiled), {
            ...(spec.feather !== undefined && { feather: spec.feather }),
            cutout: await cutoutOf(path.join(outDir, textureFile)),
          })
        : {};
    const file = `${spec.id}.bin.gz`;
    const written = writeAttachments(outDir, file, [compiled], [occlusion], 1, [fields]);
    const [entry] = written.entries;
    if (!entry) throw new Error(`${spec.id}: nothing written`);
    styles.push({
      ...entry,
      kind,
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

  // Body hair cards: generated over the base mesh from a seed, this project's own
  // bytes (`bodyHairCards.ts`), so nothing of them passes the licence gate.
  for (const spec of BODY_HAIR_CARDS(assets)) {
    const cards = generateCards(assets, spec);
    const textureFile = `${spec.id}.webp`;
    const [w, h] = CARD_STRAND_MAP;
    const map = strandMapFromRgba(generateStrandMap(w, h, spec.seed), w, h);
    await sharp(Buffer.from(map.rgba), { raw: { width: w, height: h, channels: 4 } })
      .webp({ quality: 80, alphaQuality: 85, effort: 4 })
      .toFile(path.join(outDir, textureFile));
    cards.compiled.material.texture = textureFile;
    const occlusion = Uint8Array.from(model.bakeHairOcclusion(boundFrom(cards.compiled)), (v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255),
    );
    const file = `${spec.id}.bin.gz`;
    const written = writeAttachments(outDir, file, [cards.compiled], [occlusion], 1, [
      cardFields(cards, spec.lift),
    ]);
    const [entry] = written.entries;
    if (!entry) throw new Error(`${spec.id}: nothing written`);
    styles.push({
      ...entry,
      kind: "beard",
      label: spec.label,
      tags: [spec.style],
      file,
      sha256: written.sha256,
      strand: { angle: map.strandAngle, coherence: map.coherence },
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
