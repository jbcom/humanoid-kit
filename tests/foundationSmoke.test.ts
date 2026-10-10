/**
 * The foundation's smoke tier (docs/FOUNDATION.md), run in every unit pass:
 * every body at rest passes every invariant, and no posed row is worse than
 * the worklist recorded in docs/evidence/foundation-smoke.json. A lane that
 * fixes a failure rewrites the worklist (`node scripts/foundation-smoke.ts`)
 * in its commit.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REST_POSE } from "../src/foundation/permutations.ts";
import { SMOKE_STRIDE, smokeModelOptions } from "../src/foundation/smoke.ts";
import { rowPasses, runFoundation, type SuiteRow } from "../src/foundation/suite.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

const recorded: SuiteRow[] = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, "../docs/evidence/foundation-smoke.json"),
    "utf8",
  ),
);
const key = (r: SuiteRow) => `${r.body}/${r.pose}/${r.anatomy}`;

describe("the foundation's smoke tier", { timeout: 300_000 }, () => {
  const rows = runFoundation(
    new HumanoidModel(loadFixtureAssets(true), smokeModelOptions),
    "smoke",
    {
      adult: adultManifest,
      stride: SMOKE_STRIDE,
    },
  );

  it("measures every body × pose × anatomy of the tier, each for its three tones", () => {
    expect(rows).toHaveLength(6 * 4);
    for (const r of rows) expect(r.tones, key(r)).toEqual(["tone-1", "tone-3", "tone-6"]);
  });

  it("passes every invariant on every body at rest", () => {
    for (const r of rows.filter((x) => x.pose === REST_POSE))
      expect(rowPasses(r.measure), `${key(r)}: ${JSON.stringify(r.measure)}`).toBe(true);
  });

  it("is no worse anywhere than the recorded worklist", () => {
    const before = new Map(recorded.map((r) => [key(r), r.measure]));
    for (const r of rows) {
      const was = before.get(key(r));
      expect(was, `${key(r)} is not in the worklist`).toBeDefined();
      if (!was) continue;
      const m = r.measure;
      const label = `${key(r)} (rewrite the worklist when a row improves)`;
      expect(m.penetrating, label).toBeLessThanOrEqual(was.penetrating);
      expect(m.inverted, label).toBeLessThanOrEqual(was.inverted);
      expect(m.squashed, label).toBeLessThanOrEqual(was.squashed);
      expect(m.folds, label).toBeLessThanOrEqual(was.folds);
      expect(m.volumeOut.length, label).toBeLessThanOrEqual(was.volumeOut.length);
      expect(m.seamGap, label).toBeLessThanOrEqual(Math.max(was.seamGap, 1e-6));
    }
  });
});
