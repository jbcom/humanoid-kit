import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

// The review fixture enables its explicit gate in this config so the browser
// receives it without relying on shell environment propagation.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      env: { HK_FACIAL_HAIR_LENGTH_INSPECTION: "1" },
      browser: { viewport: { width: 768, height: 896 } },
    },
  }),
);
