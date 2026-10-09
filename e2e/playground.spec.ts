import { expect, test } from "@playwright/test";

test("the playground mounts a WebGL figure without console errors or outside requests", async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  // Everything a figure needs ships with the packages: no CDN, no third-party host.
  const origin = new URL(baseURL as string).origin;
  const outside: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== origin) outside.push(request.url());
  });

  await page.goto("/?muted&view=front");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
  // Give lazily loaded assets (textures, environment) time to be requested.
  await page.waitForTimeout(2000);

  const hasContext = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    return Boolean(target.getContext("webgl2") ?? target.getContext("webgl"));
  });
  expect(hasContext).toBe(true);
  expect(errors).toEqual([]);
  expect(outside).toEqual([]);
});
