import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineBrowserTestConfig } from "game-harness/vitest";
import { defineConfig } from "vitest/config";
import VitestSkipReporter from "./scripts/ci/vitestSkipReporter.ts";
import { browserRun } from "./scripts/lib/browserRun.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Headed native GPU locally; headless Metal on the render Macs; headless SwiftShader in
// other CI; the priority lane's own choice there (scripts/lib/browserRun.ts).
const { gpuMode, headless } = browserRun(process.env, process.platform);
const constrainedCi = Boolean(process.env.CI);
// A shard covers only a subset of test files. Coverage thresholds are meaningful
// only after the required CI merge job combines every labelled shard.
const partialCoverageShard = process.env.VITEST_COVERAGE_SHARD === "true";
// V8 coverage multiplies a CPU-bound test's run time. Measured on one file at a
// time on .201 (no contention), against the same tests uninstrumented on a
// hosted runner:
// - hipFold's two-millimetre crease case took 36.1 s against 14.4 s;
// - fluidPosedSurfaceFrame's mass transfer took 32.6 s against 14.9 s;
// - boxBraids' fixture hook ran past 10 s, where the whole uninstrumented file
//   takes 2.3 s.
// An instrumented run keeps the same hang detection at three times the
// uninstrumented budgets. The uninstrumented jobs keep the budgets themselves.
const instrumented = partialCoverageShard || process.argv.includes("--coverage");
const INSTRUMENTED_SLOWDOWN = 3;
const budget = (ms: number): number => (instrumented ? ms * INSTRUMENTED_SLOWDOWN : ms);
// A name filter marks every non-selected test as skipped. Shards select files,
// so their selected files still report real environmental skips to the ledger.
const skipLedgerEnabled = !process.argv.some(
  (arg) =>
    arg === "-t" ||
    arg === "--testNamePattern" ||
    arg.startsWith("--testNamePattern=") ||
    arg === "--test-name-pattern" ||
    arg.startsWith("--test-name-pattern="),
);

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
    reporters: ["default", ...(skipLedgerEnabled ? [new VitestSkipReporter()] : [])],
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
              "src/{build,format,makehuman,mhclo,model,morph,presence,recipe,rig,subdiv,surface}/**/*.ts":
                {
                  statements: 90,
                  branches: 85,
                  functions: 90,
                  lines: 90,
                },
              "src/{bake,build,format,makehuman,mhclo,morph,presence,recipe,subdiv,surface}/**": {
                statements: 90,
                branches: 85,
                functions: 90,
                lines: 90,
              },
              "src/editor/*.ts": {
                statements: 90,
                branches: 85,
                functions: 90,
                lines: 90,
              },
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
          // Building a model takes under a second alone, and the parallel suites
          // stretch it several times; 30 s still catches a hang. Instrumented
          // runs scale both budgets (`budget`, above).
          testTimeout: budget(30_000),
          hookTimeout: budget(10_000),
          // A test that sets its own budget scales it the same way (`inject("budgetScale")`).
          provide: { budgetScale: instrumented ? INSTRUMENTED_SLOWDOWN : 1 },
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
          provide: { browserGpuMode: gpuMode },
          // Software rendering (CI) runs the shading measurements about seven
          // times slower than a GPU: the scatter-parity sweep takes 3 s on a
          // GPU and 20 s under SwiftShader.
          testTimeout: budget(gpuMode === "software" ? 120_000 : 30_000),
          hookTimeout: budget(10_000),
          // A software renderer already spreads one WebGL context across the
          // host. Keep its browser files independent but sequential, matching
          // the Playwright suite's software-runner policy.
          ...(gpuMode === "software" && { fileParallelism: false }),
        },
      },
    ],
  },
});
