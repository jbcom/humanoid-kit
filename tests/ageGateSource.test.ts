/**
 * Keeps the age gate to one predicate (docs/AGE-POLICY.md, "One predicate
 * decides who is an adult"). A hand-written comparison of an age to 18 is wrong
 * in one direction or the other for a value that is not a finite number: `<`
 * lets NaN and a missing age through as adults, `>=` lets Infinity through.
 * The check reads source, so a new route cannot be added without it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOTS = ["src", "playground/src", "scripts"];
/** The one place the comparison lives. */
const HELPER = "src/makehuman/macro.ts";

const sourceFiles = (dir: string): string[] =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sourceFiles(rel);
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [rel] : [];
  });

/** An age (`age`, `x.age`, `macros.age`) set against the adult line, either way round. */
const RAW_COMPARISON =
  /\bage\b\s*(?:<=?|>=?)\s*(?:ADULT_AGE|18\b)|(?:ADULT_AGE|\b18)\s*(?:<=?|>=?)\s*[\w.]*\bage\b/;

/** The code of a line: comment lines and trailing `//` comments removed. */
const codeOf = (line: string): string => {
  const t = line.trim();
  if (t.startsWith("*") || t.startsWith("/*") || t.startsWith("//")) return "";
  return line.replace(/\s\/\/.*$/, "");
};

describe("the adult line", () => {
  it("is compared by isAdultAge alone: no source compares an age to 18 itself", () => {
    const found: string[] = [];
    for (const file of ROOTS.flatMap(sourceFiles)) {
      const rel = file.split(path.sep).join("/");
      if (rel === HELPER) continue;
      readFileSync(path.join(root, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (RAW_COMPARISON.test(codeOf(line))) found.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(found).toEqual([]);
  });

  it("is found by the scan: it sees the helper's own comparison", () => {
    const src = readFileSync(path.join(root, HELPER), "utf8");
    expect(src.split("\n").some((l) => RAW_COMPARISON.test(codeOf(l)))).toBe(true);
  });
});
