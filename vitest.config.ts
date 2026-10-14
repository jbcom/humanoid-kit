import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { ChromiumGpuMode } from "game-harness/chromium";
import { defineBrowserTestConfig } from "game-harness/vitest";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const gpuMode = (process.env.HK_GPU ?? (process.env.CI ? "software" : "auto")) as ChromiumGpuMode;

// Three projects:
// - unit: the pure core in Node (tests/**/*.test.ts, outside tests/browser
//   and tests/bake).
// - browser: real Chromium (tests/browser/): the creator's React components,
//   driven by the real pack taxonomy and the real control logic, and the
//   materials' shading measured against their models on an analytic sphere.
//   The whole figure (the worker, the stage) is proven by the Playwright suite
//   in e2e/ against the playground.
// - bake: full ray-cast bakes of the figure checked against the shipped pack
//   (tests/bake/). Coverage instrumentation slows their ray loops about tenfold
//   and the unit tests already cover that code, so `pnpm coverage` runs them
//   separately, uninstrumented.
import type { Reporter, TestCase, TestModule } from "vitest/node";

export class SkipGuardReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule> = []) {
    let skipCount = 0;
    const skippedTests: string[] = [];

    const checkTest = (test: TestCase) => {
      const res = test.result();
      if (test.options.mode === "skip" || res?.state === "skipped") {
        skipCount++;
        skippedTests.push(`${test.module.moduleId}: ${test.fullName}`);
      }
    };

    for (const mod of testModules) {
      for (const test of mod.children.allTests()) {
        checkTest(test);
      }
    }

    console.log(`\n[SkipGuard] Total skipped tests recorded: ${skipCount}`);
    if (skipCount > 0) {
      console.log("[SkipGuard] Skipped test details:");
      for (const name of skippedTests) {
        console.log(`  - ${name}`);
      }
      if (process.env.CI || process.env.HK_FAIL_ON_SKIP) {
        throw new Error(
          `[SkipGuard] CI failure: ${skipCount} test(s) skipped where they should run.`,
        );
      }
    }
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^humanoid-kit\/react$/, replacement: here("src/react/index.ts") },
      { find: /^humanoid-kit\/editor$/, replacement: here("src/editor/ui/index.ts") },
      { find: /^humanoid-kit$/, replacement: here("src/index.ts") },
    ],
  },
  test: {
    reporters: ["default", new SkipGuardReporter()],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        statements: 92,
        branches: 82,
        functions: 89,
        lines: 93,
        "src/rig/**": {
          statements: 97,
          branches: 84,
          functions: 100,
          lines: 99,
        },
        "src/model/**": {
          statements: 88,
          branches: 76,
          functions: 92,
          lines: 88,
        },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/browser/**", "tests/bake/**"],
          environment: "node",
          // Building a model takes under a second alone, but coverage
          // instrumentation and the parallel suites stretch it several times;
          // 30 s still catches a hang.
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "bake",
          include: ["tests/bake/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        // game-harness: headed real Chromium, silent, fixed viewport at device scale 1.
        test: {
          ...defineBrowserTestConfig({
            name: "browser",
            include: ["tests/browser/**/*.test.{ts,tsx}"],
            gpuMode,
          }),
          // Software rendering (CI) runs the shading measurements about seven
          // times slower than a GPU: the scatter-parity sweep takes 3 s on a
          // GPU and 20 s under SwiftShader.
          testTimeout: gpuMode === "software" ? 120_000 : 30_000,
        },
      },
    ],
  },
});
