import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

// `heavy-slot` forwards documented browser state only, so the review fixture
// enables its explicit gate here instead of relying on a local shell variable.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      env: { HK_FACIAL_HAIR_LENGTH_INSPECTION: "1" },
      browser: { viewport: { width: 768, height: 896 } },
    },
  }),
);
