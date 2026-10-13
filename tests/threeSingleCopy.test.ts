/**
 * One copy of three in the unit project's process, and it is the ESM build.
 *
 * `@react-three/fiber` and `@react-three/drei` publish no `exports` map, so Node
 * resolves their `main`, a CommonJS build that `require("three")`s. That loads
 * `three/build/three.cjs` beside the ESM `three.module.js` the library itself
 * imports: three prints `THREE_CJS_DEPRECATED`, and every class exists twice, so
 * an `instanceof` across the two copies is false. The unit project inlines those
 * packages (vitest.config.ts, `server.deps.inline`) so Vite resolves their ESM
 * `module` build, which imports the one ESM three.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireCache = () => createRequire(import.meta.url).cache;
const loaded = (pattern: RegExp) =>
  Object.keys(requireCache()).filter((file) => pattern.test(file));

/**
 * A fresh Node process has neither Vitest's ESM resolver nor this file's module
 * cache. That is the boundary the response-sheet fixture used to cross by
 * importing `react/CoatMesh` just to reach its pure assertion helper.
 */
function freshWarningCodes(specifier: string): string[] {
  const run = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        const codes = [];
        process.on("warning", (warning) => codes.push(warning.code));
        await import(process.argv[1]);
        await new Promise((done) => setImmediate(done));
        process.stdout.write(JSON.stringify(codes));
      `,
      specifier,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as string[];
}

describe("the unit project loads one ESM copy of three", () => {
  it("keeps the response-sheet assertion on the green side of the Node CJS boundary", () => {
    // RED witness: the old `react/CoatMesh` fixture path imports this root,
    // whose Node `main` is its CJS build and requires three's deprecated CJS
    // entry. It must keep warning in a fresh process, or this test no longer
    // demonstrates the boundary that motivated the extraction.
    expect(freshWarningCodes("@react-three/fiber")).toContain("THREE_CJS_DEPRECATED");
    // GREEN assertion: the extracted pure ESM helper crosses none of it.
    expect(freshWarningCodes("./src/surface/coatPaint.ts")).not.toContain("THREE_CJS_DEPRECATED");
  });

  it("raises no THREE_CJS_DEPRECATED warning when the react entry loads", async () => {
    const codes: string[] = [];
    const onWarning = (warning: Error & { code?: string }) => {
      if (warning.code) codes.push(warning.code);
    };
    process.on("warning", onWarning);
    try {
      await import("../src/react/index.ts");
      // Node emits process warnings on a later tick.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", onWarning);
    }
    expect(codes).not.toContain("THREE_CJS_DEPRECATED");
  });

  it("never loads three's CommonJS build", async () => {
    await import("../src/react/index.ts");
    expect(loaded(/[\\/]three[\\/]build[\\/]three\.(cjs|core\.cjs)$/)).toEqual([]);
  });

  it("never loads the CommonJS builds of fiber or drei", async () => {
    await import("../src/react/index.ts");
    expect(loaded(/[\\/]@react-three[\\/](fiber|drei)[\\/]/)).toEqual([]);
  });
});
