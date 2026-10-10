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
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireCache = () => createRequire(import.meta.url).cache;
const loaded = (pattern: RegExp) =>
  Object.keys(requireCache()).filter((file) => pattern.test(file));

describe("the unit project loads one ESM copy of three", () => {
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
