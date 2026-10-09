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

const root = path.resolve(import.meta.dirname, "..");
const adultDir = path.join(root, "packs/adult-anatomy/data");
const manifest = JSON.parse(fs.readFileSync(path.join(adultDir, "manifest.json"), "utf8"));
const hash = (buf) => createHash("sha256").update(buf).digest("hex");

const forbiddenHashes = new Set([
  hash(fs.readFileSync(path.join(adultDir, "targets.bin"))),
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

function walk(dir, app) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(file, app);
      continue;
    }
    scanned++;
    const buf = fs.readFileSync(file);
    if (forbiddenHashes.has(hash(buf))) problems.push(`${file}: is an adult anatomy pack file`);
    if (app && /\.(js|mjs|html|json|css|map|txt|md)$/.test(file)) {
      const text = buf.toString("utf8");
      for (const s of forbiddenStrings)
        if (text.includes(s)) problems.push(`${file}: contains "${s}"`);
    }
  }
}

for (const { d, app } of dirs) {
  const abs = path.resolve(root, d);
  if (!fs.existsSync(abs)) {
    problems.push(`${d}: build output not found (build it before running this check)`);
    continue;
  }
  walk(abs, app);
}

if (problems.length) {
  console.error(`check-pages-build: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(
  `check-pages-build: ${scanned} built files contain nothing from the adult anatomy pack`,
);
