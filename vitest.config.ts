import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineBrowserTestConfig } from "game-harness/vitest";
import { defineConfig } from "vitest/config";
import type { Reporter, TestCase, TestModule } from "vitest/node";
import { vitestSkipLedger } from "./scripts/ci/vitestSkipLedger.ts";
import { browserRun } from "./scripts/lib/browserRun.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Headed native GPU locally; headless Metal on the render Macs; headless SwiftShader in
// other CI; the priority lane's own choice there (scripts/lib/browserRun.ts).
const { gpuMode, headless } = browserRun(process.env, process.platform);
const constrainedCi = Boolean(process.env.CI);
// A shard covers only a subset of test files. Coverage thresholds are meaningful
// only after the required CI merge job combines every labelled shard.
const partialCoverageShard = process.env.VITEST_COVERAGE_SHARD === "true";

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
export class SkipLedgerReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule> = []) {
    const skipped = [...testModules].flatMap((module) =>
      [...module.children.allTests()]
        .filter(
          (test: TestCase) => test.options.mode === "skip" || test.result()?.state === "skipped",
        )
        .map((test: TestCase) => ({ moduleId: test.module.moduleId, fullName: test.fullName })),
    );
    const ledger = vitestSkipLedger(skipped);
    const counts = Object.entries(ledger.byReason).map(([reason, count]) => `${count} x ${reason}`);
    console.log(`\nVitest skips: ${counts.length ? counts.join("; ") : "none"}`);
    if (ledger.failures.length) {
      console.error(ledger.failures.map((failure) => `::error::${failure}`).join("\n"));
      if (process.env.CI || process.env.HK_FAIL_ON_SKIP === "1") process.exitCode = 1;
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
    reporters: ["default", new SkipLedgerReporter()],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      ...(partialCoverageShard
        ? {}
        : {
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
          }),
    },
    projects: [
      {
        extends: true,
        // Vitest empties `mainFields` for its ssr environment so Node can run what it
        // externalizes, which resolves a package with no `exports` map (fiber, drei,
        // maath, troika, meshline, three-mesh-bvh) to its CommonJS `main`. Those
        // `require("three")`: three's deprecated CJS build loads beside the ESM one
        // the library imports, so every class exists twice. Asking for `module` first
        // resolves their ESM builds; Vitest inlines any that Node cannot import
        // natively. tests/threeSingleCopy.test.ts.
        environments: { ssr: { resolve: { mainFields: ["module", "main"] } } },
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/browser/**", "tests/bake/**"],
          environment: "node",
          // Building a model takes under a second alone, but coverage
          // instrumentation and the parallel suites stretch it several times;
          // 30 s still catches a hang.
          testTimeout: 30_000,
          // A full set of model fixtures is memory- and CPU-heavy.  Two workers
          // preserve independent-file coverage without oversubscribing a hosted
          // runner (which otherwise turns deterministic geometry assertions into
          // timeouts under concurrent pack loading).
          ...(constrainedCi && { maxWorkers: 2 }),
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
            headless,
          }),
          // Software rendering (CI) runs the shading measurements about seven
          // times slower than a GPU: the scatter-parity sweep takes 3 s on a
          // GPU and 20 s under SwiftShader.
          testTimeout: gpuMode === "software" ? 120_000 : 30_000,
          // A software renderer already spreads one WebGL context across the
          // host. Keep its browser files independent but sequential, matching
          // the Playwright suite's software-runner policy.
          ...(gpuMode === "software" && { fileParallelism: false }),
        },
      },
    ],
  },
});
