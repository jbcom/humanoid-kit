import { describe, expect, it } from "vitest";
import { vitestSkipLedger } from "../scripts/ci/vitestSkipLedger.ts";

describe("Vitest skip ledger", () => {
  it("records each declared environment-dependent skip by its reason", () => {
    const ledger = vitestSkipLedger([
      {
        moduleId: "/tmp/project/tests/animation.test.ts",
        fullName: "the retarget > takes a source in its T-pose to the target in its own",
      },
      {
        moduleId: "/tmp/project/tests/browser/hair.test.ts",
        fullName:
          "hair cut-outs > smooths the edge with alpha-to-coverage on a multisampled target",
      },
    ]);
    expect(ledger.byReason).toEqual({
      "the optional Quaternius fixture is absent": 1,
      "the WebGL context lacks alpha-to-coverage": 1,
    });
    expect(ledger.failures).toEqual([]);
  });

  it("fails a skipped test that has no exact allowance", () => {
    const ledger = vitestSkipLedger([
      { moduleId: "/tmp/project/tests/animation.test.ts", fullName: "the retarget > another test" },
    ]);
    expect(ledger.failures).toEqual([
      'unaccounted Vitest skip in /tmp/project/tests/animation.test.ts: "the retarget > another test"',
    ]);
  });
});
