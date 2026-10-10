import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The playground is the library's own demo, not a consumer: it imports the
// package entry points straight from ../src through aliases, so every edit to
// the library is live without a build step. Longer subpaths come first so
// `humanoid-kit/react` never matches the bare `humanoid-kit` alias.
export default defineConfig({
  root: here("."),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^humanoid-kit\/react$/, replacement: here("../src/react/index.ts") },
      { find: /^humanoid-kit\/editor$/, replacement: here("../src/editor/ui/index.ts") },
      { find: /^humanoid-kit\/worker$/, replacement: here("../src/worker/index.ts") },
      { find: /^humanoid-kit$/, replacement: here("../src/index.ts") },
    ],
  },
  optimizeDeps: {
    exclude: ["humanoid-kit"],
    // The scan at startup follows the playground's own imports, not the library's
    // behind the aliases: a cold server found three-mesh-bvh and RoomEnvironment
    // only when the first page asked for them, re-bundled, and failed that page's
    // modules with 504 (Outdated Optimize Dep). Scanning the library's sources too
    // bundles every dependency before the first page.
    entries: ["index.html", "../src/**/*.{ts,tsx}"],
  },
  server: {
    fs: { allow: [here("..")] },
  },
  build: {
    outDir: here("../dist-playground"),
    emptyOutDir: true,
    // The largest chunk is three.js itself (~740 kB minified), a single upstream
    // library with no split point; every other chunk stays under 500 kB.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Vendors change far less often than the demo, so they cache separately.
        codeSplitting: {
          groups: [
            { name: "three", test: /node_modules[\\/]three[\\/]/ },
            {
              name: "r3f",
              test: /node_modules[\\/](@react-three|three-stdlib|postprocessing)[\\/]/,
            },
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
});
