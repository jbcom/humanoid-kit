/**
 * Accounts for every skipped Playwright test in a JSON report.
 *
 * A skip is allowed for exactly the reasons in `KNOWN_SKIP_REASONS`; each is counted
 * by reason and written to a ledger file the coverage gate can read. A skip with any
 * other reason is unaccounted for and fails the run, and so does any
 * GPU-lane skip on a run that has a GPU lane: the lane is where those tests must run.
 *
 *   node scripts/ci/skipLedger.ts <report.json> <ledger.json> --lane software|gpu
 */
import { readFileSync, writeFileSync } from "node:fs";
import { FRAME_PACING_SKIP, GPU_LANE_SKIP } from "../../e2e/lib/gpuLane.ts";

export const KNOWN_SKIP_REASONS: readonly string[] = [GPU_LANE_SKIP, FRAME_PACING_SKIP];

interface ReportTest {
  status?: string;
  annotations?: { type: string; description?: string }[];
}
interface ReportSpec {
  title: string;
  file?: string;
  tests?: ReportTest[];
}
interface ReportSuite {
  suites?: ReportSuite[];
  specs?: ReportSpec[];
}
export interface PlaywrightReport {
  suites?: ReportSuite[];
}

export interface SkippedTest {
  file: string;
  title: string;
  reason: string;
}

export interface Ledger {
  lane: "software" | "gpu";
  /** Skipped tests, counted by their reason. */
  byReason: Record<string, number>;
  skipped: SkippedTest[];
  /** Why this run's skips are not acceptable; empty when they are. */
  failures: string[];
}

function* specs(suites: readonly ReportSuite[] | undefined): Generator<ReportSpec> {
  for (const suite of suites ?? []) {
    yield* suite.specs ?? [];
    yield* specs(suite.suites);
  }
}

export function skipLedger(report: PlaywrightReport, lane: "software" | "gpu"): Ledger {
  const skipped: SkippedTest[] = [];
  for (const spec of specs(report.suites))
    for (const test of spec.tests ?? []) {
      if (test.status !== "skipped") continue;
      const reason =
        test.annotations?.find((annotation) => annotation.type === "skip")?.description ??
        "skipped with no reason";
      skipped.push({ file: spec.file ?? "", title: spec.title, reason });
    }
  const byReason: Record<string, number> = {};
  for (const test of skipped) byReason[test.reason] = (byReason[test.reason] ?? 0) + 1;
  const failures: string[] = [];
  for (const test of skipped) {
    if (!KNOWN_SKIP_REASONS.includes(test.reason))
      failures.push(`unaccounted skip in ${test.file}: "${test.title}" (${test.reason})`);
    else if (test.reason === GPU_LANE_SKIP && lane === "gpu")
      failures.push(`${test.file}: "${test.title}" skipped on a run that has a GPU lane`);
  }
  return { lane, byReason, skipped, failures };
}

if (import.meta.main) {
  const [reportPath, ledgerPath, flag, lane] = process.argv.slice(2);
  if (!reportPath || !ledgerPath || flag !== "--lane" || (lane !== "software" && lane !== "gpu"))
    throw new Error("usage: skipLedger.ts <report.json> <ledger.json> --lane software|gpu");
  const ledger = skipLedger(JSON.parse(readFileSync(reportPath, "utf8")) as PlaywrightReport, lane);
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  const counts = Object.entries(ledger.byReason).map(([reason, n]) => `${n} x ${reason}`);
  console.log(`skips on the ${lane} lane: ${counts.length ? counts.join("; ") : "none"}`);
  if (ledger.failures.length) {
    console.error(ledger.failures.map((failure) => `::error::${failure}`).join("\n"));
    process.exit(1);
  }
}
