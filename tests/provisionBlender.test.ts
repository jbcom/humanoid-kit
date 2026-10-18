import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BLENDER_VERSION,
  type BlenderRelease,
  blenderRelease,
  provisionBlender,
} from "../scripts/lib/provisionBlender.ts";
import { SourceFetchError } from "../scripts/lib/sourceFetch.ts";

/** The pinned Blender that CI extracts when a runner has none. Nothing here touches the network. */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hk-blender-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const archive = new TextEncoder().encode("not really a tarball");
const release: BlenderRelease = {
  version: "0.0.0",
  file: "blender-0.0.0-linux-x64.tar.xz",
  url: "https://download.example.test/blender-0.0.0-linux-x64.tar.xz",
  sha256: createHash("sha256").update(archive).digest("hex"),
  dir: "blender-0.0.0-linux-x64",
  binary: "blender-0.0.0-linux-x64/blender",
};

/** An extraction that leaves an executable where the release says it is. */
const extracting = async (_archive: string, toolDir: string) => {
  fs.mkdirSync(path.join(toolDir, release.dir), { recursive: true });
  fs.writeFileSync(path.join(toolDir, release.binary), "#!/bin/sh\n");
};

describe("the pinned Blender", () => {
  it("is the version the cuts were proven with, on an https URL, with a SHA-256", () => {
    const r = blenderRelease("linux", "x64");
    expect(r.version).toBe(BLENDER_VERSION);
    expect(BLENDER_VERSION).toBe("5.1.1");
    expect(r.url).toBe(
      "https://download.blender.org/release/Blender5.1/blender-5.1.1-linux-x64.tar.xz",
    );
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.binary).toBe("blender-5.1.1-linux-x64/blender");
  });

  it("is pinned for Linux x64 only: anywhere else it says to install Blender and set BLENDER", () => {
    for (const [platform, arch] of [
      ["darwin", "arm64"],
      ["linux", "arm64"],
      ["win32", "x64"],
    ] as const)
      expect(() => blenderRelease(platform, arch)).toThrow(/set BLENDER/);
  });
});

describe("provisionBlender", () => {
  it("downloads the archive, extracts it, and leaves no archive behind", async () => {
    const urls: string[] = [];
    const got = await provisionBlender({
      toolDir: dir,
      release,
      fetcher: async (url) => {
        urls.push(url);
        return archive;
      },
      extract: extracting,
    });
    expect(got).toBe(path.join(dir, release.binary));
    expect(urls).toEqual([release.url]);
    expect(fs.existsSync(path.join(dir, release.file))).toBe(false);
  });

  it("refuses an archive that does not hash to the pin, and extracts nothing", async () => {
    let extracted = false;
    const err = await provisionBlender({
      toolDir: dir,
      release,
      fetcher: async () => new TextEncoder().encode("swapped"),
      extract: async () => {
        extracted = true;
      },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect(extracted).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("does not download again once an extraction is marked as verified", async () => {
    const opts = { toolDir: dir, release, extract: extracting };
    await provisionBlender({ ...opts, fetcher: async () => archive });
    let calls = 0;
    const got = await provisionBlender({
      ...opts,
      fetcher: async () => {
        calls++;
        return archive;
      },
    });
    expect(got).toBe(path.join(dir, release.binary));
    expect(calls).toBe(0);
  });

  it("extracts again when the marker does not name the pinned hash", async () => {
    const opts = { toolDir: dir, release, extract: extracting };
    await provisionBlender({ ...opts, fetcher: async () => archive });
    fs.writeFileSync(path.join(dir, release.dir, ".verified-sha256"), "stale");
    let calls = 0;
    await provisionBlender({
      ...opts,
      fetcher: async () => {
        calls++;
        return archive;
      },
    });
    expect(calls).toBe(1);
  });

  it("fails when the archive does not contain the executable", async () => {
    await expect(
      provisionBlender({
        toolDir: dir,
        release,
        fetcher: async () => archive,
        extract: async () => {},
      }),
    ).rejects.toThrow(/did not extract/);
  });
});
