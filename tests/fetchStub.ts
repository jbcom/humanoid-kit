import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { vi } from "vitest";
import { adultDir, bodyDir, clothingDir, hairDir } from "./fixtures.ts";

/**
 * Serves pack files from disk at http://packs/<body|adult|clothing|hair>/<file>, like a
 * static host. Returns the list of requested URLs, in order.
 */
export function stubFetch(
  options: {
    decompressGz?: boolean;
    missing?: string;
    /** Answers this file only once `until` settles. */
    hold?: { file: string; until: Promise<void> };
    /**
     * More packs by name, served at http://packs/<name>/: a manifest given as
     * an object and the other files from `dir`.
     */
    packs?: Record<string, { manifest: unknown; dir: string }>;
  } = {},
): string[] {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    requested.push(input);
    const url = new URL(input);
    const [, pack, file] = url.pathname.split("/");
    if (options.hold && file === options.hold.file) await options.hold.until;
    const extra = pack === undefined ? undefined : options.packs?.[pack];
    if (extra && file === "manifest.json") return new Response(JSON.stringify(extra.manifest));
    const dir = extra
      ? extra.dir
      : pack === "adult"
        ? adultDir
        : pack === "clothing"
          ? clothingDir
          : pack === "hair"
            ? hairDir
            : bodyDir;
    const p = path.join(dir, file ?? "");
    if (file === options.missing || !fs.existsSync(p))
      return new Response("not found", { status: 404, statusText: "Not Found" });
    let bytes: Uint8Array = fs.readFileSync(p);
    // A host that sends .gz with Content-Encoding: gzip hands the page decoded bytes.
    if (options.decompressGz && p.endsWith(".gz")) bytes = gunzipSync(bytes);
    return new Response(Uint8Array.from(bytes));
  });
  return requested;
}
