/**
 * The adult pack's tarball carries what makes its age rule visible to whoever
 * installs it: the README that states the rule, the licences and the data. A
 * file dropped from `files` would ship the pack without them.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, "packs/adult-anatomy");

interface PackListing {
  files: { path: string }[];
}

const listing = (): string[] => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, npm_config_loglevel: "silent" },
  });
  const start = out.indexOf("[");
  return (JSON.parse(out.slice(start)) as PackListing[])[0]?.files.map((f) => f.path) ?? [];
};

describe("the adult anatomy pack's tarball", () => {
  const files = listing();

  it("carries the README that states the age rule, and its one licence, CC0", () => {
    for (const f of ["README.md", "LICENSE", "package.json"]) expect(files).toContain(f);
    // The pack ships CC0 sources only (5d21909b): no attribution licence rides along unearned.
    expect(files.filter((f) => /^LICENSE-|^NOTICE/.test(f))).toEqual([]);
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      license: string;
    };
    expect(pkg.license).toBe("CC0-1.0");
  });

  it("carries its data and its entry point", () => {
    for (const f of ["index.js", "index.d.ts", "data/manifest.json", "data/targets.bin.gz"])
      expect(files).toContain(f);
  });

  it("states the age rule and the deploy check in the README it ships", () => {
    const readme = readFileSync(path.join(dir, "README.md"), "utf8");
    expect(readme).toMatch(/18 or over/);
    expect(readme).toMatch(/check:pages/);
  });
});
