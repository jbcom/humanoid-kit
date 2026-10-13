import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type MacroValues, macroTargetWeights } from "../src/makehuman/macro.ts";

/**
 * Golden parity with MakeHuman itself. `fixtures/macro-parity.json` holds the macro
 * target weights MakeHuman 1.x computes (its own `human.py` setters and `MacroModifier`,
 * run headless) for a fixed sweep of slider settings, as `[name index, weight]` pairs.
 * The kit must produce the same weights for every target MakeHuman ships with data.
 * The fixture's sweep leaves out ages strictly between 10 and 25 (it was cut while the
 * kit held its adult body from 18, a hold since reversed); `macroParity.test.ts`
 * checks the age axis against MakeHuman's curve over that band, every half year.
 */

interface Fixture {
  about: string;
  emptyUpstreamTargets: string[];
  names: string[];
  samples: { label: string; macros: MacroValues; weights: [number, number][] }[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL("./fixtures/macro-parity.json", import.meta.url), "utf8"),
);
const empty = new Set(fixture.emptyUpstreamTargets);
const TOL = 1e-9;

describe("macro target weights match MakeHuman's own output", () => {
  it("sweeps a meaningful sample of slider settings", () => {
    expect(fixture.samples.length).toBeGreaterThanOrEqual(100);
    expect(fixture.names.length).toBeGreaterThan(400);
  });

  it.each(fixture.samples.map((s) => [s.label, s] as const))("%s", (_label, sample) => {
    const want = new Map(sample.weights.map(([i, w]) => [fixture.names[i] ?? `#${i}`, w]));
    const got = macroTargetWeights(sample.macros);
    const mismatches: string[] = [];
    for (const [name, w] of want) {
      const k = got.get(name) ?? 0;
      if (Math.abs(k - w) > TOL) mismatches.push(`${name}: kit ${k}, MakeHuman ${w}`);
    }
    for (const [name, k] of got) {
      if (want.has(name) || empty.has(name) || Math.abs(k) <= TOL) continue;
      mismatches.push(`${name}: kit ${k}, MakeHuman 0`);
    }
    expect(mismatches).toEqual([]);
  });
});
