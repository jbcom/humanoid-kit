/**
 * A pinned Blender for hosts that have none (CI runners): the official release
 * archive, downloaded over https, checked against the SHA-256 Blender publishes for it
 * (download.blender.org/release/Blender5.1/blender-5.1.1.sha256) and extracted into a
 * tool directory. The adult pack's cuts were proven on exactly this version
 * (`packs/adult-anatomy/source/PROVENANCE.md`); a different Blender is a different cut
 * and fails the cut check. Only Linux x64 is provisioned: macOS developers install
 * Blender themselves, and `sculptSources.ts` finds it.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { type Fetcher, fetchVerified, httpFetcherWithin } from "./sourceFetch.ts";

export const BLENDER_VERSION = "5.1.1";

/** One release archive: where it is, what it hashes to, and where its executable is once extracted. */
export interface BlenderRelease {
  version: string;
  file: string;
  url: string;
  sha256: string;
  /** The extracted directory under the tool directory. */
  dir: string;
  /** The executable, relative to the tool directory. */
  binary: string;
}

const BASE = `https://download.blender.org/release/Blender${BLENDER_VERSION.replace(/\.\d+$/, "")}`;

/** The release for `platform`/`arch`. @throws if none is pinned. */
export function blenderRelease(platform: string, arch: string): BlenderRelease {
  if (platform !== "linux" || arch !== "x64")
    throw new Error(
      `no Blender ${BLENDER_VERSION} is pinned for ${platform}/${arch}; install it and set BLENDER`,
    );
  const dir = `blender-${BLENDER_VERSION}-linux-x64`;
  return {
    version: BLENDER_VERSION,
    file: `${dir}.tar.xz`,
    url: `${BASE}/${dir}.tar.xz`,
    sha256: "6f9fff89fef154ef7974d1a1c4b916ab4bc1f5618bcb48d5befee1bd0a7c7f2a",
    dir,
    binary: `${dir}/blender`,
  };
}

/** Time allowed for the 400 MB archive. */
const ARCHIVE_TIMEOUT_MS = 15 * 60_000;

export interface ProvisionOptions {
  toolDir: string;
  platform?: string;
  arch?: string;
  fetcher?: Fetcher;
  /** Replaces the pinned release (tests). */
  release?: BlenderRelease;
  /** Extracts `archive` into `toolDir` (tests). */
  extract?: (archive: string, toolDir: string) => Promise<void>;
}

const run = promisify(execFile);

/**
 * The path of a verified Blender executable in `toolDir`, downloading and extracting the
 * pinned release if it is not there. The archive is hashed before it is extracted and
 * deleted after; an extraction is trusted again on a later run only if its marker names
 * the pinned hash.
 */
export async function provisionBlender(options: ProvisionOptions): Promise<string> {
  const release =
    options.release ??
    blenderRelease(options.platform ?? process.platform, options.arch ?? process.arch);
  const binary = path.join(options.toolDir, release.binary);
  const marker = path.join(options.toolDir, release.dir, ".verified-sha256");
  if (
    fs.existsSync(binary) &&
    fs.existsSync(marker) &&
    fs.readFileSync(marker, "utf8") === release.sha256
  )
    return binary;
  fs.mkdirSync(options.toolDir, { recursive: true });
  fs.rmSync(path.join(options.toolDir, release.dir), { recursive: true, force: true });
  const { path: archive } = await fetchVerified(
    { name: release.file, url: release.url, sha256: release.sha256 },
    options.toolDir,
    options.fetcher ?? httpFetcherWithin(ARCHIVE_TIMEOUT_MS),
  );
  try {
    await (options.extract ?? ((a, d) => run("tar", ["-xJf", a, "-C", d]).then(() => undefined)))(
      archive,
      options.toolDir,
    );
  } finally {
    fs.rmSync(archive, { force: true });
  }
  if (!fs.existsSync(binary)) throw new Error(`${release.file} did not extract to ${binary}`);
  fs.writeFileSync(marker, release.sha256);
  return binary;
}
