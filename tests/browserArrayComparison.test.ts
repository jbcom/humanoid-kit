/**
 * The browser suite compares large buffers through `expectSameArray`, never through a
 * raw `toEqual` (tests/browser/arrays.ts): vitest formats the diff of a failed
 * 16k-element `toEqual` for so long that the render pool's job timeout kills the run.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectSameArray } from "./browser/arrays.ts";
import { findRawArrayComparisons, MAX_LITERAL } from "./browserArrayScan.ts";

const BROWSER = join(import.meta.dirname, "browser");

describe("expectSameArray", () => {
  it("passes equal buffers, exactly and within a tolerance", () => {
    expectSameArray(new Float32Array([1, 2, 3]), new Float32Array([1, 2, 3]));
    expectSameArray([0, Number.NaN], [-0, Number.NaN]);
    expectSameArray([1, 2], [1.05, 1.95], { tolerance: 0.1 });
  });

  it("names the length when the lengths differ", () => {
    expect(() => expectSameArray([1, 2], [1, 2, 3], { what: "a row" })).toThrow(
      "a row: length 2, expected 3",
    );
  });

  it("counts the differences and lists only the first few", () => {
    const size = 1 << 18;
    const a = new Float32Array(size);
    const b = new Float32Array(size).fill(1);
    let message = "";
    try {
      expectSameArray(a, b, { what: "a render", show: 3 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      `a render: ${size} of ${size} elements differ; the largest gap is 1 at [0]; ` +
        "first 3: [0] 0 vs 1, [1] 0 vs 1, [2] 0 vs 1",
    );
  });

  it("states the tolerance and fails on the elements outside it", () => {
    expect(() => expectSameArray([1, 2, 3], [1, 2.5, 3.01], { tolerance: 0.1 })).toThrow(
      /1 of 3 elements differ by more than 0\.1; the largest gap is 0\.5 at \[1\]; first 1: \[1\] 2 vs 2\.5/,
    );
  });

  it("does not match a NaN to a number", () => {
    expect(() => expectSameArray([Number.NaN], [0], { tolerance: 1 })).toThrow(
      "1 of 1 elements differ by more than 1; the largest gap is Infinity at [0]",
    );
  });

  it("fails a large mismatch at once rather than formatting a diff", () => {
    const a = new Float32Array(1 << 20);
    const b = new Float32Array(1 << 20).fill(1);
    const started = performance.now();
    expect(() => expectSameArray(a, b)).toThrow("1048576 of 1048576 elements differ");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("refuses a negative tolerance", () => {
    expect(() => expectSameArray([1], [1], { tolerance: -1 })).toThrow("tolerance -1");
  });
});

describe("findRawArrayComparisons", () => {
  const flags = (code: string) => findRawArrayComparisons(code).map((f) => f.matcher);

  it("flags a typed array, an Array.from and a render result compared raw", () => {
    expect(flags("expect(new Float32Array(9)).toEqual(other);")).toEqual(["toEqual"]);
    expect(flags("expect(Array.from(px)).toStrictEqual([0]);")).toEqual(["toStrictEqual"]);
    expect(
      flags(`import { renderLayers as render } from "./layerRender.ts";
        const flat = render([]);
        expect(render([line()])).toEqual(flat);`),
    ).toEqual(["toEqual"]);
  });

  it("follows a render result through the names it is bound to", () => {
    expect(
      flags(`import { renderLayersRgba } from "./layerRender.ts";
        const a = renderLayersRgba([]);
        const b = a;
        expect(1).not.toEqual(b);`),
    ).toEqual(["toEqual"]);
  });

  it("flags an array literal over the limit and not one at it", () => {
    const literal = (n: number) => `[${Array.from({ length: n }, (_, i) => i).join(", ")}]`;
    expect(flags(`expect(x).toEqual(${literal(MAX_LITERAL + 1)});`)).toEqual(["toEqual"]);
    expect(flags(`expect(x).toEqual(${literal(MAX_LITERAL)});`)).toEqual([]);
    expect(flags(`expect(x).toEqual([${"[1, 2, 3],".repeat(5)}]);`)).toEqual([]);
  });

  it("leaves small, ordinary comparisons and comments alone", () => {
    expect(
      flags(`// expect(new Float32Array(9)).toEqual(other);
        const note = "expect(Array.from(x)).toEqual(y)";
        expect(registry.all().map((p) => p.id)).toEqual(["seen"]);
        await expect.poll(() => events).toEqual([]);
        expect(centre(texture, 0, SIZE)).toEqual([0, 0, 0, 0]);`),
    ).toEqual([]);
  });

  it("reports the line", () => {
    expect(findRawArrayComparisons("\n\nexpect(new Uint8Array(4)).toEqual(x);")[0]?.line).toBe(3);
  });
});

describe("the browser tests", () => {
  const files = readdirSync(BROWSER).filter((f) => /\.tsx?$/.test(f) && f !== "arrays.ts");

  it("find the files to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("compare no large buffer with a raw toEqual or toStrictEqual", () => {
    const raw = files.flatMap((file) =>
      findRawArrayComparisons(readFileSync(join(BROWSER, file), "utf8")).map(
        (f) => `${file}:${f.line} ${f.matcher} on ${f.why}`,
      ),
    );
    expect(raw, "use expectSameArray from tests/browser/arrays.ts").toEqual([]);
  });
});
