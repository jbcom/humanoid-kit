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
 */
const gpuMode = (process.env.HK_GPU ?? (process.env.CI ? "software" : "auto")) as ChromiumGpuMode;
const headless = Boolean(process.env.CI) && !process.env.HK_HEADED;

export default definePlaywrightConfig({
  testDir: "./e2e",
  basePath: "/humanoid-kit/playground/",
  // A second checkout (a worktree, another agent) runs its own server beside this one.
  port: Number(process.env.HK_E2E_PORT ?? 4173),
  gpuMode,
  headless,
  webServerCommand: (port) =>
    `pnpm build:playground && pnpm exec vite preview --config playground/vite.config.ts --base /humanoid-kit/playground/ --host 127.0.0.1 --port ${port} --strictPort`,
  overrides: {
    outputDir: "./test-results",
    fullyParallel: true,
    // SwiftShader already spreads one page's rendering over every core (a lone
    // creator test uses ~8 locally); parallel workers only starve each other.
    ...(gpuMode === "software" && { workers: 1 }),
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  },
});
