/**
 * Runs one production-bundle Lighthouse navigation with the installed
 * FullPageScreenshot gatherer instrumented at its capture/node boundaries.
 *
 * This isolated diagnostic preserves the normal settings, Chrome flags,
 * resize/network-idle/double-rAF lifecycle, artifact ID, and default protocol
 * timeout. It does not alter a product or required CI configuration.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import DiagnosticFullPageScreenshot, {
  fullPageScreenshotPrototypeReceipt,
  setFullPageScreenshotDiagnosticSink,
} from "./lighthouse-full-page-screenshot-diagnostic-gatherer.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const lighthouseRoot = path.join(root, ".lighthouse");
const output = path.join(lighthouseRoot, "capture-diagnostic.json");
const failedProductHead = "c57d29cbbf89160e627d258bf93af1a6904252f0";
const require = createRequire(import.meta.url);
const lhciRequire = createRequire(require.resolve("@lhci/cli/package.json"));
const lighthouseEntry = lhciRequire.resolve("lighthouse");
const { default: lighthouse, defaultConfig, desktopConfig } = await import(lighthouseEntry);
const { launch } = lhciRequire("chrome-launcher");
const FallbackServer = lhciRequire(
  path.join(
    path.dirname(lhciRequire.resolve("@lhci/cli/package.json")),
    "src",
    "collect",
    "fallback-server.js",
  ),
);

function shell(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function includesCommit(commit) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

function errorReceipt(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error",
  };
}

function startServer(staticDistDir) {
  const server = new FallbackServer(staticDistDir);
  return server.listen().then(() => server);
}

function entryScriptUrl(index) {
  const sources = [...index.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/g)].map(
    (match) => match[1],
  );
  if (!sources[0])
    throw new Error("production index did not contain an emitted JavaScript entry script");
  return sources[0];
}

async function preflight(url) {
  const indexResponse = await fetch(url);
  const index = await indexResponse.text();
  if (
    indexResponse.status !== 200 ||
    !indexResponse.headers.get("content-type")?.startsWith("text/html")
  )
    throw new Error(
      `index returned ${indexResponse.status} ${indexResponse.headers.get("content-type") ?? ""}`,
    );

  const assetUrl = new URL(entryScriptUrl(index), url);
  const assetResponse = await fetch(assetUrl);
  if (
    assetResponse.status !== 200 ||
    !assetResponse.headers.get("content-type")?.includes("javascript")
  )
    throw new Error(
      `entry asset returned ${assetResponse.status} ${assetResponse.headers.get("content-type") ?? ""}`,
    );

  return {
    asset: {
      contentType: assetResponse.headers.get("content-type"),
      status: assetResponse.status,
      url: assetUrl.href,
    },
    index: {
      contentType: indexResponse.headers.get("content-type"),
      status: indexResponse.status,
      url,
    },
  };
}

if (process.env.LH_FPS_TEST)
  throw new Error("diagnostic requires production WebP quality 30; unset LH_FPS_TEST");
if (!includesCommit(failedProductHead))
  throw new Error(`diagnostic must include failed product head ${failedProductHead}`);

shell("pnpm", ["build:playground"]);
shell("node", ["scripts/lighthouserc.mjs"]);
const config = JSON.parse(fs.readFileSync(path.join(lighthouseRoot, "lighthouserc.json"), "utf8"));
const collect = config.ci.collect;
const settings = collect.settings;
if (settings.disableFullPageScreenshot === true)
  throw new Error("diagnostic requires the real FullPageScreenshot artifact to remain enabled");
if (!Array.isArray(collect.url) || collect.url.length !== 1)
  throw new Error("diagnostic requires exactly one generated Lighthouse URL");

const result = {
  artifact: "FullPageScreenshot",
  chromeFlags: settings.chromeFlags,
  generatedAt: new Date().toISOString(),
  gathererPrototype: fullPageScreenshotPrototypeReceipt(),
  lighthouse: {
    entry: path.relative(root, lighthouseEntry),
    version: JSON.parse(
      fs.readFileSync(path.join(path.dirname(lighthouseEntry), "..", "package.json"), "utf8"),
    ).version,
  },
  lifecycle: { status: "new" },
  preflight: { status: "pending" },
  settings,
  stages: [],
  staticDistDir: collect.staticDistDir,
  status: "in-progress",
  sourceHead: shell("git", ["rev-parse", "HEAD"]),
  sourceProductHead: failedProductHead,
  url: collect.url[0],
};
const persist = () => fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
setFullPageScreenshotDiagnosticSink((stage) => {
  result.stages.push(stage);
  persist();
});
persist();

// Config extension merges cannot replace Lighthouse's string shorthand with a
// live gatherer class. Copy the installed desktop preset's default config and
// replace only this artifact, leaving every other artifact and audit identical.
const diagnosticConfig = {
  ...defaultConfig,
  settings: { ...defaultConfig.settings, ...desktopConfig.settings },
  artifacts: defaultConfig.artifacts.map((artifact) =>
    artifact.id === "FullPageScreenshot"
      ? { ...artifact, gatherer: { implementation: DiagnosticFullPageScreenshot } }
      : artifact,
  ),
};

let server;
let chrome;
try {
  server = await startServer(path.resolve(root, collect.staticDistDir));
  const address = server.port;
  const url = new URL(collect.url[0]);
  url.hostname = "localhost";
  url.port = String(address);
  result.url = url.href;
  result.preflight = { ...(await preflight(url.href)), status: "ok" };
  persist();

  // LHCI adds this when it invokes the installed CLI in headless collection mode.
  const chromeFlags = [...settings.chromeFlags.split(" ").filter(Boolean), "--headless=new"];
  chrome = await launch({ chromeFlags, handleSIGINT: false });
  result.chrome = { flags: chromeFlags, port: chrome.port };
  result.lifecycle.status = "running";
  persist();

  const run = await lighthouse(url.href, { ...settings, port: chrome.port }, diagnosticConfig);
  const screenshot = run?.artifacts.FullPageScreenshot?.screenshot;
  if (screenshot) {
    const [, encoded] = screenshot.data.split(",", 2);
    if (!encoded) throw new Error("Lighthouse returned a FullPageScreenshot without image data");
    const image = path.join(lighthouseRoot, "capture-full-page.webp");
    const bytes = Buffer.from(encoded, "base64");
    fs.writeFileSync(image, bytes);
    result.capture = {
      artifact: path.basename(image),
      bytes: bytes.length,
      height: screenshot.height,
      width: screenshot.width,
    };
  }
  result.lifecycle.status = "completed";
  result.status = run?.lhr.runtimeError ? "runtime-error" : "ok";
  result.runtimeError = run?.lhr.runtimeError ?? null;
} catch (error) {
  result.error = errorReceipt(error);
  result.lifecycle.status = "failed";
  result.status = "failed";
} finally {
  if (chrome) await chrome.kill();
  if (server) await server.close();
  persist();
}

if (result.status !== "ok") process.exitCode = 1;
