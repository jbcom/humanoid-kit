import { expect, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { budget } from "./budget.ts";

test.use({ viewport: { width: 1040, height: 433 } });

const CONTROLS = [
  { id: "genitals/phallus-size", label: "Phallus size", restored: "0.325" },
  { id: "genitals/testes-size", label: "Testes size", restored: "0.300" },
  { id: "genitals/vulva-size", label: "Vulva", restored: "0.500" },
  { id: "genitals/anal-canal", label: "Anal canal", restored: "1.000" },
] as const;

test("keeps each defaulted-adult action attached to its named control while the worker updates", async ({
  page,
}) => {
  test.setTimeout(budget(180_000));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await openSilentGame(page, "./", { adult: 1, lab: "effective-adult-values" });
  await expect(page.locator('[data-lab="effective-adult-values"]')).toBeVisible();
  await page.locator('[data-render-bounds="visible"]').waitFor({ timeout: budget(120_000) });

  // Deliberately do not wait for the worker between clicks. Every control must
  // commit its own raw zero and expose its own reset before that reset is sent.
  for (const control of CONTROLS) {
    const row = page.locator(`[data-control-id="${control.id}"]`);
    const setZero = row.getByRole("button", { name: `Set ${control.label} to zero` });
    const reset = row.getByRole("button", { name: `Reset ${control.label}` });
    await setZero.click();
    await expect(row.locator(`[data-raw-control="${control.id}"]`)).toHaveText("0.000");
    await expect(reset).toBeEnabled();
  }

  for (const control of CONTROLS) {
    const row = page.locator(`[data-control-id="${control.id}"]`);
    const reset = row.getByRole("button", { name: `Reset ${control.label}` });
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(row.locator(`[data-raw-control="${control.id}"]`)).toHaveText(
      "absent (default applies)",
    );
    await expect(row.locator(`[data-effective-control="${control.id}"]`)).toHaveText(
      control.restored,
    );
  }

  await expect(page.getByText("History: 8 changes")).toBeVisible();
  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect(page.locator('[data-raw-control="genitals/anal-canal"]')).toHaveText("0.000");
  await expect(page.getByText("History: 7 changes")).toBeVisible();
  const panel = page.locator("[data-lab-panel]");
  await panel.evaluate((element) => {
    const panel = element as HTMLElement;
    panel.scrollTop = panel.scrollHeight;
  });
  const scroll = await panel.evaluate((element) => {
    const panel = element as HTMLElement;
    const root = panel.closest("[data-lab='effective-adult-values']") as HTMLElement | null;
    return { panel: panel.scrollTop, root: root?.scrollTop ?? Number.NaN };
  });
  expect(scroll.panel, "only the controls panel scrolls").toBeGreaterThan(0);
  expect(scroll.root, "the fixed lab shell never scrolls").toBe(0);
  const canvas = await page.locator("[data-lab-stage] canvas").boundingBox();
  const viewport = page.viewportSize();
  if (!canvas || !viewport) throw new Error("adult-defaults lab canvas or viewport is unavailable");
  expect(canvas.x, "canvas left edge stays in the browser viewport").toBeGreaterThanOrEqual(-0.5);
  expect(canvas.y, "canvas top edge stays in the browser viewport").toBeGreaterThanOrEqual(-0.5);
  expect(
    canvas.x + canvas.width,
    "canvas right edge stays in the browser viewport",
  ).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(
    canvas.y + canvas.height,
    "canvas bottom edge stays in the browser viewport",
  ).toBeLessThanOrEqual(viewport.height + 0.5);
  expect(errors).toEqual([]);
});
