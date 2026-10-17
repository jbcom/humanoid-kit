import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

// This explicit config carries the diagnostic gate into the browser project
// without relying on an arbitrary local shell variable being propagated.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      env: { HK_INJURY_INSPECTION: "1" },
      browser: {
        // The browser project's normal phone viewport is 414px wide. This
        // diagnostic deliberately shows a 720px canvas and its route table.
        viewport: { width: 768, height: 896 },
      },
    },
  }),
);
