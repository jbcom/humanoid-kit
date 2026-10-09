import type { ChromiumGpuMode } from "game-harness/chromium";
import { definePlaywrightConfig } from "game-harness/playwright";

/**
 * The playground is the library's own demo. The suite drives its production
 * build (vite preview) in headed Chromium through game-harness: native GPU
 * locally (Metal on macOS), so what is tested is what people see.
 *
 * GitHub's hosted runners have no GPU, so CI declares SwiftShader explicitly
 * and runs under xvfb; a runner exposing /dev/dri can set
 * HK_GPU=linux-hardware-vulkan. HK_GPU overrides either way.
 */
const gpuMode = (process.env.HK_GPU ?? (process.env.CI ? "software" : "auto")) as ChromiumGpuMode;

export default definePlaywrightConfig({
  testDir: "./e2e",
  basePath: "/humanoid-kit/playground/",
  port: 4173,
  gpuMode,
  webServerCommand: (port) =>
    `pnpm build:playground && pnpm exec vite preview --config playground/vite.config.ts --base /humanoid-kit/playground/ --host 127.0.0.1 --port ${port} --strictPort`,
  overrides: {
    outputDir: "./test-results",
    fullyParallel: true,
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  },
});
