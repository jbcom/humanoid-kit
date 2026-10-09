/**
 * Prepares a Lighthouse CI run of the playground, the library's public demo:
 *
 *   node scripts/lighthouserc.mjs   (after `pnpm build:playground`)
 *
 * It lays the production build out under the path Pages serves it from, so
 * its absolute asset URLs resolve, and writes `.lighthouse/lighthouserc.json`
 * from game-harness's preset (scores warn, never block: Lighthouse varies run
 * to run). lhci reads only JSON, YAML or CommonJS configs, so the config is
 * generated rather than kept as a module. Reports stay on the machine (CI
 * uploads them as an artifact) rather than going to Lighthouse's public
 * temporary storage.
 */
import fs from "node:fs";
import { lighthouseAssertions } from "game-harness/lighthouse";

const root = ".lighthouse";
fs.rmSync(`${root}/site`, { recursive: true, force: true });
fs.cpSync("dist-playground", `${root}/site/humanoid-kit/playground`, { recursive: true });

const { ci } = lighthouseAssertions("game-default", {
  staticDistDir: `./${root}/site`,
  url: ["http://localhost/humanoid-kit/playground/index.html?muted"],
  // The base preset (lighthouse:no-pwa) errors on audits this demo fails by
  // design or upstream; they stay visible as warnings.
  assertions: {
    // The packs stream every age's targets after the first figure (6.7 MB).
    "total-byte-weight": "warn",
    "network-dependency-tree-insight": "warn",
    // three and R3F ship code a single page does not run, and R3F's own
    // canvas listeners are not passive.
    "unused-javascript": "warn",
    "uses-passive-event-listeners": "warn",
    // The demo ships without source maps.
    "valid-source-maps": "warn",
  },
});
// The preset's --disable-gpu leaves a WebGL page without a context, so
// Lighthouse would measure an empty canvas; render through SwiftShader
// instead, as the e2e suite does on CI.
const chromeFlags = [
  ...ci.collect.settings.chromeFlags.split(" ").filter((f) => f !== "--disable-gpu"),
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--mute-audio",
].join(" ");
const config = {
  ci: {
    ...ci,
    collect: { ...ci.collect, settings: { ...ci.collect.settings, chromeFlags } },
    upload: { target: "filesystem", outputDir: `./${root}/reports` },
  },
};
fs.writeFileSync(`${root}/lighthouserc.json`, `${JSON.stringify(config, null, 2)}\n`);
console.log(`lighthouserc: ${root}/lighthouserc.json`);
