import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { foundationSmokeOutput } from "../scripts/lib/foundationSmokeOutput.ts";
import {
  APPROVED_SMOKE_POSE_FAMILIES,
  smokeReport,
  smokeSummary,
} from "../src/foundation/smokeReport.ts";
import type { SuiteRow } from "../src/foundation/suite.ts";

const recorded: SuiteRow[] = JSON.parse(
  fs.readFileSync(new URL("../docs/evidence/foundation-smoke.json", import.meta.url), "utf8"),
);
const clean = recorded.find((row) => row.pose === "rest") as SuiteRow;
const defect = (pose: string): SuiteRow => ({
  ...clean,
  pose,
  measure: { ...clean.measure, inverted: 1 },
});

describe("foundation smoke reporting policy (no geometry evaluation)", () => {
  it("hard-gates only the explicitly reviewed REST family", () => {
    expect(APPROVED_SMOKE_POSE_FAMILIES).toEqual(["rest"]);
    expect(Object.isFrozen(APPROVED_SMOKE_POSE_FAMILIES)).toBe(true);
    expect(smokeReport([defect("rest")]).hardGateFailKeys).toEqual([
      `${clean.body}/rest/${clean.anatomy}`,
    ]);
  });

  it("reports a planted POSED failure even with no hard-gated failure", () => {
    const rows = [clean, defect("seated")];
    expect(smokeReport(rows)).toMatchObject({
      restFailCount: 0,
      posedFailCount: 1,
      posedFailKeys: [`${clean.body}/seated/${clean.anatomy}`],
      hardGateFailKeys: [],
    });
    expect(smokeSummary(rows)).toContain("POSED FAIL: 1/1");
    expect(smokeSummary(rows)).toContain(`${clean.body}/seated/${clean.anatomy}`);
  });

  it("reports the recorded snapshot's failures without calling it current acceptance", () => {
    expect(smokeReport(recorded)).toMatchObject({
      restRows: 6,
      restFailCount: 0,
      posedRows: 18,
      posedFailCount: 16,
      hardGateFailKeys: [],
    });
    expect(smokeReport(recorded).posedFailKeys).toHaveLength(16);
  });

  it("leaves measurement output separate unless a baseline update is explicit", () => {
    expect(foundationSmokeOutput([]).updateBaseline).toBe(false);
    expect(foundationSmokeOutput(["--output-dir", "candidate"])).toMatchObject({
      updateBaseline: false,
      outputDir: "candidate",
    });
    expect(() => foundationSmokeOutput(["--update-reviewed-baseline"])).toThrow();
    expect(() => foundationSmokeOutput(["--review-reference", "review"])).toThrow();
    expect(() => foundationSmokeOutput(["--output-dir"])).toThrow();
    expect(() => foundationSmokeOutput(["--unknown"])).toThrow();
    expect(() =>
      foundationSmokeOutput([
        "--update-reviewed-baseline",
        "--review-reference",
        "review",
        "--output-dir",
        "candidate",
      ]),
    ).toThrow();
    expect(
      foundationSmokeOutput(["--update-reviewed-baseline", "--review-reference", "review"]),
    ).toMatchObject({
      updateBaseline: true,
      reviewReference: "review",
    });
  });
});
