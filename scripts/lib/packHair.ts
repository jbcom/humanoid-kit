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
 * `.mhmat` themselves and refuses anything else. The facial attachments below
 * are the exception: they are admitted only after this pack's explicit asset
 * licence profile has selected a verified redistributable record, while its
 * generated notice keeps every conflicting source header and source archive.
 *
 * It reads the committed body pack (not MakeHuman's data directory), which it
 * binds to and bakes occlusion against, so it can run alone
 * (`pnpm pack:hair <system-assets-dir>`) and `pnpm pack:data` runs it last.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type {
  AttachmentEntry,
  BoundAsset,
  HairKind,
  HairManifest,
  HairStyleEntry,
} from "../../src/format/assetFormat.ts";
import { evaluateBinding } from "../../src/mhclo/bound.ts";
import { HumanoidModel } from "../../src/model/humanoidModel.ts";
import {
  type AssetLicenceProfile,
  type AssetLicenceRecord,
  type AssetProfileSelection,
  DEFAULT_ASSET_LICENCE_PROFILE,
  renderAssetAttribution,
  selectAssetForProfile,
} from "./assetLicenceProfile.ts";
import { readBodyPack } from "./bodyPack.ts";
import { extractDirectory, openCommunityPack, pin } from "./communityPacks.ts";
import { type CompiledAsset, compileAsset } from "./compileAsset.ts";
import { bleedEdges } from "./edgeBleed.ts";
import { compileAuthored } from "./hairCards/compile.ts";
import { BodySurface, HeadFrame } from "./hairCards/head.ts";
import {
  AUTHORED_STYLES,
  type AuthoredStyleSpec,
  DERIVED_STYLES,
  type DerivedStyleSpec,
} from "./hairCards/index.ts";
import { texelField } from "./hairCards/uvField.ts";
import { sha256, writeAttachments, writePackEntry } from "./packWriter.ts";
import { strandMapFromRgba } from "./strandMap.ts";
import { TEXTURE_CEILING } from "./texelBudget.ts";
import { packTexture, type TextureRecord, textureProvenance } from "./textureSizing.ts";

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
  /** What the entry is; default `scalp`. */
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

/** The kinds packed from MakeHuman's system files; facial hair comes from `FACIAL_HAIR`. */
type AssetHairKind = Exclude<HairKind, "beard" | "facial">;

/** The community pack the facial hair comes from, pinned (downloaded 2026-10-13). */
export const FACIAL_HAIR_PACK = pin(
  "bodyparts05",
  "262bba42246f85b2a91f493dd920296b258a3b4544eb495c91c4d08e57c528fd",
);

/** Additional MakeHuman Community facial-hair attachments, whose source records are CC-BY. */
export const COMMERCIAL_FACIAL_HAIR_PACK = pin(
  "bodyparts06",
  "09ed71439c853eac01a92f6e4463f15d0701f08b7d9ff777771d10c3e590e770",
  { archive: "bodyparts06_cc-by.zip" },
);

/** A community facial hair asset: its folder in the pack, the id it ships as and what it is. */
export interface FacialHairSpec {
  /** The pinned MakeHuman Community archive this asset belongs to. */
  pack: typeof FACIAL_HAIR_PACK;
  /** The asset's directory under the pack's `clothes/`. */
  dir: string;
  id: string;
  label: string;
  /** `beard` or `moustache` first: the slot it is worn in. */
  tags: [string, ...string[]];
  /** Licence and credit proof used by the selected asset-licence profile. */
  licence: AssetLicenceRecord;
}

const CC0_FACIAL_LICENCE = (id: string, author: string, source: string): AssetLicenceRecord => ({
  id,
  author,
  source,
  licence: {
    selected: "CC0-1.0",
    permitsCommercialUse: true,
    permitsRedistribution: true,
    attribution: "none",
    shareAlike: "none",
  },
  modifications:
    "Converted the MakeHuman MHCLO/OBJ attachment and its diffuse texture into the hair-pack binary and luminance strand map; source mesh topology and hm08 binding are retained.",
});

const CC_BY_FACIAL_LICENCE = (id: string, author: string, source: string): AssetLicenceRecord => ({
  id,
  author,
  source,
  licence: {
    selected: "CC-BY (official bodyparts06 record and source file headers)",
    permitsCommercialUse: true,
    permitsRedistribution: true,
    attribution: "required",
    shareAlike: "none",
  },
  attribution: `${author} — ${id}, MakeHuman Community bodyparts06, CC-BY. Modified by jbcom for humanoid-kit; see the pack attribution for the source and modification details.`,
  modifications:
    "Converted the MakeHuman MHCLO/OBJ attachment and its diffuse texture into the hair-pack binary and luminance strand map; source mesh topology and hm08 binding are retained.",
});

const CONFLICTING_FACIAL_LICENCE = (
  id: string,
  author: string,
  source: string,
  sourceHeader: string,
): AssetLicenceRecord => ({
  id,
  author,
  source,
  licence: {
    selected: `CC-BY (official bodyparts06 record); AGPL3 ${sourceHeader} source header`,
    permitsCommercialUse: true,
    permitsRedistribution: true,
    attribution: "required",
    shareAlike: "required",
  },
  attribution: `${author} — ${id}, MakeHuman Community bodyparts06. The official pack record says CC-BY while ${sourceHeader} source files say AGPL3; this pack preserves the conflict and the source-header copyleft notice. Modified by jbcom for humanoid-kit.`,
  modifications:
    "Converted the MakeHuman MHCLO/OBJ attachment and its diffuse texture into the hair-pack binary and luminance strand map; source mesh topology and hm08 binding are retained.",
});

/** Every reviewed MakeHuman Community facial-hair asset, selected by the build profile. */
export const FACIAL_HAIR: readonly FacialHairSpec[] = [
  {
    pack: FACIAL_HAIR_PACK,
    dir: "culturalibre_faun_beard",
    id: "beard-faun",
    label: "Faun beard",
    tags: ["beard", "long"],
    licence: CC0_FACIAL_LICENCE(
      "beard-faun",
      "culturalibre",
      "http://www.makehumancommunity.org/node/2356",
    ),
  },
  {
    pack: FACIAL_HAIR_PACK,
    dir: "grinsegold_beard_sigmund_wip",
    id: "beard-sigmund",
    label: "Sigmund beard",
    tags: ["beard", "short", "full"],
    licence: CC0_FACIAL_LICENCE(
      "beard-sigmund",
      "grinsegold",
      "http://www.makehumancommunity.org/node/877",
    ),
  },
  {
    pack: FACIAL_HAIR_PACK,
    dir: "rehmanpolanski_beard_viking",
    id: "beard-viking",
    label: "Viking beard",
    tags: ["beard", "long", "full"],
    licence: CC0_FACIAL_LICENCE(
      "beard-viking",
      "rehmanpolanski",
      "http://www.makehumancommunity.org/node/2614",
    ),
  },
  {
    pack: FACIAL_HAIR_PACK,
    dir: "rehmanpolanski_moustache_viking",
    id: "moustache-viking",
    label: "Viking moustache",
    tags: ["moustache", "long"],
    licence: CC0_FACIAL_LICENCE(
      "moustache-viking",
      "rehmanpolanski",
      "http://www.makehumancommunity.org/node/2615",
    ),
  },
  {
    pack: FACIAL_HAIR_PACK,
    dir: "wdg_scruffy_beard",
    id: "beard-scruffy",
    label: "Scruffy beard",
    tags: ["beard", "short"],
    licence: CC0_FACIAL_LICENCE(
      "beard-scruffy",
      "wdg",
      "http://www.makehumancommunity.org/node/1769",
    ),
  },
  {
    pack: COMMERCIAL_FACIAL_HAIR_PACK,
    dir: "culturalibre_dal_moustache",
    id: "moustache-dal",
    label: "Dal moustache",
    tags: ["moustache", "short"],
    licence: CONFLICTING_FACIAL_LICENCE(
      "moustache-dal",
      "culturalibre",
      "http://www.makehumancommunity.org/node/2872",
      "OBJ",
    ),
  },
  {
    pack: COMMERCIAL_FACIAL_HAIR_PACK,
    dir: "elvs_scruffy_beard1",
    id: "beard-long-scruffy",
    label: "Long scruffy beard",
    tags: ["beard", "long", "scruffy"],
    licence: CC_BY_FACIAL_LICENCE(
      "beard-long-scruffy",
      "Elvaerwyn",
      "http://www.makehumancommunity.org/node/2611",
    ),
  },
  {
    pack: COMMERCIAL_FACIAL_HAIR_PACK,
    dir: "grinsegold_full_beard",
    id: "beard-black-full",
    label: "Black full beard",
    tags: ["beard", "short", "full"],
    licence: CONFLICTING_FACIAL_LICENCE(
      "beard-black-full",
      "grinsegold",
      "http://www.makehumancommunity.org/node/188",
      "MHCLO and OBJ",
    ),
  },
  {
    pack: COMMERCIAL_FACIAL_HAIR_PACK,
    dir: "grinsegold_moustache",
    id: "moustache-thin-black",
    label: "Thin black moustache",
    tags: ["moustache", "thin"],
    licence: CONFLICTING_FACIAL_LICENCE(
      "moustache-thin-black",
      "grinsegold",
      "http://www.makehumancommunity.org/node/187",
      "MHCLO and OBJ",
    ),
  },
];

/** The profile decision for every known facial asset; exported for focused intake tests. */
export function selectFacialHair(profile: AssetLicenceProfile): readonly AssetProfileSelection[] {
  return FACIAL_HAIR.map((spec) => selectAssetForProfile(profile, spec.licence));
}

/** The folder of the system assets each kind of entry lives in. */
const SOURCE_DIR: Record<AssetHairKind, string> = {
  scalp: "hair",
  brows: "eyebrows",
  lashes: "eyelashes",
};

/**
 * The default longest edge of a strand map: a style that needs more at the
 * face's framing gets it, up to its source's (`scripts/lib/textureSizing.ts`).
 */
const TEXTURE_FLOOR = 1024;

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
  /** The community archives (`<id>/<id>_cc0.zip`): the facial hair's pack, pinned (`FACIAL_HAIR_PACK`). */
  communityDir: string;
  /** Which verified third-party facial assets this build may ship. */
  assetLicenceProfile?: AssetLicenceProfile;
}

/** Writes a style's strand map, at most `edge` texels a side, and measures its strand direction. */
export async function writeStrandMap(src: string, dest: string, edge: number, flatten?: number) {
  const { data, info } = await sharp(src)
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // A card's faint edge texels carry the atlas's dark backdrop; bled from the
  // strands beside them, the edge filters toward the strands' own colour rather
  // than drawing a dark wire. Bled before the map is made, so its normalisation
  // to the strand mean counts the faint edge as it will be drawn; and again
  // after, so its clear texels carry their neighbours' grey rather than the
  // map's one flat fill (they weigh nothing in its mean).
  const map = strandMapFromRgba(
    bleedEdges(new Uint8Array(data), info.width, info.height),
    info.width,
    info.height,
    flatten === undefined ? {} : { flatten },
  );
  bleedEdges(map.rgba, info.width, info.height);
  await sharp(Buffer.from(map.rgba), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    // Lossy alpha: a strand's edge moving by a level is invisible, and lossless alpha is most of a curly style's size.
    // `exact` keeps the bled colour under clear texels, which the encoder would otherwise rewrite.
    .webp({ quality: 80, alphaQuality: 85, effort: 4, exact: true })
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
 * (near black) replaced by white, so the hair colour is the only colour it takes,
 * at most `edge` texels a side. Its strand direction is none.
 */
export async function writeAlphaMask(src: string, dest: string, edge: number) {
  const { data, info } = await sharp(src)
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
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
  textures: readonly TextureRecord[],
  facialEvidence: readonly string[],
  profile: AssetLicenceProfile,
  facialSelections: ReadonlyMap<string, AssetProfileSelection>,
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
    "Every source file was checked for CC0 from its own content before packing (`scripts/lib/licenceRule.ts`): each",
    "style's text files (`.mhclo`, `.obj`, `.mhmat`) had to carry the header, and a texture or other binary file is",
    "accepted only as a file of such an asset. Each file is listed under the evidence that admitted it:",
    "",
    ...[...byKind].map(
      ([ev, files]) => `- ${files.length} file(s) — ${ev}: ${[...files].sort().join(", ")}`,
    ),
    "",
    "The styles marked 'authored by the packer' above are not MakeHuman's: their cards are generated by",
    "`scripts/lib/hairCards` (tubes along paths over the figure's head) and their strand maps drawn from vector shapes,",
    "so there is no source file to prove. Nothing of anyone's was read, traced or sampled; photographs of braids, twists",
    "and locs informed proportions only. They are bound to the same CC0 base mesh as every other attachment.",
    "",
    ...DERIVED_STYLES.map(
      (d) =>
        `\`${d.id}\` keeps the cards of \`${d.from}\` (geometry, binding and cut-out: CC0, proved above) and draws its own strand map inside that cut-out.`,
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
    `The facial hair (kind \`facial\`) is selected with the \`${profile}\` asset-licence profile. Each selected asset`,
    "is bound to the base mesh by its own `.mhclo` and packed like scalp hair: its texture is a strand map (luminance",
    "normalised, alpha unchanged), so the figure's hair colour is the only colour it takes. `ASSET-ATTRIBUTION.md`",
    "carries the required credit and copyleft notices for attribution-licensed entries.",
    "",
    ...FACIAL_HAIR.map((spec) => {
      const selection = facialSelections.get(spec.id);
      if (!selection) throw new Error(`${spec.id}: no asset-licence selection for provenance`);
      return selection.included
        ? `- \`${spec.id}\` from \`${spec.dir}\` in \`${spec.pack.archive}\` (<${spec.pack.url}>, sha256 \`${spec.pack.sha256}\`), selected as \`${spec.licence.licence.selected}\``
        : `- \`${spec.id}\` unavailable under \`${profile}\`: \`${selection.unavailable.reason}\` (${selection.unavailable.licence}; <${selection.unavailable.source}>)`;
    }),
    "",
    ...facialEvidence.map((line) => `- ${line}`),
    "",
    ...textureProvenance(textures),
    "## Outputs",
    "",
    "| Output | SHA-256 |",
    "| --- | --- |",
    ...outputs.map(([f, h]) => `| ${f} | \`${h}\` |`),
    "",
  ];
  fs.writeFileSync(path.join(dir, "PROVENANCE.md"), lines.join("\n"));
}

/**
 * Makes the complete, pinned upstream source for the non-CC0 attachments
 * discoverable without copying it into this generated runtime pack. The archive
 * carries the original OBJ, MHCLO, MHMAT and textures; the emitted binary and
 * WebP are the only transformed files.
 */
export function writeAssetSources(
  dir: string,
  profile: AssetLicenceProfile,
  facialSelections: ReadonlyMap<string, AssetProfileSelection>,
): void {
  const selected = FACIAL_HAIR.filter((spec) => {
    const selection = facialSelections.get(spec.id);
    return selection?.included && spec.pack.id === COMMERCIAL_FACIAL_HAIR_PACK.id;
  });
  const lines = [
    "# Source availability for attributed facial attachments",
    "",
    "Generated by the packer; do not edit.",
    "",
    `This \`${profile}\` build includes the selected Bodyparts06 attachments from the pinned source archive`,
    `<${COMMERCIAL_FACIAL_HAIR_PACK.url}> (SHA-256 \`${COMMERCIAL_FACIAL_HAIR_PACK.sha256}\`).`,
    "The source archive contains each original MHCLO binding, OBJ mesh, MHMAT and texture under the paths below.",
    "For attachments with AGPL3 source headers, this package also distributes the exact unmodified source subset in `../source/bodyparts06/` and the named licence text in `../source/AGPL-3.0.txt`.",
    "No MakeHuman program code is included. To reproduce these data files, obtain that archive, verify its hash, then run",
    "`pnpm pack:hair --asset-license-profile commercial <system-assets-dir> <archive-root>` against this source revision.",
    "",
    "## Source paths and transformations",
    "",
    ...selected.map(
      (spec) =>
        `- \`${spec.id}\`: ` +
        `\`clothes/${spec.dir}/**\` (original MHCLO, OBJ, MHMAT and textures); ` +
        `the packer reads the MHCLO-selected OBJ, MHMAT and diffuse texture, retains the hm08 binding and mesh topology, ` +
        `writes \`${spec.id}.bin.gz\`, and converts its diffuse texture to the luminance-only strand map \`${spec.id}.webp\`.`,
    ),
    "",
  ];
  fs.writeFileSync(path.join(dir, "ASSET-SOURCES.md"), lines.join("\n"));
}

/** Packs every style of `HAIR_STYLES` and returns the manifest it wrote. */
export async function packHair(options: PackHairOptions): Promise<HairManifest> {
  const {
    systemDir,
    bodyDir,
    outDir,
    communityDir,
    assetLicenceProfile: profile = DEFAULT_ASSET_LICENCE_PROFILE,
  } = options;
  const { manifest: body, assets } = readBodyPack(bodyDir);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir))
    if (/\.(bin\.gz|webp)$/.test(f)) fs.rmSync(path.join(outDir, f));
  const model = new HumanoidModel(assets);

  const evidence: Record<string, string> = {};
  const styles: HairStyleEntry[] = [];
  const outputs: [string, string][] = [];
  const textures: TextureRecord[] = [];
  const rest = model.restHead();
  const head = new HeadFrame(rest);
  const surface = new BodySurface(rest, head);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hk-hair-"));
  for (const spec of [
    ...HAIR_STYLES,
    ...DERIVED_STYLES,
    ...AUTHORED_STYLES,
    ...BROW_STYLES,
    ...LASH_STYLES,
  ]) {
    const authored: AuthoredStyleSpec | undefined = "build" in spec ? spec : undefined;
    const kind = ("kind" in spec && spec.kind) || "scalp";
    let compiled: CompiledAsset;
    let source: string | undefined;
    // What the provenance names as a generated texture's source (a scratch file is no source).
    let sourceLabel: string | undefined;
    let roots: number[] | undefined;
    if (authored) {
      const cards = authored.build({ head, body: surface });
      roots = cards.roots;
      compiled = compileAuthored(
        spec.id,
        spec.label,
        cards,
        rest,
        `${spec.id}.webp`,
        authored.provenance,
      );
      source = path.join(scratch, `${spec.id}.png`);
      fs.writeFileSync(source, await authored.atlas());
      sourceLabel = "authored by the packer";
    } else {
      // A derived style keeps a MakeHuman style's cards and draws its own strand map in their cut-out.
      const derived: DerivedStyleSpec | undefined = "from" in spec ? spec : undefined;
      const from = derived?.from ?? spec.id;
      const dir = path.join(systemDir, SOURCE_DIR[kind], from);
      compiled = compileAsset(
        path.join(dir, `${from}.mhclo`),
        spec.id,
        kind === "scalp" ? "hair" : kind === "brows" ? "eyebrows" : "eyelashes",
      );
      [source] = [...compiled.textures.keys()];
      if (!source || compiled.textures.size !== 1)
        throw new Error(`${spec.id}: expected exactly one diffuse texture`);
      if (derived) {
        // Drawn at the cut-out's own resolution (up to the ceiling); the packed edge
        // is then chosen like any other texture's (`packTexture`).
        const { data, info } = await sharp(source)
          .resize({
            width: TEXTURE_CEILING,
            height: TEXTURE_CEILING,
            fit: "inside",
            withoutEnlargement: true,
          })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const alpha = new Uint8Array(info.width * info.height);
        for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3] as number;
        const { keepAt } = derived;
        const density = keepAt
          ? texelField(
              {
                positions: evaluateBinding(
                  {
                    ...compiled.arrays,
                    entry: { scale: compiled.scale, vertexCount: compiled.vertexCount },
                  },
                  rest.positions,
                  new Float32Array(compiled.vertexCount * 3),
                ),
                faceVerts: compiled.arrays.faceVerts,
                faceUvs: compiled.arrays.faceUvs,
                uvs: compiled.arrays.uvs,
              },
              head,
              info.width,
              info.height,
              keepAt,
            )
          : undefined;
        sourceLabel = `drawn in the cut-out of ${path.relative(systemDir, source)}`;
        source = path.join(scratch, `${spec.id}.png`);
        fs.writeFileSync(
          source,
          await derived.atlas({ width: info.width, height: info.height, alpha }, density),
        );
      }
    }
    for (const [file, ev] of Object.entries(compiled.evidence))
      evidence[authored ? file : path.relative(systemDir, file)] = ev;
    if (compiled.arrays.deleteVerts.length > 0)
      throw new Error(
        `${spec.id}: hair has delete_verts, which MakeHuman's hair, eyebrows and eyelashes never do`,
      );
    if (!TEXTURE_FILE.test(source)) throw new Error(`${spec.id}: ${source} is not an image`);

    const textureFile = `${spec.id}.webp`;
    // An eyebrow or eyelash is a decal on the skin: a white alpha mask, with nothing
    // measured of strands, a hairline or a scalp, and nothing baked, since a lid's or a
    // brow ridge's shade is the skin's own.
    const flatten = "flatten" in spec ? spec.flatten : undefined;
    const { record, encoded: strand } = await packTexture({
      asset: compiled,
      source,
      ...(sourceLabel && { sourceLabel }),
      dest: path.join(outDir, textureFile),
      floor: TEXTURE_FLOOR,
      base: assets.positions,
      systemDir,
      encode: (src, dest, edge) =>
        kind === "scalp"
          ? writeStrandMap(src, dest, edge, flatten)
          : writeAlphaMask(src, dest, edge),
    });
    textures.push(record);
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
            ...("fins" in spec && { fins: spec.fins }),
            ...("fillHoles" in spec && { fillHoles: spec.fillHoles }),
            ...(roots && { roots }),
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
  // Facial hair is kept as the source's own MHCLO/OBJ attachment. The profile selects
  // attribution-licensed entries before any archive is unpacked; it never substitutes an
  // omitted asset with generated geometry.
  const facialSelections = new Map(
    FACIAL_HAIR.map((spec) => [spec.id, selectAssetForProfile(profile, spec.licence)]),
  );
  const communities = new Map<string, ReturnType<typeof openCommunityPack>>();
  const communityFor = (spec: FacialHairSpec) => {
    let community = communities.get(spec.pack.id);
    if (!community) {
      community = openCommunityPack(communityDir, spec.pack);
      communities.set(spec.pack.id, community);
    }
    return community;
  };
  const facialEvidence: string[] = [];
  for (const spec of FACIAL_HAIR) {
    const selection = facialSelections.get(spec.id);
    if (!selection) throw new Error(`${spec.id}: no asset-licence selection`);
    if (!selection.included) continue;
    const community = communityFor(spec);
    const record = community.records[spec.dir];
    if (!record) throw new Error(`${spec.pack.id} has no record of ${spec.dir}`);
    const expectedRecordLicence = spec.pack.id === "bodyparts05" ? "CC0" : "CC-BY";
    if (record.license !== expectedRecordLicence)
      throw new Error(
        `${spec.dir}: the ${spec.pack.id} record says ${record.license}, not ${expectedRecordLicence}`,
      );
    const folder = path.join(scratch, spec.pack.id, spec.dir);
    extractDirectory(community.zip, `clothes/${spec.dir}`, folder);
    const mhclo = fs.readdirSync(folder).find((f) => f.endsWith(".mhclo"));
    if (!mhclo) throw new Error(`${spec.dir}: no .mhclo`);
    const compiled = compileAsset(path.join(folder, mhclo), spec.id, "hair", {
      page: {
        url: record.source,
        submitter: record.author,
        submitted: record.created,
        licence: spec.licence.licence.selected,
        retrieved: "2026-10-13",
      },
      ...(spec.pack.id === COMMERCIAL_FACIAL_HAIR_PACK.id
        ? {
            externalLicenceEvidence:
              `${spec.licence.licence.selected}; official record <${record.source}>; ` +
              `pinned archive <${spec.pack.url}> sha256 ${spec.pack.sha256}`,
          }
        : {}),
    });
    const [source] = [...compiled.textures.keys()];
    if (!source || compiled.textures.size !== 1)
      throw new Error(`${spec.id}: expected exactly one diffuse texture`);
    const textureFile = `${spec.id}.webp`;
    const { record: textureRecord, encoded: strand } = await packTexture({
      asset: compiled,
      source,
      dest: path.join(outDir, textureFile),
      floor: TEXTURE_FLOOR,
      base: assets.positions,
      systemDir: path.join(scratch, FACIAL_HAIR_PACK.id),
      encode: (src, dest, edge) => writeStrandMap(src, dest, edge),
    });
    textures.push(textureRecord);
    compiled.material.texture = textureFile;
    const occlusion = Uint8Array.from(model.bakeHairOcclusion(boundFrom(compiled)), (v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255),
    );
    const fields = model.bakeHairFields(boundFrom(compiled), {
      feather: false,
      cutout: await cutoutOf(path.join(outDir, textureFile)),
    });
    const file = `${spec.id}.bin.gz`;
    const written = writeAttachments(outDir, file, [compiled], [occlusion], 1, [fields]);
    const [entry] = written.entries;
    if (!entry) throw new Error(`${spec.id}: nothing written`);
    styles.push({
      ...entry,
      kind: "facial",
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
    for (const [f, ev] of Object.entries(compiled.evidence))
      facialEvidence.push(`${spec.pack.archive}: clothes/${spec.dir}/${path.basename(f)} — ${ev}`);
  }
  fs.rmSync(scratch, { recursive: true, force: true });

  const manifest = {
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
    assetLicenceProfile: {
      profile,
      attributionFile: "ASSET-ATTRIBUTION.md",
      sourceAvailabilityFile: "ASSET-SOURCES.md",
      selections: FACIAL_HAIR.map((spec) => facialSelections.get(spec.id)),
    },
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  const included = [...facialSelections.values()].filter((selection) => selection?.included);
  fs.writeFileSync(
    path.join(outDir, "ASSET-ATTRIBUTION.md"),
    `<!-- markdownlint-disable MD034 -->\n${renderAssetAttribution(included)}`,
  );
  outputs.push([
    "ASSET-ATTRIBUTION.md",
    sha256(new Uint8Array(fs.readFileSync(path.join(outDir, "ASSET-ATTRIBUTION.md")))),
  ]);
  writeAssetSources(outDir, profile, facialSelections);
  outputs.push([
    "ASSET-SOURCES.md",
    sha256(new Uint8Array(fs.readFileSync(path.join(outDir, "ASSET-SOURCES.md")))),
  ]);
  writeProvenance(outDir, evidence, outputs, textures, facialEvidence, profile, facialSelections);
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
  return manifest as HairManifest;
}
