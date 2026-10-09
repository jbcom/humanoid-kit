/**
 * Packs the clothing pack (`humanoid-kit-clothing`): CC0 garments from the
 * MakeHuman system assets pack, bound to the body pack's hm08 base mesh.
 *
 *   node scripts/pack-clothing.ts <system-assets-dir>
 *
 * The argument is the extracted "MakeHuman system assets" pack
 * (makehuman_system_assets_cc0.zip), the same directory `pack-makehuman.ts`
 * reads eyes, teeth and tongue from. Only asset files are read; no MakeHuman
 * code is used. The pack is built against the body pack committed in
 * `packs/body/data` and records its `body.sha256`, which the loader checks.
 *
 * Every source file must prove CC0 from its own bytes (`compileAsset`): the
 * system assets open with "This asset was explicitly released as CC0 in
 * september 2020". A texture inherits the licence of the material that names
 * it. Packing is deterministic for a given `sharp` version.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ClothingManifest, GarmentEntry } from "../src/format/assetFormat.ts";
import type { GARMENT_LAYERS } from "../src/model/outfit.ts";
import { type CompiledAsset, compileAsset } from "./lib/compileAsset.ts";
import {
  sha256,
  writeAttachmentTextures,
  writeGarments,
  writePackEntry,
} from "./lib/packWriter.ts";

const USAGE = "usage: node scripts/pack-clothing.ts <system-assets-dir>";
const SYSTEM: string = (() => {
  const arg = process.argv[2];
  if (!arg) throw new Error(USAGE);
  return path.resolve(arg);
})();

const PACK = path.resolve(import.meta.dirname, "../packs/clothing");
const OUT = path.join(PACK, "data");
const BODY_MANIFEST = path.resolve(import.meta.dirname, "../packs/body/data/manifest.json");
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
 * The category is where a garment stacks (`GARMENT_LAYERS`): a suit is shirt
 * and trousers, an elegant suit carries a jacket, shoes go over trousers.
 * The id is `<group>/<directory>`.
 */
const GARMENTS: readonly [string, keyof typeof GARMENT_LAYERS][] = [
  ["male_casualsuit01", "clothes"],
  ["male_casualsuit02", "clothes"],
  ["male_casualsuit03", "clothes"],
  ["male_casualsuit04", "clothes"],
  ["male_casualsuit05", "clothes"],
  ["male_casualsuit06", "clothes"],
  ["female_casualsuit01", "clothes"],
  ["female_casualsuit02", "clothes"],
  ["female_sportsuit01", "clothes"],
  ["male_worksuit01", "clothes"],
  ["female_elegantsuit01", "jacket"],
  ["male_elegantsuit01", "jacket"],
  ["shoes01", "shoes"],
  ["shoes02", "shoes"],
  ["shoes03", "shoes"],
  ["shoes04", "shoes"],
  ["shoes05", "shoes"],
  ["shoes06", "shoes"],
  ["fedora01", "hat"],
];
const GROUP: Record<keyof typeof GARMENT_LAYERS, string> = {
  underwear: "underwear",
  socks: "socks",
  clothes: "suits",
  sweater: "sweaters",
  jacket: "suits",
  shoes: "shoes",
  coat: "coats",
  hat: "hats",
  backpack: "backpacks",
};

/** Longest texture edge and WebP quality: a suit fills at most a screenful, a normal map tolerates less. */
const TEXTURES = { max: 1024, quality: 86, normalQuality: 78 };

const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function compile(): { asset: CompiledAsset; tags: string[]; source: string }[] {
  return GARMENTS.map(([dir, kind]) => {
    const folder = path.join(SYSTEM, "clothes", dir);
    const mhclo = fs.readdirSync(folder).find((f) => f.endsWith(".mhclo"));
    if (!mhclo) throw new Error(`${folder} has no .mhclo`);
    const file = path.join(folder, mhclo);
    const asset = compileAsset(file, `${GROUP[kind]}/${dir}`, kind, { normalMap: true });
    const tags = fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("tag "))
      .map((l) => l.slice(4).trim())
      // The project's own mark, on every asset, tells a browser nothing.
      .filter((t) => !t.includes("MakeHuman"));
    return { asset, tags, source: path.relative(SYSTEM, file) };
  });
}

/** Evidence grouped by kind, one line each, like the body pack's provenance. */
function evidenceLines(all: Record<string, string>): string[] {
  const byKind = new Map<string, string[]>();
  for (const [file, evidence] of Object.entries(all)) {
    // Each texture names its own material; the kind of evidence is the same.
    const ev = evidence.replace(/referenced by \S+/, "referenced by its .mhmat");
    byKind.set(ev, [...(byKind.get(ev) ?? []), path.relative(SYSTEM, file)]);
  }
  return [...byKind].map(([ev, files]) => `- ${files.length} file(s) — ${ev}`);
}

function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const bodyManifest = JSON.parse(fs.readFileSync(BODY_MANIFEST, "utf8")) as {
    topology: string;
    body: { sha256: string };
  };
  const compiled = compile();
  const assets = compiled.map((c) => c.asset);
  const evidence = Object.assign({}, ...assets.map((a) => a.evidence)) as Record<string, string>;
  return (async () => {
    await writeAttachmentTextures(OUT, assets, TEXTURES);
    const packed = writeGarments(OUT, GARMENTS_FILE, assets);
    const entries: GarmentEntry[] = packed.entries.map((e, i) => ({
      ...e,
      tags: (compiled[i] as (typeof compiled)[number]).tags,
    }));
    const manifest: ClothingManifest = {
      format: 1,
      kind: "clothing",
      topology: bodyManifest.topology,
      bodySha256: bodyManifest.body.sha256,
      source: {
        project: "MakeHuman system assets (makehumancommunity.org)",
        commit: `${SYSTEM_ASSETS_ZIP.name} sha256 ${SYSTEM_ASSETS_ZIP.sha256}`,
        license: "CC0-1.0",
        note: "Asset data only; no MakeHuman code.",
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
      "Every packed source file was checked for CC0 from its own content before packing:",
      "",
      ...evidenceLines(evidence),
      "",
      "| Garment | Category | Source mhclo | SHA-256 of the mhclo |",
      "| --- | --- | --- | --- |",
      ...compiled.map(
        ({ asset, source }) =>
          `| ${asset.id} | ${asset.kind} | ${source} | \`${sha(path.join(SYSTEM, source))}\` |`,
      ),
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
