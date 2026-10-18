import { describe, expect, it } from "vitest";
import {
  NO_ADULT_SCULPTS_REASON,
  vitestSkipLedger,
  vitestSkipProfile,
} from "../scripts/ci/vitestSkipLedger.ts";

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

  it("counts the skips of the tests that need the uncommitted adult sculpts, on every profile", () => {
    const skipped = ["phallus", "scrotum", "arousal", "adultReservoirs"].map((name) => ({
      moduleId: `/tmp/project/tests/${name}.test.ts`,
      fullName: "x > needs them",
    }));
    for (const profile of ["software", "canonical-hardware", "unclassified"] as const) {
      const ledger = vitestSkipLedger(skipped, profile);
      expect(ledger.failures).toEqual([]);
      expect(ledger.byReason).toEqual({ [NO_ADULT_SCULPTS_REASON]: 4 });
    }
  });

  it("does not let another test file skip under the adult-sculpts reason", () => {
    const ledger = vitestSkipLedger(
      [{ moduleId: "/tmp/project/tests/vulva.test.ts", fullName: "the vulva > x" }],
      "software",
    );
    expect(ledger.failures).toEqual([
      'unaccounted Vitest skip in /tmp/project/tests/vulva.test.ts: "the vulva > x"',
    ]);
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
