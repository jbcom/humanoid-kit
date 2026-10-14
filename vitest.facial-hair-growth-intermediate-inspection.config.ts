import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      env: { HK_FACIAL_HAIR_GROWTH_INSPECTION: "intermediate" },
      retry: 0,
      browser: { viewport: { width: 1024, height: 760 } },
    },
  }),
);
