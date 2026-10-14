/** REST acceptance and a separate numeric POSED regression budget.
 * Known posed invariant failures are reported even when the budget passes.
 * Baseline changes require explicit review; measurements do not promote families.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SMOKE_STRIDE, smokeModelOptions } from "../src/foundation/smoke.ts";
import { smokeReport, smokeRowKey, smokeSummary } from "../src/foundation/smokeReport.ts";
import { runFoundation, type SuiteRow } from "../src/foundation/suite.ts";
import { HumanoidModel } from "../src/model/humanoidModel.ts";
import { adultManifest, loadFixtureAssets } from "./fixtures.ts";

const recorded: SuiteRow[] = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, "../docs/evidence/foundation-smoke.json"),
    "utf8",
  ),
);
const key = smokeRowKey;

describe("foundation smoke: REST acceptance and POSED regression budget", {
  timeout: 300_000,
}, () => {
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

  const report = smokeReport(rows);
  console.log(smokeSummary(rows));

  it("passes every invariant in the explicitly approved pose families (REST only)", () => {
    expect(report.hardGateFailKeys).toEqual([]);
  });

  it("stays within the recorded numeric regression budget; POSED FAIL is not acceptance", () => {
    const before = new Map(recorded.map((r) => [key(r), r.measure]));
    for (const r of rows) {
      const was = before.get(key(r));
      expect(was, `${key(r)} is not in the reviewed baseline`).toBeDefined();
      if (!was) continue;
      const m = r.measure;
      const label = `${key(r)} (reviewed baseline budget)`;
      // Penetration and collapse to a sliver are judged by the skin they
      // cover (cm²); their counts are information, a finer surface having more
      // vertices and triangles over the same skin. The slack is rounding.
      // Report every regressed row in one expensive geometry pass. Soft
      // assertions still fail the test; the worklist and tolerances stay fixed.
      expect.soft(m.penetratingArea, label).toBeLessThanOrEqual(was.penetratingArea + 1e-3);
      expect.soft(m.inverted, label).toBeLessThanOrEqual(was.inverted);
      expect.soft(m.squashedArea, label).toBeLessThanOrEqual(was.squashedArea + 1e-3);
      expect.soft(m.folds, label).toBeLessThanOrEqual(was.folds);
      expect.soft(m.volumeOut.length, label).toBeLessThanOrEqual(was.volumeOut.length);
      expect.soft(m.seamGap, label).toBeLessThanOrEqual(Math.max(was.seamGap, 1e-6));
    }
  });
});
