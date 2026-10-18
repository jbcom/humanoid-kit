/**
 * A pinned Blender for hosts that have none (CI runners): the official release
 * archive, downloaded over https, checked against the SHA-256 Blender publishes for it
 * (download.blender.org/release/Blender5.1/blender-5.1.1.sha256) and extracted into a
 * tool directory. The adult pack's cuts were proven on exactly this version
 * (`packs/adult-anatomy/source/PROVENANCE.md`); a different version, or a different
 * thread count (`CUT_THREADS` in `sculptSources.ts`), is a different cut and fails the
 * cut check. A developer's own Blender is found by `sculptSources.ts`.
 *
 * Only macOS arm64 is pinned, on purpose. With the thread count pinned the GitHub macOS
 * runner cuts exactly the bytes a developer's Mac does, but Blender 5.1.1 on x86-64
 * Linux (ubuntu-24.04) cuts the same planes to different float bytes (measured), so a
 * Linux release would only fail the cut check.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

/** The hashes Blender publishes at `${BASE}/blender-${BLENDER_VERSION}.sha256`. */
const PINNED: Record<string, { file: string; sha256: string; binary: string }> = {
  "darwin/arm64": {
    file: `blender-${BLENDER_VERSION}-macos-arm64.dmg`,
    sha256: "ff6219b3aaab4d9adf548b9a32b3b31764fe740b6c741d16660c5c0f4ffe9841",
    binary: "Blender.app/Contents/MacOS/Blender",
  },
};

/** The release for `platform`/`arch`. @throws if none is pinned. */
export function blenderRelease(platform: string, arch: string): BlenderRelease {
  const pin = PINNED[`${platform}/${arch}`];
  if (!pin)
    throw new Error(
      `no Blender ${BLENDER_VERSION} is pinned for ${platform}/${arch}; install it and set BLENDER`,
    );
  const dir = pin.file.replace(/\.dmg$/, "");
  return {
    version: BLENDER_VERSION,
    file: pin.file,
    url: `${BASE}/${pin.file}`,
    sha256: pin.sha256,
    dir,
    binary: `${dir}/${pin.binary}`,
  };
}

/** Time allowed for the archive (about 450 MB). */
const ARCHIVE_TIMEOUT_MS = 15 * 60_000;

const run = promisify(execFile);

/** Copies `Blender.app` out of a mounted `.dmg` into `<toolDir>/<dir>`. */
async function extractDmg(release: BlenderRelease, archive: string, toolDir: string) {
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), "hk-blender-dmg-"));
  await run("hdiutil", [
    "attach",
    "-nobrowse",
    "-readonly",
    "-noverify",
    "-mountpoint",
    mount,
    archive,
  ]);
  try {
    const dest = path.join(toolDir, release.dir);
    fs.mkdirSync(dest, { recursive: true });
    await run("ditto", [path.join(mount, "Blender.app"), path.join(dest, "Blender.app")]);
  } finally {
    await run("hdiutil", ["detach", "-force", mount]).catch(() => undefined);
    fs.rmSync(mount, { recursive: true, force: true });
  }
}

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
    await (options.extract ?? ((a, d) => extractDmg(release, a, d)))(archive, options.toolDir);
  } finally {
    fs.rmSync(archive, { force: true });
  }
  if (!fs.existsSync(binary)) throw new Error(`${release.file} did not extract to ${binary}`);
  fs.writeFileSync(marker, release.sha256);
  return binary;
}
