/**
 * Measures how long the playground takes to show a figure over a throttled
 * connection, and what it transfers.
 *
 *   pnpm build:playground && node scripts/measure-load.mjs [profile]
 *
 * Profiles: "fast4g" (default: 9 Mbit/s down, 170 ms round trip, CPU 4x
 * slower, a mid-range phone) and "cable" (40 Mbit/s, 20 ms, CPU 1x).
 *
 * Throttling happens in the server, not the browser: the figure's packs are
 * fetched by a Web Worker, which DevTools network emulation on the page does
 * not reach. The server serves dist-playground the way GitHub Pages does
 * (text gzipped, binaries as they are), delays each response by one round
 * trip, and paces every byte through one shared link of the profile's
 * bandwidth, counting what crosses it. CPU throttling applies to the page's
 * main thread only (Chromium does not throttle workers), so slow-CPU numbers
 * are a lower bound. Timings run from navigation to the figure being
 * evaluated and drawn; median of three cold loads, headed on the native GPU.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { createChromiumLaunchProfile } from "game-harness/chromium";

const PROFILES = {
  fast4g: { down: 9e6, rtt: 170, cpu: 4 },
  cable: { down: 40e6, rtt: 20, cpu: 1 },
};
const profileName = process.argv[2] ?? "fast4g";
const profile = PROFILES[profileName];
if (!profile)
  throw new Error(`unknown profile ${profileName}; use ${Object.keys(PROFILES).join(", ")}`);

const dist = path.resolve(import.meta.dirname, "../dist-playground");
if (!fs.existsSync(path.join(dist, "index.html")))
  throw new Error("build the playground first: pnpm build:playground");
const BASE_PATH = "/humanoid-kit/playground/";
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bin": "application/octet-stream",
  ".gz": "application/gzip",
};
/** Pages compresses text responses; binaries go as they are. */
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let linkFreeAt = 0;
let bytesSent = 0;

/** Sends a body through the shared link: one round trip of latency, then paced chunks. */
async function send(res, body) {
  await sleep(profile.rtt);
  const chunk = 16 * 1024;
  for (let o = 0; o < body.length; o += chunk) {
    const part = body.subarray(o, o + chunk);
    const now = performance.now();
    const start = Math.max(now, linkFreeAt);
    linkFreeAt = start + (part.length * 8 * 1000) / profile.down;
    if (linkFreeAt > now) await sleep(linkFreeAt - now);
    bytesSent += part.length;
    if (!res.write(part)) await new Promise((r) => res.once("drain", r));
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(BASE_PATH)) {
    res.writeHead(404).end();
    return;
  }
  let file = path.join(dist, decodeURIComponent(url.pathname.slice(BASE_PATH.length)));
  if (!file.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  const ext = path.extname(file);
  let body = fs.readFileSync(file);
  const headers = {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "cache-control": "no-store",
  };
  if (COMPRESSIBLE.has(ext) && /gzip/.test(String(req.headers["accept-encoding"]))) {
    body = gzipSync(body);
    headers["content-encoding"] = "gzip";
  }
  headers["content-length"] = String(body.length);
  res.writeHead(200, headers);
  await send(res, body);
});

async function coldLoad(browser, base) {
  const context = await browser.newContext({ viewport: { width: 412, height: 860 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  bytesSent = 0;
  linkFreeAt = 0;
  const t0 = Date.now();
  await page.goto(`${base}?muted&view=front`);
  await page.locator('[data-figure="ready"]').waitFor({ timeout: 300_000 });
  await page.evaluate(
    () =>
      new Promise((done) => {
        let n = 0;
        const tick = () => (++n >= 2 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
  const ms = Date.now() - t0;
  const bytes = bytesSent;
  await context.close();
  return { ms, bytes };
}

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}${BASE_PATH}`;
try {
  // Headed on the native GPU, as people see it (game-harness's shared launch profile).
  const { args, env } = createChromiumLaunchProfile({ gpuMode: process.env.HK_GPU ?? "auto" });
  const browser = await chromium.launch({ headless: false, args, env: { ...process.env, ...env } });
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await coldLoad(browser, base));
  await browser.close();
  runs.sort((a, b) => a.ms - b.ms);
  const median = runs[1];
  console.log(
    `measure-load (${profileName}): figure ready in ${(median.ms / 1000).toFixed(1)} s ` +
      `(runs ${runs.map((r) => (r.ms / 1000).toFixed(1)).join(", ")} s), ` +
      `${(median.bytes / 1e6).toFixed(2)} MB transferred`,
  );
} finally {
  server.close();
}
