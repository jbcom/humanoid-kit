import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "neutral-garment-fixture.capture.spec.ts",
  timeout: 120000,
  workers: 1,
  outputDir: "../.agent-state/neutral-garment-capture-results",
  use: {
    headless: true,
    launchOptions: { args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--mute-audio"] },
  },
});
