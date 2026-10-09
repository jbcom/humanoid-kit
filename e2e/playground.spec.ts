import { expect, test } from "@playwright/test";

test("the playground shell mounts a WebGL canvas without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  const hasContext = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    return Boolean(target.getContext("webgl2") ?? target.getContext("webgl"));
  });
  expect(hasContext).toBe(true);
  expect(errors).toEqual([]);
});
