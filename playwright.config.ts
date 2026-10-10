import type { ChromiumGpuMode } from "game-harness/chromium";
import { definePlaywrightConfig } from "game-harness/playwright";

/**
 * The playground is the library's own demo. The suite drives its production
 * build (vite preview) in headed Chromium through game-harness: native GPU
 * locally (Metal on macOS), so what is tested is what people see.
 *
 * Unattended runs (CI, the dedicated render Mac's service account) have no GPU
 * worth trusting and no window session, so CI declares SwiftShader and runs
 * headless; a runner exposing /dev/dri can set HK_GPU=linux-hardware-vulkan.
 * HK_GPU and HK_HEADED=1 override.
 *
 * `--project sheets` instead renders review contact sheets (e2e/sheets/, the
 * job in `.sheets/job.json`): against the playground's dev server, the only one
 * that can load the adult pack (`?adult`), and never as part of the suite. The
 * project and its server exist only when the command line names it: Playwright
 * runs every project it is given and has one server per config, and the render
 * pool forwards a command's arguments but not its environment.
 */
const gpuMode = (process.env.HK_GPU ?? (process.env.CI ? "software" : "auto")) as ChromiumGpuMode;
const headless = Boolean(process.env.CI) && !process.env.HK_HEADED;

/** Whether this run's command line selects the `sheets` project (`--project sheets` or `--project=sheets`). */
export const selectsSheets = (argv: readonly string[]): boolean =>
  argv.some(
    (arg, i) => arg === "--project=sheets" || (arg === "--project" && argv[i + 1] === "sheets"),
  );
const sheets = selectsSheets(process.argv);

export default definePlaywrightConfig({
  testDir: "./e2e",
  basePath: sheets ? "/" : "/humanoid-kit/playground/",
  // A second checkout (a worktree, another agent) runs its own server beside this one.
  port: Number(process.env.HK_E2E_PORT ?? 4173),
  gpuMode,
  headless,
  webServerCommand: (port) =>
    sheets
      ? `pnpm exec vite --config playground/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`
      : `pnpm build:playground && pnpm exec vite preview --config playground/vite.config.ts --base /humanoid-kit/playground/ --host 127.0.0.1 --port ${port} --strictPort`,
  extraProjects: sheets
    ? [
        {
          name: "sheets",
          // A sheet is a review render, not a test: it never matches the suite's `*.spec.ts`.
          testMatch: /sheets\/.*\.sheet\.ts$/,
          // A sheet of many figures waits on each one's evaluation in turn.
          timeout: 30 * 60_000,
        },
      ]
    : [],
  overrides: {
    outputDir: "./test-results",
    fullyParallel: true,
    // SwiftShader already spreads one page's rendering over every core (a lone
    // creator test uses ~8 locally); parallel workers only starve each other.
    ...(gpuMode === "software" && { workers: 1 }),
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  },
});
