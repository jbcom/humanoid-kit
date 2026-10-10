/**
 * The browser suite makes its WebGL renderers in one place (tests/browser/gl.ts), which
 * loses each context when its file ends. A renderer that is only disposed keeps its
 * context, Chrome keeps about sixteen, and a whole-suite run then loses the later files'
 * contexts and reads NaN from them. This holds every file to the helper.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("./browser/", import.meta.url));
const sources = readdirSync(dir)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(`${dir}${f}`, "utf8") }));

describe("the browser suite's renderers", () => {
  it("are made only by the helper, never by a file's own constructor", () => {
    const own = sources.filter(
      (s) => s.file !== "gl.ts" && /new\s+(?:THREE\.)?WebGLRenderer\b/.test(s.text),
    );
    expect(own.map((s) => s.file)).toEqual([]);
  });

  it("are not disposed by a file: the helper disposes and loses each context at the end", () => {
    const own = sources.filter(
      (s) => s.file !== "gl.ts" && /\brenderer\??\.dispose\(\)|\.forceContextLoss\(\)/.test(s.text),
    );
    expect(own.map((s) => s.file)).toEqual([]);
  });

  it("include the helper itself, which loses the context as well as disposing", () => {
    const helper = sources.find((s) => s.file === "gl.ts")?.text ?? "";
    expect(helper).toMatch(/forceContextLoss\(\)/);
    expect(helper).toMatch(/\.dispose\(\)/);
    expect(helper).toMatch(/webglcontextlost/);
  });
});
