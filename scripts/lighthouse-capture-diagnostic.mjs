/**
 * Isolates a Linux CI failure in Lighthouse's FullPageScreenshot gatherer.
 *
 * This is intentionally not a gate and must be run only from the isolated
 * diagnostic workflow. It uses the production playground bundle, generated
 * Lighthouse Chrome flags, and the resize/WebP CDP commands Lighthouse 12.6.1
 * uses. It deliberately follows the gatherer's five-second post-resize branch;
 * it is a protocol probe, not a substitute for lhci.
 *
 * Each case launches a fresh browser. There are no retries. Every awaited
 * browser operation is bounded and each receipt is persisted before the next
 * await, so a blocked page/Chrome operation cannot discard earlier evidence.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const lighthouseRoot = path.join(root, ".lighthouse");
const site = path.join(lighthouseRoot, "site");
const basePath = "/humanoid-kit/playground/";
const servedRoot = path.join(site, "humanoid-kit", "playground");
const output = path.join(lighthouseRoot, "capture-diagnostic.json");
const gathererStartAtMs = 27_700;
const watchdogMs = 45_000;
// Lighthouse 12.6.1's `desktop` preset (`core/config/constants.js`).
const lighthouseDesktop = {
  deviceScaleFactor: 1,
  height: 940,
  mobile: false,
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  width: 1350,
};
const { userAgent: lighthouseDesktopUserAgent, ...lighthouseDesktopMetrics } = lighthouseDesktop;
const mime = {
  ".bin": "application/octet-stream",
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function shell(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorReceipt(error, stage) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: error instanceof ProbeWatchdogError ? "watchdog" : "operation-error",
    message,
    name: error instanceof Error ? error.name : "Error",
    stage,
  };
}

class ProbeWatchdogError extends Error {
  constructor(stage) {
    super(`${stage} exceeded ${watchdogMs}ms`);
    this.name = "ProbeWatchdogError";
  }
}

function withWatchdog(stage, promise) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ProbeWatchdogError(stage)), watchdogMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Persist before and after every asynchronous protocol operation. */
async function observe(run, persist, stage, operation) {
  run.lastStage = stage;
  persist();
  try {
    const value = await withWatchdog(stage, operation());
    run.lastStage = `${stage}:ok`;
    persist();
    return { ok: true, value };
  } catch (error) {
    const receipt = errorReceipt(error, stage);
    run.errors.push(receipt);
    run.lastStage = stage;
    persist();
    return { error: receipt, ok: false };
  }
}

function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(basePath)) {
      response.writeHead(404).end();
      return;
    }
    let relative = decodeURIComponent(url.pathname.slice(basePath.length));
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const file = path.resolve(servedRoot, relative);
    if (
      !file.startsWith(`${servedRoot}${path.sep}`) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": mime[path.extname(file)] ?? "application/octet-stream",
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function fetchText(url) {
  const response = await fetch(url);
  return {
    contentType: response.headers.get("content-type") ?? "",
    status: response.status,
    text: await response.text(),
    url,
  };
}

async function fetchBytes(url) {
  const response = await fetch(url);
  return {
    bytes: (await response.arrayBuffer()).byteLength,
    contentType: response.headers.get("content-type") ?? "",
    status: response.status,
    url,
  };
}

function requireHttpResponse(receipt, type) {
  if (receipt.status !== 200 || !receipt.contentType.startsWith(type))
    throw new Error(
      `${receipt.url} returned ${receipt.status} ${receipt.contentType || "without content type"}; expected 200 ${type}`,
    );
}

function entryScriptUrl(index) {
  const sources = [...index.text.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/g)].map(
    (match) => match[1],
  );
  const source = sources[0];
  if (!source)
    throw new Error("production index did not contain an emitted JavaScript entry script");
  const url = new URL(source, index.url);
  if (!url.pathname.startsWith(basePath))
    throw new Error(`entry script falls outside the Playground base path: ${url.pathname}`);
  return url.href;
}

/**
 * Installed before application code. It only observes application context
 * creation; samples must never call canvas.getContext(), which could create a
 * context first and permanently select different attributes.
 */
function installPassiveContextProbe() {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  if (!descriptor || typeof descriptor.value !== "function") return;
  const original = descriptor.value;
  const calls = [];
  Object.defineProperty(window, "__hkCaptureProbe", {
    configurable: false,
    enumerable: false,
    value: { calls },
    writable: false,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    ...descriptor,
    value: function (...args) {
      const context = Reflect.apply(original, this, args);
      const kind = args[0];
      if (
        context &&
        (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl") &&
        typeof context.getContextAttributes === "function"
      ) {
        calls.push({
          attributes: context.getContextAttributes(),
          canvas: this,
          kind,
          time: performance.now(),
        });
      }
      return context;
    },
  });
}

function currentState() {
  const canvas = document.querySelector("canvas");
  const stage = document.querySelector("[data-pick]");
  const figure = document.querySelector("[data-figure]");
  const root = document.querySelector("#root");
  const rect = canvas?.getBoundingClientRect();
  const calls = window.__hkCaptureProbe?.calls ?? [];
  const created = [...calls].reverse().find((call) => call.canvas === canvas) ?? null;
  return {
    canvas: canvas
      ? {
          backing: [canvas.width, canvas.height],
          css: [rect?.width ?? 0, rect?.height ?? 0],
          // Attributes are from an app-created context captured by the init probe.
          context: created
            ? { attributes: created.attributes, kind: created.kind, time: created.time }
            : null,
        }
      : null,
    document: {
      client: [document.documentElement.clientWidth, document.documentElement.clientHeight],
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    },
    figure: figure?.getAttribute("data-figure") ?? null,
    root: root ? [root.clientWidth, root.clientHeight] : null,
    stage: stage?.getAttribute("data-pick") ?? null,
    timeOrigin: performance.timeOrigin,
  };
}

async function sample(run, persist, page, cdp, atMs, started) {
  const sampleReceipt = { atMs: null, layout: null, page: null, requestedAtMs: atMs };
  run.samples.push(sampleReceipt);
  persist();
  const remaining = atMs - (Date.now() - started);
  if (remaining > 0) {
    const slept = await observe(run, persist, `sample-${atMs}:wait`, () => wait(remaining));
    if (!slept.ok) return;
  }
  sampleReceipt.atMs = Date.now() - started;
  persist();
  const pageState = await observe(run, persist, `sample-${atMs}:page-evaluate`, () =>
    page.evaluate(currentState),
  );
  if (pageState.ok) {
    sampleReceipt.page = pageState.value;
    persist();
  }
  const layout = await observe(run, persist, `sample-${atMs}:layout-metrics`, () =>
    cdp.send("Page.getLayoutMetrics"),
  );
  if (layout.ok) {
    sampleReceipt.layout = layout.value;
    persist();
  }
}

async function captureCase({ base, browserPath, flags, id, persist, query, result, hideCanvas }) {
  const run = {
    capture: null,
    errors: [],
    id,
    lastStage: "new",
    samples: [],
    status: "in-progress",
  };
  result.runs.push(run);
  persist();
  let browser;
  let context;
  try {
    const launched = await observe(run, persist, "launch-browser", () =>
      chromium.launch({ args: flags, executablePath: browserPath, headless: true }),
    );
    if (!launched.ok) return;
    browser = launched.value;
    const contextResult = await observe(run, persist, "new-context", () =>
      browser.newContext({
        deviceScaleFactor: lighthouseDesktop.deviceScaleFactor,
        userAgent: lighthouseDesktopUserAgent,
        viewport: { height: lighthouseDesktop.height, width: lighthouseDesktop.width },
      }),
    );
    if (!contextResult.ok) return;
    context = contextResult.value;
    const pageResult = await observe(run, persist, "new-page", () => context.newPage());
    if (!pageResult.ok) return;
    const page = pageResult.value;
    const cdpResult = await observe(run, persist, "new-cdp-session", () =>
      context.newCDPSession(page),
    );
    if (!cdpResult.ok) return;
    const cdp = cdpResult.value;
    const initResult = await observe(run, persist, "install-context-probe", () =>
      page.addInitScript(installPassiveContextProbe),
    );
    if (!initResult.ok) return;
    const emulation = await observe(run, persist, "desktop-emulation", () =>
      cdp.send("Emulation.setDeviceMetricsOverride", lighthouseDesktopMetrics),
    );
    if (!emulation.ok) return;
    const started = Date.now();
    const navigation = await observe(run, persist, "navigate", () =>
      page.goto(`${base}index.html?muted${query}`, { waitUntil: "load" }),
    );
    if (!navigation.ok) return;
    for (const atMs of [0, 2_000, 10_000, gathererStartAtMs])
      await sample(run, persist, page, cdp, atMs, started);
    if (hideCanvas) {
      const hidden = await observe(run, persist, "hide-canvas", () =>
        page.evaluate(() => {
          const canvas = document.querySelector("canvas");
          if (!canvas) throw new Error("expected a production canvas before hidden-canvas capture");
          canvas.style.visibility = "hidden";
        }),
      );
      if (!hidden.ok) return;
    }
    const before = await observe(run, persist, "capture-layout-metrics", () =>
      cdp.send("Page.getLayoutMetrics"),
    );
    if (!before.ok) return;
    const viewport = before.value.cssLayoutViewport;
    const fullHeight = Math.round(
      (lighthouseDesktop.height * before.value.cssContentSize.height) / viewport.clientHeight,
    );
    run.capture = { fullHeight, status: "preparing" };
    persist();
    const resized = await observe(run, persist, "capture-resize-viewport", () =>
      cdp.send("Emulation.setDeviceMetricsOverride", {
        deviceScaleFactor: lighthouseDesktop.deviceScaleFactor,
        height: Math.min(fullHeight, 16_383),
        mobile: lighthouseDesktop.mobile,
        width: 0,
      }),
    );
    if (!resized.ok) return;
    const settle = await observe(run, persist, "capture-post-resize-wait", () => wait(5_000));
    if (!settle.ok) return;
    const captureStarted = Date.now();
    const captured = await observe(run, persist, "capture-webp", () =>
      cdp.send("Page.captureScreenshot", { format: "webp", quality: 30 }),
    );
    if (captured.ok) {
      const image = path.join(lighthouseRoot, `capture-${id}.webp`);
      fs.writeFileSync(image, Buffer.from(captured.value.data, "base64"));
      run.capture = {
        artifact: path.basename(image),
        bytes: captured.value.data.length,
        elapsedMs: Date.now() - captureStarted,
        fullHeight,
        status: "ok",
      };
    } else {
      run.capture = {
        elapsedMs: Date.now() - captureStarted,
        error: captured.error,
        fullHeight,
        status: "failed",
      };
    }
    persist();
  } finally {
    if (context) await observe(run, persist, "close-context", () => context.close());
    if (browser) await observe(run, persist, "close-browser", () => browser.close());
    if (run.status === "in-progress") run.status = run.errors.length === 0 ? "ok" : "failed";
    persist();
  }
}

shell("pnpm", ["build:playground"]);
shell("node", ["scripts/lighthouserc.mjs"]);
const config = JSON.parse(fs.readFileSync(path.join(lighthouseRoot, "lighthouserc.json"), "utf8"));
const flags = config.ci.collect.settings.chromeFlags.split(" ").filter(Boolean);
if (config.ci.collect.settings.disableFullPageScreenshot === true)
  throw new Error("diagnostic requires the real FullPageScreenshot gatherer to remain enabled");
const browserPath = process.env.HK_CHROME_PATH ?? "/usr/bin/google-chrome";
const preflightOnly = process.env.HK_CAPTURE_DIAGNOSTIC_PREFLIGHT_ONLY === "1";
if (!preflightOnly && !fs.existsSync(browserPath))
  throw new Error(`Chrome not found at ${browserPath}`);
const result = {
  browser: {
    path: browserPath,
    version: preflightOnly ? null : shell(browserPath, ["--version"]),
  },
  chromeFlags: flags,
  gathererStartAtMs,
  generatedAt: new Date().toISOString(),
  lighthouseDesktop,
  lifecycle: { errors: [], lastStage: "new", status: "in-progress" },
  preflight: { asset: null, index: null, status: "pending" },
  protocol: { format: "webp", quality: 30, watchdogMs },
  runs: [],
  status: "in-progress",
};
const persist = () => fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
persist();
let server;
try {
  const serverResult = await observe(result.lifecycle, persist, "start-static-server", startServer);
  if (!serverResult.ok) {
    result.status = "failed";
  } else {
    server = serverResult.value;
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("diagnostic server did not expose TCP");
    const base = `http://127.0.0.1:${address.port}${basePath}`;
    const index = await observe(result.lifecycle, persist, "preflight-index", () =>
      fetchText(`${base}index.html`),
    );
    if (!index.ok) {
      result.preflight.status = "failed";
      result.status = "failed";
    } else {
      try {
        requireHttpResponse(index.value, "text/html");
        result.preflight.index = {
          bytes: Buffer.byteLength(index.value.text),
          contentType: index.value.contentType,
          status: index.value.status,
          url: index.value.url,
        };
        persist();
        const asset = await observe(result.lifecycle, persist, "preflight-entry-script", () =>
          fetchBytes(entryScriptUrl(index.value)),
        );
        if (!asset.ok) {
          result.preflight.status = "failed";
          result.status = "failed";
        } else {
          requireHttpResponse(asset.value, "text/javascript");
          result.preflight.asset = asset.value;
          result.preflight.status = "ok";
          persist();
          if (preflightOnly) {
            result.status = "ok";
          } else {
            const cases = [
              { id: "creator", query: "", hideCanvas: false },
              { id: "shot-front", query: "&view=front", hideCanvas: false },
              { id: "creator-canvas-hidden", query: "", hideCanvas: true },
            ];
            for (const testCase of cases)
              await captureCase({ base, browserPath, flags, persist, result, ...testCase });
            result.status = result.runs.every((run) => run.status === "ok") ? "ok" : "failed";
          }
        }
      } catch (error) {
        result.preflight.status = "failed";
        result.status = "failed";
        result.error = errorReceipt(error, "preflight-validate");
      }
    }
  }
} catch (error) {
  result.status = "failed";
  result.error = errorReceipt(error, "driver");
} finally {
  if (server) {
    await observe(
      result.lifecycle,
      persist,
      "close-static-server",
      () =>
        new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
  }
  if (result.lifecycle.status === "in-progress")
    result.lifecycle.status = result.lifecycle.errors.length === 0 ? "ok" : "failed";
  if (result.lifecycle.status === "failed") result.status = "failed";
  persist();
}

if (result.status !== "ok") process.exitCode = 1;
