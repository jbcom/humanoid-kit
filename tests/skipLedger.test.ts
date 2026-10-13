/**
 * Every skipped end-to-end test is accounted for by a known reason, and a GPU-lane
 * skip never passes on a run that has a GPU lane.
 */
import { describe, expect, it } from "vitest";
import { GPU_LANE_SKIP } from "../e2e/lib/gpuLane.ts";
import { type PlaywrightReport, skipLedger } from "../scripts/ci/skipLedger.ts";

const spec = (title: string, status: string, description?: string) => ({
  title,
  file: "animation.spec.ts",
  tests: [
    {
      status,
      annotations: description === undefined ? [] : [{ type: "skip", description }],
    },
  ],
});

const report = (...specs: ReturnType<typeof spec>[]): PlaywrightReport => ({
  suites: [{ specs: [], suites: [{ specs }] }],
});

describe("e2e skip ledger", () => {
  it("counts GPU-lane skips by reason on a software lane and accepts them", () => {
    const ledger = skipLedger(
      report(
        spec("walks", "skipped", GPU_LANE_SKIP),
        spec("swims", "skipped", GPU_LANE_SKIP),
        spec("stands", "expected"),
      ),
      "software",
    );
    expect(ledger.byReason).toEqual({ [GPU_LANE_SKIP]: 2 });
    expect(ledger.skipped.map((s) => s.title)).toEqual(["walks", "swims"]);
    expect(ledger.failures).toEqual([]);
  });

  it("fails a GPU-lane skip on a run that has a GPU lane", () => {
    const ledger = skipLedger(report(spec("walks", "skipped", GPU_LANE_SKIP)), "gpu");
    expect(ledger.failures).toEqual([
      `animation.spec.ts: "walks" skipped on a run that has a GPU lane`,
    ]);
  });

  it("fails a skip with an unknown reason or none, on either lane", () => {
    for (const lane of ["software", "gpu"] as const) {
      const ledger = skipLedger(
        report(spec("a", "skipped", "flaky on Tuesdays"), spec("b", "skipped")),
        lane,
      );
      expect(ledger.failures).toEqual([
        'unaccounted skip in animation.spec.ts: "a" (flaky on Tuesdays)',
        'unaccounted skip in animation.spec.ts: "b" (skipped with no reason)',
      ]);
    }
  });

  it("finds skips in nested suites and ignores tests that ran", () => {
    const nested: PlaywrightReport = {
      suites: [{ suites: [{ suites: [{ specs: [spec("deep", "skipped", GPU_LANE_SKIP)] }] }] }],
    };
    expect(skipLedger(nested, "software").skipped).toHaveLength(1);
    expect(skipLedger(report(spec("ran", "expected")), "gpu").skipped).toEqual([]);
  });
});
