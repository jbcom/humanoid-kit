import { describe, expect, it } from "vitest";
import { generateReservoirLayout } from "./adultReservoirLayout.ts";

/**
 * The adult pack is made on one machine and checked on others (an arm64 Mac makes it,
 * x86-64 Linux CI verifies it), and the two disagree in the last bit of `Math.sin`,
 * `cos`, `atan2`, `exp` and the rest: V8 ships its own libm per architecture. The
 * reservoir generator therefore must not let a last bit decide anything. Its disc
 * (`scripts/lib/detail/smoothLoop.ts`) is mirror-symmetric on the body's midline, so
 * points the generator looks up land exactly on an edge between two triangles of the
 * map, and which of them "holds" such a point was decided by rounding noise of 1e-15
 * (the ownership of a new polygon, the triangle a faired loop vertex stands on). These
 * tests rerun the whole layout with every transcendental function moved one unit in
 * the last place, each way and mixed, as another platform's would be, and hold the
 * result to the unmoved one byte for byte: no tolerance, nothing relaxed.
 */

const MOVED = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "exp",
  "log",
  "pow",
  "hypot",
  "cbrt",
] as const;

const floats = new Float64Array(1);
const bits = new BigInt64Array(floats.buffer);

/** The neighbouring double of `x`, one unit in the last place above (`up`) or below it. */
function nextDouble(x: number, up: boolean): number {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  floats[0] = x;
  bits[0] = (bits[0] as bigint) + (up === x > 0 ? 1n : -1n);
  return floats[0] as number;
}

/** A pseudo-random but repeatable choice of direction from a call's arguments. */
function mixed(args: readonly number[]): boolean {
  let h = 2166136261;
  for (const a of args) {
    floats[0] = a;
    const w = Number((bits[0] as bigint) & 0xffffffffn) ^ Number((bits[0] as bigint) >> 32n);
    h = Math.imul(h ^ w, 16777619);
  }
  return ((h >>> 7) & 1) === 1;
}

/** `run` with the transcendental functions of `Math` moved a unit in the last place. */
function underRounding<T>(direction: "up" | "down" | "mixed", run: () => T): T {
  const original = new Map<string, (...args: number[]) => number>();
  for (const name of MOVED) {
    const f = Math[name] as (...args: number[]) => number;
    original.set(name, f);
    Object.defineProperty(Math, name, {
      configurable: true,
      writable: true,
      value: (...args: number[]) =>
        nextDouble(f(...args), direction === "mixed" ? mixed(args) : direction === "up"),
    });
  }
  try {
    return run();
  } finally {
    for (const [name, f] of original)
      Object.defineProperty(Math, name, { configurable: true, writable: true, value: f });
  }
}

/** Every place two layouts differ, as readable paths (a changed length stops the descent there). */
function differences(a: unknown, b: unknown, path = "layout", out: string[] = []): string[] {
  if (Object.is(a, b)) return out;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    out.push(`${path}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) {
    out.push(`${path}: length ${a.length} against ${b.length}`);
    return out;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
    differences(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${path}.${key}`,
      out,
    );
  return out;
}

/** The differences grouped by the record they are in (`layout.patches.2.polygons`), and the first few in full. */
function report(found: readonly string[]): string[] {
  const groups = new Map<string, number>();
  for (const line of found) {
    const key = /^layout\.\w+(\.\d+)?(\.\w+)?/.exec(line)?.[0] ?? line;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [
    `${found.length} differences`,
    ...[...groups].map(([key, n]) => `  ${n} in ${key}`),
    ...found.slice(0, 12),
  ];
}

describe("the adult pack's reservoir layout under another platform's rounding", {
  timeout: 600_000,
}, () => {
  const reference = generateReservoirLayout();

  it("is a pure function of its input: two runs agree exactly", () => {
    expect(report(differences(generateReservoirLayout(), reference))).toEqual(["0 differences"]);
  });

  for (const direction of ["up", "down", "mixed"] as const)
    it(`is the same layout with every transcendental function a unit in the last place ${direction === "mixed" ? "off either way" : direction}`, () => {
      const moved = underRounding(direction, generateReservoirLayout);
      expect(report(differences(moved, reference))).toEqual(["0 differences"]);
    });
});
