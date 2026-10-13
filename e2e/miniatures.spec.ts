/**
 * The miniature stress lab (`?miniatures=N`, docs/MINIATURES.md): hundreds of
 * baked figures of four archetypes walk, idle and crouch on the table. The
 * draw calls and triangles the renderer reports must stay inside the issue's
 * budget whatever the hardware. The frame time is judged only on a GPU (the
 * page's own WebGL renderer string says which), since software rendering
 * measures the CPU, not the miniature path.
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

const shots = process.env.HK_MINIATURE_SHOTS;
/** WebGL renderer strings of software rasterisers, whose frame times measure the CPU. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render driver/i;

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
  test("draws 500 figures inside the draw, triangle and frame budget", async ({
    page,
  }, testInfo) => {
    test.setTimeout(budget(360_000));
    const one = await measure(page, testInfo, 1);
    const m = await measure(page, testInfo, 500);

    expect(m.figures).toBe(500);
    expect(m.crowd.visible).toBeGreaterThan(0);
    // Each archetype is at most one instanced draw per level (4 × 3), plus the table.
    expect(m.drawCalls).toBeLessThanOrEqual(20);
    expect(m.triangles).toBeLessThanOrEqual(250_000);
    if (!SOFTWARE.test(m.renderer)) {
      // A frame of 500 figures keeps to the display's rate, as one figure
      // does; the p95 may hold about one dropped frame of pacing.
      expect(m.medianMs).toBeLessThanOrEqual(Math.max(one.medianMs, 1000 / 60) + 1);
      expect(m.p95Ms).toBeLessThanOrEqual(Math.max(one.p95Ms, 2000 / 60) + 1);
    }
  });
});
