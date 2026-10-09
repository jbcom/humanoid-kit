import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { ChromiumGpuMode } from "game-harness/chromium";
import { defineBrowserTestConfig } from "game-harness/vitest";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Two projects:
// - unit: the pure core in Node (tests/**/*.test.ts).
// - browser: the creator's React components in real Chromium
//   (tests/browser/**/*.test.tsx), driven by the real pack taxonomy and the real
//   control logic. Rendering itself (WebGL, the worker) is proven by the
//   Playwright suite in e2e/ against the playground.
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
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      // The framework-free core. src/react, src/render, src/editor/ui and
      // src/worker are proven in the browser project and the Playwright suite.
      include: [
        "src/build/**/*.ts",
        "src/editor/*.ts",
        "src/format/**/*.ts",
        "src/makehuman/**/*.ts",
        "src/mhclo/**/*.ts",
        "src/model/**/*.ts",
        "src/morph/**/*.ts",
        "src/recipe/**/*.ts",
        "src/subdiv/**/*.ts",
        "src/surface/**/*.ts",
      ],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        // game-harness: headed real Chromium, silent, fixed viewport at device scale 1.
        test: defineBrowserTestConfig({
          name: "browser",
          include: ["tests/browser/**/*.test.tsx"],
          gpuMode: (process.env.HK_GPU ??
            (process.env.CI ? "software" : "auto")) as ChromiumGpuMode,
        }),
      },
    ],
  },
});
