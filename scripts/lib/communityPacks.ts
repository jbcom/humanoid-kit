/**
 * The MakeHuman community's asset packs, as the packers read them: each pinned
 * by its download URL and SHA-256, opened only when the archive on disk is the
 * pinned one, with the pack's own record of every asset in it
 * (`packs/<id>.json`: author, dates, licence and the asset's page). The eye
 * materials (`packEyes.ts`) and the community garments (`pack-clothing.ts`)
 * both read them this way.
 *
 * The archives are fetched by hand into `<archives>/<id>/<archive>`; each pin
 * records the actual archive basename (for example `_cc0.zip` or `_cc-by.zip`).
 * Nothing here touches the network.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readZip, type ZipEntries } from "./zip.ts";

/** A community asset pack, pinned. */
export interface CommunityPackPin {
  id: string;
  sha256: string;
  /** Archive basename under the pack's download directory (defaults to `<id>_cc0.zip`). */
  archive?: string;
  url: string;
  /** The pack's page on static.makehumancommunity.org. */
  page: string;
}

/** The pack's own record of one asset (`packs/<id>.json`). */
export interface PackRecord {
  author: string;
  created: string;
  license: string;
  /** The asset's page on makehumancommunity.org. */
  source: string;
  description: string;
}

/** The download URL of a community pack, by the site's convention. */
export const communityPackUrl = (id: string, archive = `${id}_cc0.zip`): string =>
  `https://files.makehumancommunity.org/asset_packs/${id}/${archive}`;

/** The page of a community pack, by the site's convention. */
export const communityPackPage = (id: string): string =>
  `https://static.makehumancommunity.org/assets/assetpacks/${id}.html`;

/** A community pack pinned by its archive's SHA-256, its URL and page by the site's convention. */
export const pin = (
  id: string,
  sha256: string,
  { archive = `${id}_cc0.zip` }: { archive?: string } = {},
): CommunityPackPin => ({
  id,
  sha256,
  archive,
  url: communityPackUrl(id, archive),
  page: communityPackPage(id),
});

/** Where a pinned pack's archive lies under `archives`. */
export const communityPackFile = (archives: string, pin: CommunityPackPin): string =>
  path.join(archives, pin.id, pin.archive ?? `${pin.id}_cc0.zip`);

/**
 * A pinned pack's archive and its records. Throws if the archive is not the
 * pinned one: a pack re-uploaded under the same name is a different source,
 * to be audited again.
 */
export function openCommunityPack(
  archives: string,
  pin: CommunityPackPin,
): { zip: ZipEntries; records: Record<string, PackRecord> } {
  const file = fs.readFileSync(communityPackFile(archives, pin));
  const hash = createHash("sha256").update(file).digest("hex");
  if (hash !== pin.sha256) throw new Error(`${pin.id} is ${hash}, not the pinned ${pin.sha256}`);
  const zip = readZip(file);
  const records = JSON.parse(zip.read(`packs/${pin.id}.json`).toString("utf8")) as Record<
    string,
    PackRecord
  >;
  return { zip, records };
}

/**
 * Writes every file of the archive under `prefix` (a directory in it, with no
 * trailing slash) into `outDir`, keeping the paths below the prefix; returns
 * the written paths. The packers compile assets from files on disk.
 */
export function extractDirectory(zip: ZipEntries, prefix: string, outDir: string): string[] {
  const names = zip.names.filter((n) => n.startsWith(`${prefix}/`));
  if (names.length === 0) throw new Error(`the archive has nothing under ${prefix}/`);
  return names.map((name) => {
    const rel = name.slice(prefix.length + 1);
    // A name that climbs out of the directory is not an asset file.
    if (rel.split("/").includes("..")) throw new Error(`${name}: refuses a path out of ${prefix}`);
    const out = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, zip.read(name));
    return out;
  });
}
