import type { Reporter, TestCase, TestModule } from "vitest/node";
import { browserRun } from "../lib/browserRun.ts";
import { vitestSkipLedger, vitestSkipProfile } from "./vitestSkipLedger.ts";

const { gpuMode } = browserRun(process.env, process.platform);
const nameFiltered = process.argv.some(
  (arg) =>
    arg === "-t" ||
    arg === "--testNamePattern" ||
    arg.startsWith("--testNamePattern=") ||
    arg === "--test-name-pattern" ||
    arg.startsWith("--test-name-pattern="),
);

/** Fails CI for an unaccounted skip after each complete (including sharded) run. */
export default class VitestSkipReporter implements Reporter {
  private readonly skipped: Array<{ moduleId: string; fullName: string }> = [];
  private previousExitCode: typeof process.exitCode;
  private setExitCode = false;

  onTestRunStart() {
    this.skipped.length = 0;
    if (this.setExitCode && process.exitCode === 1) process.exitCode = this.previousExitCode;
    this.setExitCode = false;
  }

  onTestCaseResult(test: TestCase) {
    if (!nameFiltered && (test.options.mode === "skip" || test.result()?.state === "skipped"))
      this.skipped.push({ moduleId: test.module.moduleId, fullName: test.fullName });
  }

  onTestRunEnd(_testModules: ReadonlyArray<TestModule> = []) {
    if (nameFiltered) return;
    const ledger = vitestSkipLedger(this.skipped, vitestSkipProfile(gpuMode));
    const counts = Object.entries(ledger.byReason).map(([reason, count]) => `${count} x ${reason}`);
    console.log(
      `\nVitest skips (${ledger.profile}): ${counts.length ? counts.join("; ") : "none"}`,
    );
    if (ledger.failures.length) {
      console.error(ledger.failures.map((failure) => `::error::${failure}`).join("\n"));
      if (process.env.CI || process.env.HK_FAIL_ON_SKIP === "1") {
        this.previousExitCode = process.exitCode;
        process.exitCode = 1;
        this.setExitCode = true;
      }
    }
  }
}
