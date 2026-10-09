import { expect, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { requireHardwareWebGL } from "game-harness/production-runtime";

test("the playground mounts a WebGL figure without console errors or outside requests", async ({
  page,
  context,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  // Everything a figure needs ships with the packages: no CDN, no third-party
  // host. Listening on the context also sees the evaluation worker's fetches.
  const origin = new URL(baseURL as string).origin;
  const outside: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== origin) outside.push(request.url());
  });

  await openSilentGame(page, "./", { view: "front" });
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  // Unless the run declared software rendering, the GPU must be real: a test
  // that silently fell back to SwiftShader would not show what users see.
  if ((process.env.HK_GPU ?? (process.env.CI ? "software" : "auto")) !== "software")
    await requireHardwareWebGL(page);
  await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
  // The figure is drawn; anything lazy (textures, environment) has been requested by now.
  await page.waitForTimeout(1000);

  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});
