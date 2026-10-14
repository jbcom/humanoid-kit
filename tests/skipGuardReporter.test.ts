import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestCase } from "vitest/node";
import VitestSkipReporter from "../scripts/ci/vitestSkipReporter.ts";

const previousExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = previousExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function skippedTest(): TestCase {
  return {
    options: { mode: "skip" },
    result: () => ({ state: "skipped" }),
    module: { moduleId: "/tests/unknown.test.ts" },
    fullName: "an unexpected skip",
  } as unknown as TestCase;
}

describe("required skip gate", () => {
  it("fails the process without throwing a swallowed reporter exception", () => {
    vi.stubEnv("CI", "true");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    const reporter = new VitestSkipReporter();
    reporter.onTestRunStart();
    reporter.onTestCaseResult(skippedTest());
    expect(() => reporter.onTestRunEnd()).not.toThrow();
    expect(process.exitCode).toBe(1);
  });

  it("preserves an existing failure when every test executed", () => {
    vi.stubEnv("CI", "true");
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = 1;
    new VitestSkipReporter().onTestRunEnd();
    expect(process.exitCode).toBe(1);
  });
});
