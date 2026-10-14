import { describe, expect, it } from "vitest";
import { vitestSkipLedger, vitestSkipProfile } from "../scripts/ci/vitestSkipLedger.ts";

describe("Vitest skip ledger", () => {
  it("allows alpha-to-coverage skips only on the software reference profile", () => {
    const ledger = vitestSkipLedger(
      [
        {
          moduleId: "/tmp/project/tests/browser/hair.test.ts",
          fullName:
            "hair cut-outs > smooths the edge with alpha-to-coverage on a multisampled target",
        },
      ],
      "software",
    );
    expect(ledger.byReason).toEqual({
      "the software reference WebGL context lacks alpha-to-coverage": 1,
    });
    expect(ledger.failures).toEqual([]);
  });

  it("fails alpha-to-coverage skips on the canonical hardware profile", () => {
    const ledger = vitestSkipLedger(
      [
        {
          moduleId: "/tmp/project/tests/browser/hair.test.ts",
          fullName:
            "hair cut-outs > smooths the edge with alpha-to-coverage on a multisampled target",
        },
      ],
      "canonical-hardware",
    );
    expect(ledger.failures).toEqual([
      'Vitest skip in /tmp/project/tests/browser/hair.test.ts: "hair cut-outs > smooths the edge with alpha-to-coverage on a multisampled target" is not allowed on the canonical-hardware profile (the software reference WebGL context lacks alpha-to-coverage)',
    ]);
  });

  it("classifies the admitted Metal lane separately from software and automatic runs", () => {
    expect(vitestSkipProfile("software")).toBe("software");
    expect(vitestSkipProfile("macos-hardware-metal")).toBe("canonical-hardware");
    expect(vitestSkipProfile("auto")).toBe("unclassified");
  });

  it("fails a skipped test that has no exact allowance", () => {
    const ledger = vitestSkipLedger(
      [
        {
          moduleId: "/tmp/project/tests/animation.test.ts",
          fullName: "the retarget > another test",
        },
      ],
      "software",
    );
    expect(ledger.failures).toEqual([
      'unaccounted Vitest skip in /tmp/project/tests/animation.test.ts: "the retarget > another test"',
    ]);
  });
});
