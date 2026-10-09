#!/usr/bin/env node
// Packed-consumer smoke test for all three packages. Packs humanoid-kit and its
// two data packs, checks each tarball's contents, checks that the body pack
// carries nothing from the adult anatomy pack, then installs the tarballs into
// an empty scratch project against the public npm registry only (no scoped
// registry, no token) and imports every entry point as ESM. Everything is
// ESM-only, so there is deliberately no CommonJS leg.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmNeedsShell = process.platform === "win32";

// pnpm forwards its own npm_config_* settings to child processes; give npm a
// clean configuration pinned to the public registry with an empty user config.
const npmEnvironment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
  ),
  SKIP_INSTALL_SIMPLE_GIT_HOOKS: "1",
  npm_config_registry: "https://registry.npmjs.org/",
  npm_config_userconfig: process.platform === "win32" ? "NUL" : "/dev/null",
};

/** Packs a package directory into workDir and returns npm's pack manifest. */
function pack(dir, workDir) {
  const out = execFileSync(
    npm,
    ["pack", "--pack-destination", workDir, "--ignore-scripts", "--json"],
    {
      cwd: dir,
      encoding: "utf8",
      env: npmEnvironment,
      shell: npmNeedsShell,
    },
  );
  const end = out.lastIndexOf("]");
  for (const match of out.matchAll(/^\[/gm)) {
    try {
      return JSON.parse(out.slice(match.index, end + 1))[0];
    } catch {
      // Not the array start (e.g. an "[INFO]" line); try the next "[".
    }
  }
  throw new Error(`npm pack returned no parseable manifest:\n${out}`);
}

const CODE_ENTRIES = [
  {
    specifier: "humanoid-kit",
    file: "index",
    exports: [
      "createRecipe",
      "HumanoidModel",
      "HumanoidWorkerClient",
      "loadHumanoidAssets",
      "parseHumanoidAssets",
    ],
  },
  {
    specifier: "humanoid-kit/react",
    file: "react/index",
    exports: ["Humanoid", "HumanoidProvider", "StudioStage"],
  },
  {
    specifier: "humanoid-kit/editor",
    file: "editor/ui/index",
    exports: ["HumanoidCreator", "useHumanoidEditor", "SliderRow"],
  },
];
// The worker entry is a Web Worker script (it assigns `self.onmessage`), so it is
// checked for presence, not imported in Node.
const WORKER_FILE = "dist/worker/index.js";
const PEERS = ["three", "react", "react-dom", "@react-three/fiber", "@react-three/drei"];

const workDir = mkdtempSync(path.join(tmpdir(), "humanoid-kit-package-"));
try {
  const code = pack(root, workDir);
  const body = pack(path.join(root, "packs/body"), workDir);
  const adult = pack(path.join(root, "packs/adult-anatomy"), workDir);

  const codeFiles = new Set(code.files.map((f) => f.path));
  for (const f of ["LICENSE", "NOTICE.md", "README.md", "package.json", WORKER_FILE]) {
    assert(codeFiles.has(f), `humanoid-kit tarball is missing ${f}`);
  }
  for (const e of CODE_ENTRIES) {
    assert(codeFiles.has(`dist/${e.file}.js`), `humanoid-kit tarball is missing dist/${e.file}.js`);
    assert(
      codeFiles.has(`dist/${e.file}.d.ts`),
      `humanoid-kit tarball is missing dist/${e.file}.d.ts`,
    );
  }
  for (const prefix of [
    "src/",
    "tests/",
    "e2e/",
    "playground/",
    "scripts/",
    "packs/",
    "coverage/",
    "dist-playground/",
  ]) {
    assert(
      [...codeFiles].every((f) => !f.startsWith(prefix)),
      `humanoid-kit tarball contains ${prefix}`,
    );
  }

  for (const [label, p, files] of [
    [
      "humanoid-kit-body",
      body,
      [
        "index.js",
        "index.d.ts",
        "LICENSE",
        "README.md",
        "data/manifest.json",
        "data/PROVENANCE.md",
        "data/body.bin",
        "data/targets.bin.gz",
        "data/attachments.bin",
      ],
    ],
    [
      "humanoid-kit-adult-anatomy",
      adult,
      [
        "index.js",
        "index.d.ts",
        "LICENSE",
        "README.md",
        "data/manifest.json",
        "data/PROVENANCE.md",
        "data/targets.bin.gz",
      ],
    ],
  ]) {
    const present = new Set(p.files.map((f) => f.path));
    for (const f of files) assert(present.has(f), `${label} tarball is missing ${f}`);
  }

  // The body pack must carry nothing from the adult anatomy pack.
  const adultManifest = JSON.parse(
    readFileSync(path.join(root, "packs/adult-anatomy/data/manifest.json"), "utf8"),
  );
  const bodyManifestText = readFileSync(path.join(root, "packs/body/data/manifest.json"), "utf8");
  for (const name of [
    ...adultManifest.targets.entries.map((e) => e.name),
    ...adultManifest.modifiers.map((m) => m.id),
  ]) {
    assert(
      !bodyManifestText.includes(`"${name}"`),
      `body pack manifest names adult-pack entry ${name}`,
    );
  }

  const consumer = path.join(workDir, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    path.join(consumer, "package.json"),
    `${JSON.stringify({ private: true, type: "module" })}\n`,
  );
  execFileSync(
    npm,
    [
      "install",
      "--no-audit",
      "--no-fund",
      ...[code, body, adult].map((p) => path.join(workDir, p.filename)),
      ...PEERS,
    ],
    { cwd: consumer, env: npmEnvironment, shell: npmNeedsShell, stdio: "pipe" },
  );
  const result = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
      import assert from "node:assert/strict";
      for (const e of ${JSON.stringify(CODE_ENTRIES)}) {
        const m = await import(e.specifier);
        for (const name of e.exports) assert.notEqual(m[name], undefined, e.specifier + " is missing " + name);
      }
      const { bodyPack } = await import("humanoid-kit-body");
      const { adultAnatomyPack } = await import("humanoid-kit-adult-anatomy");
      for (const p of [bodyPack, adultAnatomyPack]) {
        assert(p.manifest.startsWith("file:"), "pack manifest URL should resolve to the installed file");
        for (const url of Object.values(p.files)) assert(url.startsWith("file:"), "pack file URL should resolve");
      }
      process.stdout.write("ok");
      `,
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  assert.equal(result, "ok", "installed ESM smoke failed");
  console.log(
    `verify-package: ${code.entryCount} + ${body.entryCount} + ${adult.entryCount} files packed; every entry point imports`,
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
