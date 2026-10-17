/**
 * Where the adult pack's community sculpts come from at pack time.
 *
 * The geometry is not in this repository. `packs/adult-anatomy/source/` keeps only the
 * records: `PROVENANCE.md` (each file's SHA-256), a `LICENSE-SOURCE.txt` per source (the
 * page and the URL each file came from) and a `cuts.json` per source (the planes each
 * part is cut by, its topology, and the SHA-256 of the cut it must come out as).
 *
 * `ensureSculptSources` downloads each source into a gitignored cache, checks it against
 * the recorded hash, regenerates the cuts from the verified source with
 * `scripts/blender/cut_sculpt.py`, and checks every regenerated cut against the hash in
 * `cuts.json`. It fails closed at every step: a failed download, a hash that does not
 * match, a missing Blender or a cut that came out differently stops the run, and nothing
 * unverified is left in the cache. The synchronous readers (`sculptFile`) check every
 * file against its recorded hash again as they read it, so no code path uses a file the
 * records do not vouch for.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import {
  type Fetcher,
  fetchVerified,
  parseProvenanceHashes,
  parseSourceUrls,
  type SourceFile,
  sha256Hex,
} from "../sourceFetch.ts";

const REPO = path.resolve(import.meta.dirname, "../../..");

/** The committed records: hashes, URLs, cut planes. No geometry. */
export const SCULPT_META = path.join(REPO, "packs/adult-anatomy/source");

/** Where the downloaded sources and regenerated cuts are kept (gitignored). Overridable. */
export const sculptCacheRoot = (): string =>
  process.env.HK_ADULT_SOURCE_CACHE
    ? path.resolve(process.env.HK_ADULT_SOURCE_CACHE)
    : path.join(REPO, ".cache/adult-sculpts");

const CUT_SCRIPT = path.join(REPO, "scripts/blender/cut_sculpt.py");

/** A source or a cut the records do not vouch for, or one that is not in the cache. */
export class SculptSourceError extends Error {
  override readonly name: string = "SculptSourceError";
}

/** The cuts cannot be regenerated because there is no Blender to run `cut_sculpt.py`. */
export class BlenderUnavailableError extends SculptSourceError {
  override readonly name = "BlenderUnavailableError";
}

/** What `cuts.json` records about one cut part. */
export interface CutPartRecord {
  disc: boolean;
  /** SHA-256 of the part's `.obj` exactly as `cut_sculpt.py` writes it. */
  objSha256: string;
}

/** A source's `cuts.json`. */
export interface CutsRecord {
  /** The source `.obj`'s file name. */
  source: string;
  /** Its SHA-256: it must be the one PROVENANCE.md records. */
  sha256: string;
  subdivisions: number;
  parts: Record<string, CutPartRecord>;
}

/** Everything the records say, read once. */
export interface SculptManifest {
  metaDir: string;
  /** Each source file to download (`.obj` and `.proxy`), with its recorded hash and URL. */
  files: (SourceFile & { asset: string })[];
  /** Each source's `cuts.json`, by asset. */
  cuts: Record<string, CutsRecord>;
  /** The hash every cached file (source, binding or cut) must have, by `asset/name`. */
  expected: Map<string, string>;
}

/** The records in `metaDir`. @throws SculptSourceError if they are incomplete or disagree. */
export function sculptManifest(metaDir: string = SCULPT_META): SculptManifest {
  const hashes = parseProvenanceHashes(
    fs.readFileSync(path.join(metaDir, "PROVENANCE.md"), "utf8"),
  );
  const files: SculptManifest["files"] = [];
  const cuts: SculptManifest["cuts"] = {};
  const expected = new Map<string, string>();
  const assets = fs
    .readdirSync(metaDir, { withFileTypes: true })
    .filter(
      (e) => e.isDirectory() && fs.existsSync(path.join(metaDir, e.name, "LICENSE-SOURCE.txt")),
    )
    .map((e) => e.name)
    .sort();
  for (const asset of assets) {
    const urls = parseSourceUrls(
      fs.readFileSync(path.join(metaDir, asset, "LICENSE-SOURCE.txt"), "utf8"),
    );
    if (!urls.size)
      throw new SculptSourceError(`${asset}/LICENSE-SOURCE.txt lists no "Files from:" URLs`);
    for (const [name, url] of urls) {
      const sha256 = hashes.get(name);
      if (!sha256)
        throw new SculptSourceError(`PROVENANCE.md records no SHA-256 for ${asset}/${name}`);
      files.push({ asset, name, url, sha256 });
      expected.set(`${asset}/${name}`, sha256);
    }
    const record = JSON.parse(
      fs.readFileSync(path.join(metaDir, asset, "cuts.json"), "utf8"),
    ) as CutsRecord;
    if (expected.get(`${asset}/${record.source}`) !== record.sha256)
      throw new SculptSourceError(
        `${asset}/cuts.json cuts ${record.source} at ${record.sha256}, which PROVENANCE.md does not record`,
      );
    for (const [part, p] of Object.entries(record.parts)) {
      if (!/^[0-9a-f]{64}$/.test(p.objSha256 ?? ""))
        throw new SculptSourceError(`${asset}/cuts.json records no objSha256 for ${part}`);
      expected.set(`${asset}/${part}.obj`, p.objSha256);
    }
    cuts[asset] = record;
  }
  return { metaDir, files, cuts, expected };
}

let defaultManifest: SculptManifest | undefined;
const manifest = () => {
  defaultManifest ??= sculptManifest();
  return defaultManifest;
};

/**
 * The bytes of `name` in the cache for `asset`, after checking them against the recorded
 * hash. Synchronous, for the placement code; `ensureSculptSources` must have run first.
 */
export function sculptFile(asset: string, name: string): Buffer {
  const want = manifest().expected.get(`${asset}/${name}`);
  if (!want) throw new SculptSourceError(`${asset}/${name} is not a file the sculpt records name`);
  const file = path.join(sculptCacheRoot(), asset, name);
  if (!fs.existsSync(file))
    throw new SculptSourceError(
      `${asset}/${name} is not in the sculpt cache (${sculptCacheRoot()}); ` +
        "await ensureSculptSources() (scripts/lib/detail/sculptSources.ts) before placing sculpts",
    );
  const data = fs.readFileSync(file);
  if (sha256Hex(data) !== want)
    throw new SculptSourceError(
      `${file} does not hash to the recorded ${want}; delete it and fetch again`,
    );
  return data;
}

/** The cuts record of a source, from the committed records. */
export function sculptCuts(asset: string): CutsRecord {
  const record = manifest().cuts[asset];
  if (!record) throw new SculptSourceError(`no sculpt source named ${asset}`);
  return record;
}

const run = promisify(execFile);

/** A Blender to run the cut script: `$BLENDER`, one on the PATH, or a standard install. */
export function findBlender(env: NodeJS.ProcessEnv = process.env): string | null {
  const onPath = (env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((d) => path.join(d, "blender"));
  const candidates = [
    env.BLENDER,
    ...onPath,
    "/Applications/Blender.app/Contents/MacOS/Blender",
    "/opt/homebrew/bin/blender",
    "/usr/local/bin/blender",
  ];
  return (
    candidates.find((c): c is string => {
      if (!c) return false;
      try {
        return fs.statSync(c).isFile();
      } catch {
        return false;
      }
    }) ?? null
  );
}

/** Runs `cut_sculpt.py` in headless Blender on `source`, writing the parts and `cuts.json` to `outDir`. */
async function blenderCut(blender: string, source: string, outDir: string): Promise<void> {
  try {
    await run(
      blender,
      ["-b", "--factory-startup", "--python", CUT_SCRIPT, "--", source, outDir, "--no-render"],
      { maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 },
    );
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    const tail = `${err.stdout ?? ""}\n${err.stderr ?? ""}`
      .trim()
      .split("\n")
      .slice(-12)
      .join("\n");
    throw new SculptSourceError(
      `Blender could not cut ${path.basename(source)}: ${err.message}\n${tail}`,
    );
  }
}

/** How `ensureSculptSources` is wired; every part defaults to the real thing. */
export interface EnsureOptions {
  metaDir?: string;
  cacheRoot?: string;
  fetcher?: Fetcher;
  /** The Blender to cut with; `null` fails closed. */
  blender?: () => string | null;
  /** Replaces the Blender run (tests): writes the cut parts and `cuts.json` into `outDir`. */
  cutWith?: (source: string, outDir: string) => Promise<void>;
}

/**
 * Every source downloaded and verified, and every cut regenerated from it and verified,
 * in the cache. Cheap when the cache is already good: it only hashes what is there.
 *
 * @throws SourceFetchError on a failed download or a hash mismatch.
 * @throws BlenderUnavailableError if a cut must be regenerated and there is no Blender.
 * @throws SculptSourceError if a regenerated cut is not the one `cuts.json` records.
 */
export async function ensureSculptSources(options: EnsureOptions = {}): Promise<void> {
  const m = options.metaDir ? sculptManifest(options.metaDir) : manifest();
  const root = options.cacheRoot ?? sculptCacheRoot();
  for (const asset of Object.keys(m.cuts)) {
    const dir = path.join(root, asset);
    fs.mkdirSync(dir, { recursive: true });
    const sources = m.files.filter((f) => f.asset === asset);
    for (const f of sources) await fetchVerified(f, dir, options.fetcher);
    const record = m.cuts[asset] as CutsRecord;
    const parts = Object.keys(record.parts);
    const good = parts.every((part) => {
      const file = path.join(dir, `${part}.obj`);
      return (
        fs.existsSync(file) && sha256Hex(fs.readFileSync(file)) === record.parts[part]?.objSha256
      );
    });
    if (good) continue;
    let cut = options.cutWith;
    if (!cut) {
      const blender = (options.blender ?? findBlender)();
      if (!blender)
        throw new BlenderUnavailableError(
          `Blender is needed to regenerate the cuts of ${asset} (${parts.join(", ")}) from the verified ` +
            "source, and none was found. Install Blender (the cuts were proven with 5.1.1) or set " +
            "BLENDER=/path/to/blender; or set HK_ADULT_SOURCE_CACHE to a cache that already holds the " +
            "verified cuts. Nothing unverified will be used.",
        );
      cut = (source, outDir) => blenderCut(blender, source, outDir);
    }
    const scratch = fs.mkdtempSync(path.join(dir, ".cut-"));
    try {
      await cut(path.join(dir, record.source), scratch);
      for (const part of parts) {
        const file = path.join(scratch, `${part}.obj`);
        const got = fs.existsSync(file) ? sha256Hex(fs.readFileSync(file)) : "(not written)";
        if (got !== record.parts[part]?.objSha256)
          throw new SculptSourceError(
            `${asset}: the regenerated ${part}.obj (${got}) is not the cut recorded in cuts.json ` +
              `(${record.parts[part]?.objSha256}); a different Blender, or a changed cut script, cuts differently`,
          );
      }
      const regenerated = JSON.parse(
        fs.readFileSync(path.join(scratch, "cuts.json"), "utf8"),
      ) as unknown;
      if (!isDeepStrictEqual(regenerated, record))
        throw new SculptSourceError(
          `${asset}: the regenerated cuts.json differs from the committed one`,
        );
      for (const part of parts)
        fs.renameSync(path.join(scratch, `${part}.obj`), path.join(dir, `${part}.obj`));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
}
