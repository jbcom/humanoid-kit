import { defineConfig } from "vitest/config";

// Coverage is scoped to the pure core folders. src/react, src/editor and
// src/worker need a real browser and WebGL context; the Playwright suite in
// e2e/ proves them against the playground.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: [
        "src/format/**/*.ts",
        "src/morph/**/*.ts",
        "src/subdiv/**/*.ts",
        "src/recipe/**/*.ts",
        "src/rig/**/*.ts",
      ],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
});
