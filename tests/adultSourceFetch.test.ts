import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BlenderUnavailableError,
  ensureSculptSources,
  sculptManifest,
} from "../scripts/lib/detail/sculptSources.ts";
import {
  type Fetcher,
  fetchVerified,
  parseProvenanceHashes,
  parseSourceUrls,
  SourceFetchError,
  sha256Hex,
} from "../scripts/lib/sourceFetch.ts";

/**
 * The adult pack's community sculpts are not vendored: the packer downloads each one,
 * checks its SHA-256 against `packs/adult-anatomy/source/PROVENANCE.md` and refuses
 * anything else. Nothing here touches the network: every download is an injected fetcher.
 */

const bytes = (text: string) => new TextEncoder().encode(text);
const digest = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hk-source-fetch-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A fetcher that serves `body` and counts its calls. */
function serving(body: Uint8Array) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    return body;
  };
  return { fetcher, calls };
}

describe("fetchVerified", () => {
  const body = bytes("v 0 0 0\n");
  const file = { name: "a.obj", url: "http://example.test/a.obj", sha256: digest(body) };

  it("accepts a matching hash and caches the file", async () => {
    const { fetcher, calls } = serving(body);
    const got = await fetchVerified(file, dir, fetcher);
    expect(got).toEqual({ path: path.join(dir, "a.obj"), cached: false });
    expect(fs.readFileSync(got.path)).toEqual(Buffer.from(body));
    expect(calls).toEqual([file.url]);
    expect(fs.readdirSync(dir)).toEqual(["a.obj"]);
  });

  it("throws on a hash mismatch and leaves no cached file", async () => {
    const { fetcher } = serving(bytes("something else\n"));
    const err = await fetchVerified(file, dir, fetcher).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as Error).message).toContain(file.sha256);
    expect((err as Error).message).toContain(file.url);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("throws on a network failure and leaves no cached file", async () => {
    const down: Fetcher = async () => {
      throw new Error("getaddrinfo ENOTFOUND example.test");
    };
    const err = await fetchVerified(file, dir, down).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect((err as Error).message).toContain("ENOTFOUND");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("does not download a file already cached with a matching hash", async () => {
    fs.writeFileSync(path.join(dir, "a.obj"), body);
    const { fetcher, calls } = serving(bytes("never served\n"));
    const got = await fetchVerified(file, dir, fetcher);
    expect(got.cached).toBe(true);
    expect(calls).toEqual([]);
  });

  it("rejects a corrupt cached file: it is replaced by a verified download", async () => {
    fs.writeFileSync(path.join(dir, "a.obj"), "corrupt");
    const { fetcher, calls } = serving(body);
    const got = await fetchVerified(file, dir, fetcher);
    expect(got.cached).toBe(false);
    expect(calls).toHaveLength(1);
    expect(sha256Hex(fs.readFileSync(got.path))).toBe(file.sha256);
  });

  it("removes a corrupt cached file when the replacement does not verify either", async () => {
    fs.writeFileSync(path.join(dir, "a.obj"), "corrupt");
    const { fetcher } = serving(bytes("also wrong\n"));
    await expect(fetchVerified(file, dir, fetcher)).rejects.toBeInstanceOf(SourceFetchError);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("refuses a name that would leave the cache directory", async () => {
    const { fetcher, calls } = serving(body);
    await expect(
      fetchVerified({ ...file, name: "../escape.obj" }, dir, fetcher),
    ).rejects.toBeInstanceOf(SourceFetchError);
    expect(calls).toEqual([]);
  });
});

describe("the source records", () => {
  it("reads each file's hash from the PROVENANCE table, ignoring prose", () => {
    const md = [
      "| Source | Files (SHA-256) |",
      "| --- | --- |",
      `| \`one\` | \`one.obj\` \`${"a".repeat(64)}\`; \`one.proxy\` \`${"b".repeat(64)}\` |`,
      `| NIH | \`pelvis.obj\` (as downloaded, not kept here) \`${"c".repeat(64)}\` |`,
      "Prose mentioning `scripts/blender/cut_sculpt.py` is not a record.",
    ].join("\n");
    const hashes = parseProvenanceHashes(md);
    expect(hashes.get("one.obj")).toBe("a".repeat(64));
    expect(hashes.get("one.proxy")).toBe("b".repeat(64));
    expect(hashes.get("cut_sculpt.py")).toBeUndefined();
  });

  it("reads each file's URL from the LICENSE-SOURCE 'Files from:' line", () => {
    const text = [
      "Asset: x",
      "Files from: http://h.test/p/1/100/x.obj, http://h.test/p/1/101/x.proxy",
      "Retrieved: 2026-10-09",
    ].join("\n");
    const urls = parseSourceUrls(text);
    expect(urls.get("x.obj")).toBe("http://h.test/p/1/100/x.obj");
    expect(urls.get("x.proxy")).toBe("http://h.test/p/1/101/x.proxy");
  });

  it("names all six committed sources with a hash and a URL each", () => {
    const manifest = sculptManifest();
    const names = manifest.files.map((f) => `${f.asset}/${f.name}`).sort();
    expect(names).toEqual([
      "Male_Gen-Heal1/Male_Gen-Heal1.obj",
      "Male_Gen-Heal1/Male_Gen-Heal1.proxy",
      "adult_female_2020_v_01/adult_female_2020_v_01.obj",
      "adult_female_2020_v_01/adult_female_2020_v_01.proxy",
      "adult_male_genitalia_breast_fix/adult_male_genitalia_breast_fix.obj",
      "adult_male_genitalia_breast_fix/adult_male_genitalia_breast_fix.proxy",
    ]);
    for (const f of manifest.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.url).toMatch(
        /^http:\/\/www\.makehumancommunity\.org\/sites\/default\/files\/proxies\//,
      );
    }
    // The three .obj hashes the policy review matched against the live downloads.
    const obj = (n: string) => manifest.files.find((f) => f.name === n)?.sha256;
    expect(obj("Male_Gen-Heal1.obj")).toMatch(/^716972d1/);
    expect(obj("adult_female_2020_v_01.obj")).toMatch(/^4e1371c5/);
    expect(obj("adult_male_genitalia_breast_fix.obj")).toMatch(/^78092e99/);
  });
});

/** A one-asset metadata directory, as `packs/adult-anatomy/source` is laid out. */
function metaFixture(opts: { part: Uint8Array }) {
  const source = bytes("v 1 2 3\n");
  const proxy = bytes("# proxy\n");
  const meta = path.join(dir, "meta");
  fs.mkdirSync(path.join(meta, "tiny"), { recursive: true });
  fs.writeFileSync(
    path.join(meta, "PROVENANCE.md"),
    `| \`tiny\` | \`tiny.obj\` \`${digest(source)}\`; \`tiny.proxy\` \`${digest(proxy)}\` |\n`,
  );
  fs.writeFileSync(
    path.join(meta, "tiny", "LICENSE-SOURCE.txt"),
    "Files from: http://h.test/tiny.obj, http://h.test/tiny.proxy\n",
  );
  const cuts = {
    source: "tiny.obj",
    sha256: digest(source),
    subdivisions: 2,
    parts: { cap: { planes: [], seed: [0, 0, 0], disc: true, objSha256: digest(opts.part) } },
  };
  fs.writeFileSync(path.join(meta, "tiny", "cuts.json"), `${JSON.stringify(cuts, null, 2)}\n`);
  const fetcher: Fetcher = async (url) => (url.endsWith(".obj") ? source : proxy);
  const cache = path.join(dir, "cache");
  return { meta, cache, fetcher, cuts };
}

describe("ensureSculptSources", () => {
  const part = bytes("v 0 0 0\nf 1 1 1\n");

  it("fetches and verifies the sources, then cuts them with Blender into the cache", async () => {
    const f = metaFixture({ part });
    const cut: string[] = [];
    await ensureSculptSources({
      metaDir: f.meta,
      cacheRoot: f.cache,
      fetcher: f.fetcher,
      cutWith: async (src, out) => {
        cut.push(path.basename(src));
        fs.writeFileSync(path.join(out, "cap.obj"), part);
        fs.writeFileSync(
          path.join(out, "cuts.json"),
          fs.readFileSync(path.join(f.meta, "tiny", "cuts.json")),
        );
      },
    });
    expect(cut).toEqual(["tiny.obj"]);
    expect(fs.readdirSync(path.join(f.cache, "tiny")).sort()).toEqual([
      "cap.obj",
      "tiny.obj",
      "tiny.proxy",
    ]);
  });

  it("does not cut again when the cached cuts still verify", async () => {
    const f = metaFixture({ part });
    let cuts = 0;
    const cutWith = async (_src: string, out: string) => {
      cuts++;
      fs.writeFileSync(path.join(out, "cap.obj"), part);
      fs.writeFileSync(
        path.join(out, "cuts.json"),
        fs.readFileSync(path.join(f.meta, "tiny", "cuts.json")),
      );
    };
    const opts = { metaDir: f.meta, cacheRoot: f.cache, fetcher: f.fetcher, cutWith };
    await ensureSculptSources(opts);
    await ensureSculptSources(opts);
    expect(cuts).toBe(1);
  });

  it("fails closed when a regenerated cut is not the one recorded, caching nothing of it", async () => {
    const f = metaFixture({ part });
    await expect(
      ensureSculptSources({
        metaDir: f.meta,
        cacheRoot: f.cache,
        fetcher: f.fetcher,
        cutWith: async (_src, out) => {
          fs.writeFileSync(path.join(out, "cap.obj"), bytes("v 9 9 9\n"));
          fs.writeFileSync(path.join(out, "cuts.json"), "{}\n");
        },
      }),
    ).rejects.toThrow(/not the cut recorded.*cap\.obj/s);
    expect(fs.existsSync(path.join(f.cache, "tiny", "cap.obj"))).toBe(false);
  });

  it("fails closed with a clear message when Blender is unavailable", async () => {
    const f = metaFixture({ part });
    const err = await ensureSculptSources({
      metaDir: f.meta,
      cacheRoot: f.cache,
      fetcher: f.fetcher,
      blender: () => null,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BlenderUnavailableError);
    expect((err as Error).message).toMatch(/Blender/);
    expect((err as Error).message).toMatch(/BLENDER/);
    expect(fs.existsSync(path.join(f.cache, "tiny", "cap.obj"))).toBe(false);
  });

  it("does not need Blender when every cut is already cached and verified", async () => {
    const f = metaFixture({ part });
    const cutWith = async (_src: string, out: string) => {
      fs.writeFileSync(path.join(out, "cap.obj"), part);
      fs.writeFileSync(
        path.join(out, "cuts.json"),
        fs.readFileSync(path.join(f.meta, "tiny", "cuts.json")),
      );
    };
    await ensureSculptSources({ metaDir: f.meta, cacheRoot: f.cache, fetcher: f.fetcher, cutWith });
    await ensureSculptSources({
      metaDir: f.meta,
      cacheRoot: f.cache,
      fetcher: f.fetcher,
      blender: () => null,
    });
  });

  it("re-cuts a cached cut that no longer matches its recorded hash", async () => {
    const f = metaFixture({ part });
    let cuts = 0;
    const cutWith = async (_src: string, out: string) => {
      cuts++;
      fs.writeFileSync(path.join(out, "cap.obj"), part);
      fs.writeFileSync(
        path.join(out, "cuts.json"),
        fs.readFileSync(path.join(f.meta, "tiny", "cuts.json")),
      );
    };
    const opts = { metaDir: f.meta, cacheRoot: f.cache, fetcher: f.fetcher, cutWith };
    await ensureSculptSources(opts);
    fs.writeFileSync(path.join(f.cache, "tiny", "cap.obj"), "tampered");
    await ensureSculptSources(opts);
    expect(cuts).toBe(2);
    expect(digest(fs.readFileSync(path.join(f.cache, "tiny", "cap.obj")))).toBe(digest(part));
  });
});
