/**
 * The miniature stress lab (`?miniatures=N`, docs/MINIATURES.md): hundreds of
 * baked figures of four archetypes walk, idle and crouch on the table. The
 * draw calls and triangles the renderer reports must stay inside the issue's
 * budget whatever the hardware. The frame time is judged only on a display's
 * GPU (the page's own WebGL renderer string says which, `judgesFramePacing`):
 * software rendering measures the CPU, and a hosted runner's virtual GPU draws
 * even one figure at 10 to 13 frames a second. Elsewhere that test is skipped
 * with a reason the skip ledger counts.
 *
 * The frame and the measure are saved with the test's results; set
 * HK_MINIATURE_SHOTS to a directory to also copy the frame there.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import type { MiniatureMeasure } from "../playground/src/MiniatureLab.tsx";
import { budget } from "./budget.ts";
import { FRAME_PACING_SKIP, judgesFramePacing } from "./lib/gpuLane.ts";

const shots = process.env.HK_MINIATURE_SHOTS;

async function measure(page: Page, testInfo: TestInfo, count: number): Promise<MiniatureMeasure> {
  await openSilentGame(page, "./", { miniatures: String(count) });
  await page.locator('[data-miniatures="ready"]').waitFor({ timeout: budget(180_000) });
  const m = (await page.evaluate(() => window.hkMiniatures)) as MiniatureMeasure;
  // The measure and the frame go with the result, so a remote run can be reviewed.
  const name = `miniatures-${count}`;
  const shot = await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  fs.writeFileSync(testInfo.outputPath(`${name}.json`), JSON.stringify(m, null, 2));
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    fs.writeFileSync(path.join(shots, `${name}.png`), shot);
  }
  return m;
}

test.describe("miniatures", () => {
  test("draws 500 figures inside the draw and triangle budget", async ({ page }, testInfo) => {
    test.setTimeout(budget(240_000));
    const m = await measure(page, testInfo, 500);
    expect(m.figures).toBe(500);
    expect(m.crowd.visible).toBeGreaterThan(0);
    // Each archetype is at most one instanced draw per level (4 × 3), plus the table.
    expect(m.drawCalls).toBeLessThanOrEqual(20);
    expect(m.triangles).toBeLessThanOrEqual(250_000);
  });

  test("draws 500 figures at the display's rate, as it draws one", async ({ page }, testInfo) => {
    test.setTimeout(budget(360_000));
    const one = await measure(page, testInfo, 1);
    // Judged only where a frame measures a display's GPU (`judgesFramePacing`).
    test.skip(!judgesFramePacing(one.renderer), FRAME_PACING_SKIP);
    const m = await measure(page, testInfo, 500);
    // A frame of 500 figures keeps to the display's rate, as one figure
    // does; the p95 may hold about one dropped frame of pacing.
    expect(m.medianMs).toBeLessThanOrEqual(Math.max(one.medianMs, 1000 / 60) + 1);
    expect(m.p95Ms).toBeLessThanOrEqual(Math.max(one.p95Ms, 2000 / 60) + 1);
  });
});
