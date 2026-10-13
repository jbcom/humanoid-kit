/**
 * The miniature stress lab (`?miniatures=N`, docs/MINIATURES.md): hundreds of
 * baked figures of four archetypes walk, idle and crouch on the table. The
 * draw calls and triangles the renderer reports must stay inside the issue's
 * budget whatever the hardware; the frame time is held to 60 fps only on a
 * GPU, since software rendering measures the CPU, not the miniature path.
 *
 * Set HK_MINIATURE_SHOTS to a directory to also save the lab's screenshot.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import type { MiniatureMeasure } from "../playground/src/MiniatureLab.tsx";
import { budget } from "./budget.ts";

const software = (process.env.HK_GPU ?? (process.env.CI ? "software" : "auto")) === "software";
const shots = process.env.HK_MINIATURE_SHOTS;

test.describe("miniatures", () => {
  test("draws 500 figures inside the draw, triangle and frame budget", async ({ page }) => {
    test.setTimeout(budget(240_000));
    await openSilentGame(page, "./", { miniatures: "500" });
    const ready = page.locator('[data-miniatures="ready"]');
    await ready.waitFor({ timeout: budget(180_000) });
    const m = (await page.evaluate(() => window.hkMiniatures)) as MiniatureMeasure;

    expect(m.figures).toBe(500);
    expect(m.crowd.visible).toBeGreaterThan(0);
    // Each archetype is at most one instanced draw per level (4 × 3), plus the table.
    expect(m.drawCalls).toBeLessThanOrEqual(20);
    expect(m.triangles).toBeLessThanOrEqual(250_000);
    if (!software) expect(m.p95Ms).toBeLessThan(1000 / 60);

    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, "miniatures-500.png") });
    }
  });
});
