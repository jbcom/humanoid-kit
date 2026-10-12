import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});

try {
  const page = await browser.newPage();
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return null;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
  });
  console.log(`WebGL renderer: ${renderer ?? "unavailable"}`);
  if (!renderer || !/metal/i.test(renderer) || /swiftshader|software|llvmpipe/i.test(renderer))
    throw new Error(`Metal renderer required; received ${renderer ?? "unavailable"}`);
} finally {
  await browser.close();
}
