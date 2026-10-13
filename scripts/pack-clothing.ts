/**
 * Packs the clothing pack (`humanoid-kit-clothing`): CC0 garments from the
 * MakeHuman system assets pack and the community's clothing packs, bound to the
 * body pack's hm08 base mesh.
 *
 *   node scripts/pack-clothing.ts <system-assets-dir> <community-archives-dir>
 *
 * The first argument is the extracted "MakeHuman system assets" pack
 * (makehuman_system_assets_cc0.zip), the same directory `pack-makehuman.ts`
 * reads eyes, teeth and tongue from. The second holds the community packs'
 * archives, each `<id>/<id>_cc0.zip` and checked against its pin
 * (`scripts/lib/communityGarments.ts`). Only asset files are read; no MakeHuman
 * code is used. The pack is built against the body pack committed in
 * `packs/body/data` and records its `body.sha256`, which the loader checks.
 *
 * Every source file must pass the licence rule (`compileAsset`): a system
 * asset by its own bytes, which open with "This asset was explicitly released
 * as CC0 in september 2020" (clause A); a community garment by its asset page,
 * which states CC0 (clause B). A texture inherits the licence of the material
 * that names it. Packing is deterministic for a given `sharp` version.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ClothingManifest, GarmentEntry } from "../src/format/assetFormat.ts";
import type { GARMENT_LAYERS } from "../src/model/outfit.ts";
import { readBodyPack } from "./lib/bodyPack.ts";
import { COMMUNITY_CLOTHING_PACKS, COMMUNITY_GARMENTS } from "./lib/communityGarments.ts";
import { extractDirectory, openCommunityPack } from "./lib/communityPacks.ts";
import { type CompiledAsset, compileAsset } from "./lib/compileAsset.ts";
import { garmentId } from "./lib/garmentIds.ts";
import {
  sha256,
  writeAttachmentTextures,
  writeGarments,
  writePackEntry,
} from "./lib/packWriter.ts";
import { textureAlphaUse } from "./lib/textureAlpha.ts";
import { textureProvenance } from "./lib/textureSizing.ts";

const USAGE = "usage: node scripts/pack-clothing.ts <system-assets-dir> <community-archives-dir>";
const SYSTEM: string = (() => {
  const arg = process.argv[2];
  if (!arg) throw new Error(USAGE);
  return path.resolve(arg);
})();
/** Where the pinned community packs lie, each `<id>/<id>_cc0.zip` (`communityPacks.ts`). */
const COMMUNITY: string = (() => {
  const arg = process.argv[3];
  if (!arg) throw new Error(USAGE);
  return path.resolve(arg);
})();
/** Where the community garments are extracted to be compiled: a fresh directory each run. */
const COMMUNITY_WORK = path.join(os.tmpdir(), "hk-pack-clothing-community");

const PACK = path.resolve(import.meta.dirname, "../packs/clothing");
const OUT = path.join(PACK, "data");
const BODY_DIR = path.resolve(import.meta.dirname, "../packs/body/data");
const GARMENTS_FILE = "garments.bin.gz";

/**
 * The audited archive. The licence evidence below is read from each file; this
 * records which download those files came from.
 */
const SYSTEM_ASSETS_ZIP = {
  name: "makehuman_system_assets_cc0.zip",
  sha256: "b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107",
};

/**
 * Garments in the pack: [directory in the system assets' `clothes/`, category].
 * The category decides the stacking of garments whose `z_depth` is equal
 * (`GARMENT_LAYERS`). Every suit here is a complete outfit (shirt, trousers,
 * and for the elegant ones a jacket, in one mesh), so all are `clothes`: wearing
 * two stacks two pairs of trousers, and one is worn at a time. The shoes' own
 * `z_depth` 5 puts them under every suit's 50. The id is `<group>/<directory>`
 * (`garmentId`). The community garments are `COMMUNITY_GARMENTS`.
 */
const GARMENTS: readonly [string, keyof typeof GARMENT_LAYERS, string][] = [
  ["male_casualsuit01", "clothes", "Navy shirt and jeans"],
  ["male_casualsuit02", "clothes", "Blue sweater and jeans"],
  ["male_casualsuit03", "clothes", "Striped shirt and jeans"],
  ["male_casualsuit04", "clothes", "Blue T-shirt and jeans"],
  ["male_casualsuit05", "clothes", "Field jacket and jeans"],
  ["male_casualsuit06", "clothes", "White T-shirt and jeans"],
  ["female_casualsuit01", "clothes", "Fitted T-shirt and jeans"],
  ["female_casualsuit02", "clothes", "T-shirt and denim shorts"],
  ["female_sportsuit01", "clothes", "Sports top and leggings"],
  ["male_worksuit01", "clothes", "Overalls"],
  ["female_elegantsuit01", "clothes", "Striped blouse and skirt"],
  ["male_elegantsuit01", "clothes", "Suit and tie"],
  ["shoes01", "shoes", "Brown oxfords"],
  ["shoes02", "shoes", "Camouflage trainers"],
  ["shoes03", "shoes", "Black dress shoes"],
  ["shoes04", "shoes", "Black plimsolls"],
  ["shoes05", "shoes", "White trainers"],
  ["shoes06", "shoes", "Blue trainers"],
  ["fedora01", "hat", "Grey fedora"],
];

/**
 * Default longest texture edge (a garment that needs more at a clothed figure's
 * framing gets it, `scripts/lib/textureSizing.ts`) and WebP quality: a normal
 * map tolerates less.
 */
const TEXTURES = { floor: 1024, quality: 86, normalQuality: 78 };

const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

interface Compiled {
  asset: CompiledAsset;
  label: string;
  tags: string[];
  /** The mhclo on disk. */
  file: string;
  /** What provenance names as its source: a system-assets path, or `<pack zip>: <path in it>`. */
  source: string;
}

/** The asset's own `tag` lines, less the project's mark, which every asset carries and tells a browser nothing. */
const tagsOf = (file: string): string[] =>
  fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("tag "))
    .map((l) => l.slice(4).trim())
    .filter((t) => !t.includes("MakeHuman"));

const mhcloIn = (folder: string): string => {
  const mhclo = fs.readdirSync(folder).find((f) => f.endsWith(".mhclo"));
  if (!mhclo) throw new Error(`${folder} has no .mhclo`);
  return path.join(folder, mhclo);
};

/** The system assets' garments, each CC0 by its own header (licence clause A). */
function compileSystem(): Compiled[] {
  return GARMENTS.map(([dir, kind, label]) => {
    const file = mhcloIn(path.join(SYSTEM, "clothes", dir));
    const asset = compileAsset(file, garmentId(kind, dir), kind, { normalMap: true });
    return { asset, label, tags: tagsOf(file), file, source: path.relative(SYSTEM, file) };
  });
}

/**
 * The community garments (`COMMUNITY_GARMENTS`), each from its pinned pack and
 * CC0 by its page (licence clause B): extracted from the archive, checked
 * against the pack's own record of it, and compiled with its page as evidence.
 */
function compileCommunity(): Compiled[] {
  fs.rmSync(COMMUNITY_WORK, { recursive: true, force: true });
  const out: Compiled[] = [];
  for (const pin of COMMUNITY_CLOTHING_PACKS) {
    const { zip, records } = openCommunityPack(COMMUNITY, pin);
    for (const g of COMMUNITY_GARMENTS.filter((x) => x.pack === pin.id)) {
      const record = records[g.dir];
      if (!record) throw new Error(`${pin.id} has no record of ${g.dir}`);
      // The pack's record names the same page the licence was read from.
      const node = (url: string) => /node\/(\d+)$/.exec(url)?.[1];
      if (node(record.source) !== node(g.page.url))
        throw new Error(`${g.dir}: the pack's record names ${record.source}, not ${g.page.url}`);
      const folder = path.join(COMMUNITY_WORK, pin.id, g.dir);
      extractDirectory(zip, `clothes/${g.dir}`, folder);
      const file = mhcloIn(folder);
      const asset = compileAsset(file, garmentId(g.kind, g.dir), g.kind, {
        normalMap: true,
        page: g.page,
      });
      out.push({
        asset,
        label: g.label,
        tags: tagsOf(file),
        file,
        source: `${pin.id}_cc0.zip: clothes/${g.dir}/${path.basename(file)}`,
      });
    }
  }
  return out;
}

/** A source file as provenance names it: below the system assets, or in a community pack. */
const sourceLabel = (file: string): string =>
  file.startsWith(COMMUNITY_WORK)
    ? (() => {
        const [pack, ...rest] = path.relative(COMMUNITY_WORK, file).split(path.sep);
        return `${pack}_cc0.zip: clothes/${rest.join("/")}`;
      })()
    : path.relative(SYSTEM, file);

/** Evidence grouped by kind, one line each, like the body pack's provenance. */
function evidenceLines(all: Record<string, string>): string[] {
  const byKind = new Map<string, string[]>();
  for (const [file, evidence] of Object.entries(all)) {
    // Each texture names its own material, and each community file its own page: the kind of
    // evidence is the same.
    const ev = evidence
      .replace(/referenced by \S+/, "referenced by its .mhmat")
      .replace(/ \(<[^>]+>, submitted \d{4}-\d\d-\d\d\)$/, " (its asset page, in the table below)");
    byKind.set(ev, [...(byKind.get(ev) ?? []), sourceLabel(file)]);
  }
  return [...byKind].map(([ev, files]) => `- ${files.length} file(s) — ${ev}`);
}

/**
 * A garment's material with its transparency as its packed diffuse texture's
 * alpha asks (`textureAlphaUse`): holes cut clean through are alpha-to-coverage
 * (a cutout), a see-through cloth is blended, and a texture with no alpha to
 * speak of is opaque whatever the `.mhmat` says, since its flags then do
 * nothing. The community's materials rarely name their transparency.
 */
async function withTextureAlpha(m: GarmentEntry["material"]): Promise<GarmentEntry["material"]> {
  if (!m.texture) return m;
  const use = await textureAlphaUse(path.join(OUT, m.texture));
  return { ...m, transparent: use === "sheer", alphaToCoverage: use === "cutout" };
}

function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const { manifest: bodyManifest, assets: body } = readBodyPack(BODY_DIR);
  const compiled = [...compileSystem(), ...compileCommunity()];
  const assets = compiled.map((c) => c.asset);
  const evidence = Object.assign({}, ...assets.map((a) => a.evidence)) as Record<string, string>;
  return (async () => {
    const textures = await writeAttachmentTextures(
      OUT,
      assets,
      { base: body.positions, systemDir: SYSTEM, sourceLabel },
      TEXTURES,
    );
    const packed = writeGarments(OUT, GARMENTS_FILE, assets);
    const entries: GarmentEntry[] = await Promise.all(
      packed.entries.map(async (e, i) => ({
        ...e,
        material: await withTextureAlpha(e.material),
        label: (compiled[i] as (typeof compiled)[number]).label,
        tags: (compiled[i] as (typeof compiled)[number]).tags,
      })),
    );
    const manifest: ClothingManifest = {
      format: 1,
      kind: "clothing",
      topology: bodyManifest.topology,
      bodySha256: bodyManifest.body.sha256,
      source: {
        project: "MakeHuman system assets and community asset packs (makehumancommunity.org)",
        commit: [
          `${SYSTEM_ASSETS_ZIP.name} sha256 ${SYSTEM_ASSETS_ZIP.sha256}`,
          ...COMMUNITY_CLOTHING_PACKS.map((p) => `${p.id}_cc0.zip sha256 ${p.sha256}`),
        ].join("; "),
        license: "CC0-1.0",
        note: "Asset data only; no MakeHuman code. Community garments are CC0 by their asset pages.",
      },
      garments: { file: GARMENTS_FILE, sha256: packed.sha256, entries },
    };
    fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest)}\n`);

    const files = fs
      .readdirSync(OUT)
      .filter((f) => /\.(webp|gz)$/.test(f))
      .sort();
    const lines = [
      "# humanoid-kit-clothing data provenance",
      "",
      "Generated by `scripts/pack-clothing.ts`; do not edit.",
      "",
      `Source: the MakeHuman system assets pack (\`${SYSTEM_ASSETS_ZIP.name}\`, SHA-256 \`${SYSTEM_ASSETS_ZIP.sha256}\` when audited),`,
      '"System assets, shared under CC0" on the MakeHuman community asset packs page. Only asset data is used; no',
      'MakeHuman code. "MakeHuman" is the upstream project\'s name; this package is not affiliated with it, and CC0',
      "does not license trademarks (CC0 1.0 §4a).",
      "",
      `Built against the body pack with \`body.sha256\` \`${bodyManifest.body.sha256}\`; the loader refuses any other.`,
      "",
      "Community garments come from the MakeHuman community's asset packs, each archive pinned by its SHA-256:",
      "",
      "| Pack | Archive | SHA-256 |",
      "| --- | --- | --- |",
      ...COMMUNITY_CLOTHING_PACKS.map((p) => `| ${p.id} | <${p.url}> | \`${p.sha256}\` |`),
      "",
      "Every packed source file was checked for CC0 before packing: a system asset by its own header (A), a",
      "community garment by its asset page, which governs (B; docs/licence-history.md):",
      "",
      ...evidenceLines(evidence),
      "",
      "| Garment | Category | Source mhclo | SHA-256 of the mhclo |",
      "| --- | --- | --- | --- |",
      ...compiled.map(
        ({ asset, source, file }) =>
          `| ${asset.id} | ${asset.kind} | ${source} | \`${sha(file)}\` |`,
      ),
      "",
      "| Community garment | Asset page | Submitted by | On | Page licence | Read on |",
      "| --- | --- | --- | --- | --- | --- |",
      ...COMMUNITY_GARMENTS.map(
        (g) =>
          `| ${garmentId(g.kind, g.dir)} | <${g.page.url}> | ${g.page.submitter} | ${g.page.submitted} | ${g.page.licence} | ${g.page.retrieved} |`,
      ),
      "",
      ...textureProvenance(textures),
      "## Outputs",
      "",
      "| Output | SHA-256 |",
      "| --- | --- |",
      ...files.map((f) => `| ${f} | \`${sha256(fs.readFileSync(path.join(OUT, f)))}\` |`),
      "",
    ];
    fs.writeFileSync(path.join(OUT, "PROVENANCE.md"), lines.join("\n"));
    writePackEntry(
      PACK,
      "clothingPack",
      "URLs of the humanoid-kit-clothing pack files. Pass to `loadHumanoidAssets({ clothing })`.",
    );
    const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
    const textureBytes = files
      .filter((f) => f.endsWith(".webp"))
      .reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
    console.log(
      `packed ${assets.length} garments: binary ${mb(fs.statSync(path.join(OUT, GARMENTS_FILE)).size)}, ` +
        `${files.filter((f) => f.endsWith(".webp")).length} textures ${mb(textureBytes)}`,
    );
  })();
}

await main();
