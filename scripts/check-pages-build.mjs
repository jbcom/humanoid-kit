/**
 * Fails when a built public site contains any part of the adult anatomy pack.
 *
 *   node scripts/check-pages-build.mjs [app-dir ...]   (default: dist-playground, plus docs/dist)
 *
 * The public demo is built from the body pack only. Every built file is checked
 * for the adult pack's data files (by SHA-256), so no copy of the pack can
 * ship. App builds are also checked for the pack's package name and the names
 * of its targets and modifiers, so no import or bundled table can slip
 * through. The documentation site is checked for data only: its prose
 * legitimately names the package and documents its modifiers.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const adultDir = path.join(root, "packs/adult-anatomy/data");
const manifest = JSON.parse(fs.readFileSync(path.join(adultDir, "manifest.json"), "utf8"));
const hash = (buf) => createHash("sha256").update(buf).digest("hex");

const targets = fs.readFileSync(path.join(adultDir, manifest.targets.file));
// The targets as shipped (gzip) and decoded, in case a build stores them decompressed.
const forbiddenHashes = new Set([
  hash(targets),
  hash(gunzipSync(targets)),
  hash(fs.readFileSync(path.join(adultDir, "manifest.json"))),
]);
const forbiddenStrings = [
  "humanoid-kit-adult-anatomy",
  ...manifest.targets.entries.map((e) => e.name),
  ...manifest.modifiers.map((m) => m.id),
];

const args = process.argv.slice(2);
const dirs = [
  ...(args.length ? args : ["dist-playground"]).map((d) => ({ d, app: true })),
  ...(args.length ? [] : [{ d: "docs/dist", app: false }]),
];
const problems = [];
let scanned = 0;

/**
 * Bundlers inline small assets as data URIs (Vite: under 4 KB, which the adult
 * manifest is), so a file's embedded data URIs are decoded and checked as
 * files in their own right.
 */
function dataUris(text) {
  const out = [];
  for (const m of text.matchAll(
    /data:(?:[\w.+-]+\/[\w.+-]+)?(?:;(?!base64[,;])[\w=.+-]+)*(;base64)?,([^"'`)\s]*)/gi,
  )) {
    // Percent escapes decode to raw bytes (not UTF-8 text, which binary data is not).
    const bytes = Buffer.from(
      m[2].replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16))),
      "latin1",
    );
    out.push(m[1] ? Buffer.from(bytes.toString("latin1"), "base64") : bytes);
  }
  return out;
}

function check(label, buf, app) {
  if (forbiddenHashes.has(hash(buf))) problems.push(`${label}: is an adult anatomy pack file`);
  const text = buf.toString("utf8");
  // App files are scanned as text whatever their extension: names survive in any text format.
  if (app)
    for (const s of forbiddenStrings)
      if (text.includes(s)) problems.push(`${label}: contains "${s}"`);
  dataUris(text).forEach((inner, i) => {
    check(`${label} (data URI ${i + 1})`, inner, app);
  });
}

function walk(dir, app) {
  let files = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      files += walk(file, app);
      continue;
    }
    files++;
    check(file, fs.readFileSync(file), app);
  }
  return files;
}

for (const { d, app } of dirs) {
  const abs = path.resolve(root, d);
  if (!fs.existsSync(abs)) {
    problems.push(`${d}: build output not found (build it before running this check)`);
    continue;
  }
  const files = walk(abs, app);
  if (files === 0) problems.push(`${d}: build output is empty`);
  scanned += files;
}

if (problems.length) {
  console.error(`check-pages-build: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(
  `check-pages-build: ${scanned} built files contain nothing from the adult anatomy pack`,
);
