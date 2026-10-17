/**
 * Download third-party source files at pack time, and trust nothing that is not the
 * file whose SHA-256 was recorded for it.
 *
 * The adult pack's community sculpts are not vendored in this repository: the packer
 * fetches each one into a gitignored cache, checks it against the hash recorded in
 * `packs/adult-anatomy/source/PROVENANCE.md`, and fails closed on a mismatch or a
 * failed download (`scripts/lib/detail/sculptSources.ts`). The URLs are plain http, so
 * the hash is the whole integrity guarantee: a file is written to the cache only after
 * its bytes have been hashed, by a rename from a temporary file in the same directory.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** One file to fetch: where it is cached (by name), where it comes from, and what it must hash to. */
export interface SourceFile {
  name: string;
  url: string;
  sha256: string;
}

/** Fetches a URL's bytes; rejects on a network failure or a non-2xx answer. */
export type Fetcher = (url: string) => Promise<Uint8Array>;

/** A source that could not be fetched, or did not verify. Nothing of it is cached. */
export class SourceFetchError extends Error {
  override readonly name = "SourceFetchError";
}

/** The lower-case hex SHA-256 of `data`. */
export const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

/** How long one download may take before it is abandoned (the sculpts are under 4 MB). */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** The global `fetch`, with a timeout, as a `Fetcher`. */
export const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
};

/**
 * `file` in `dir`, verified. A cached copy that hashes right is used as it is; one that
 * does not (corrupt, truncated, tampered with) is deleted and fetched again. A download
 * is cached only if it hashes to `file.sha256`.
 *
 * @throws SourceFetchError on a failed download or a hash mismatch, with no file left in the cache.
 */
export async function fetchVerified(
  file: SourceFile,
  dir: string,
  fetcher: Fetcher = httpFetcher,
): Promise<{ path: string; cached: boolean }> {
  if (file.name !== path.basename(file.name) || file.name.startsWith("."))
    throw new SourceFetchError(`source name ${JSON.stringify(file.name)} is not a plain file name`);
  const dest = path.join(dir, file.name);
  if (fs.existsSync(dest)) {
    if (sha256Hex(fs.readFileSync(dest)) === file.sha256) return { path: dest, cached: true };
    fs.rmSync(dest, { force: true });
  }
  let body: Uint8Array;
  try {
    body = await fetcher(file.url);
  } catch (e) {
    throw new SourceFetchError(
      `could not download ${file.name} from ${file.url}: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
  const got = sha256Hex(body);
  if (got !== file.sha256)
    throw new SourceFetchError(
      `${file.name} from ${file.url} hashes to ${got}, not the recorded ${file.sha256}; refusing to use it`,
    );
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${file.name}.${process.pid}.${randomBytes(4).toString("hex")}.part`);
  try {
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return { path: dest, cached: false };
}

/**
 * The file hashes a PROVENANCE table records: every `` `name.obj` `<64 hex>` `` or
 * `` `name.proxy` `<64 hex>` `` pair, wherever it falls. Prose that names a script is
 * not a record (no hash follows it).
 */
export function parseProvenanceHashes(markdown: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const m of markdown.matchAll(/`([^`/\s]+\.(?:obj|proxy))`[^`\n]*?`([0-9a-f]{64})`/g))
    hashes.set(m[1] as string, m[2] as string);
  return hashes;
}

/** The URL each file came from, by file name: the "Files from:" line of a LICENSE-SOURCE.txt. */
export function parseSourceUrls(licenseSource: string): Map<string, string> {
  const urls = new Map<string, string>();
  const line = licenseSource.split(/\r?\n/).find((l) => l.startsWith("Files from:"));
  for (const url of (line ?? "").slice("Files from:".length).split(",")) {
    const u = url.trim();
    if (u) urls.set(path.posix.basename(new URL(u).pathname), u);
  }
  return urls;
}
