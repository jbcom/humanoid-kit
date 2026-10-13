import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [directory, ...expectedLabels] = process.argv.slice(2);
const workspace = process.env.GITHUB_WORKSPACE;
const repository = process.env.GITHUB_REPOSITORY?.split("/").at(-1);

if (!directory || !workspace || !repository)
  throw new Error(
    "coverage blob path normalization requires a directory, GITHUB_WORKSPACE, and GITHUB_REPOSITORY",
  );

const blobDirectory = resolve(directory);
const entries = (await readdir(blobDirectory)).filter((entry) => entry.endsWith(".json"));
for (const label of expectedLabels) {
  const matches = entries.filter((entry) => entry.startsWith(`blob-${label}`));
  if (matches.length !== 1)
    throw new Error(`expected exactly one blob labelled ${label}; found ${matches.length}`);
}

const macRoot = `/Users/runner/work/${repository}/${repository}`;
const linuxRoot = `/home/runner/work/${repository}/${repository}`;
let normalized = 0;

for (const entry of entries) {
  if (!entry.endsWith(".json")) continue;
  const path = resolve(blobDirectory, entry);
  const contents = await readFile(path, "utf8");
  const rewritten = contents.replaceAll(macRoot, workspace).replaceAll(linuxRoot, workspace);
  if (rewritten.includes("/Users/runner/work/") || rewritten.includes("/home/runner/work/"))
    throw new Error(`unmapped GitHub workspace path remains in ${entry}`);
  if (rewritten !== contents) {
    await writeFile(path, rewritten);
    normalized++;
  }
}

console.log(`Normalized ${normalized} coverage blob(s) to ${workspace}.`);
