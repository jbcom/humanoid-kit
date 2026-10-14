import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestModule } from "vitest/node";
import { SkipGuardReporter } from "../vitest.config.ts";

const previousExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = previousExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function moduleWithSkippedTest(): TestModule {
  return {
    children: {
      allTests: () => [
        {
          options: { mode: "skip" },
          result: () => ({ state: "skipped" }),
          module: { moduleId: "/tests/unknown.test.ts" },
          fullName: "an unexpected skip",
        },
      ],
    },
  } as unknown as TestModule;
}

describe("required skip gate", () => {
  it("fails the process without throwing a swallowed reporter exception", () => {
    vi.stubEnv("CI", "true");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    expect(() => new SkipGuardReporter().onTestRunEnd([moduleWithSkippedTest()])).not.toThrow();
    expect(process.exitCode).toBe(1);
  });

  it("preserves an existing failure when every test executed", () => {
    vi.stubEnv("CI", "true");
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = 1;
    new SkipGuardReporter().onTestRunEnd([]);
    expect(process.exitCode).toBe(1);
  });
});
