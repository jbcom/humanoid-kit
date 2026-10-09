/**
 * Posing on the GPU: the skinned figure follows MakeHuman's face units where
 * they act and nowhere else. An open jaw changes the lower face and leaves the
 * forehead as it was; closed lids change the eye band and leave the mouth.
 */
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { budget } from "./budget.ts";

/** Close on the face, which spans the frame from brow to chin. */
const CAMERA = "0,1.55,0.6,0,1.55,0";

async function show(page: Page, faceUnits: Record<string, number>): Promise<void> {
  const generation = await page.evaluate((units) => {
    const set = window.hkSetRecipe;
    if (!set) throw new Error("the QA shot is not mounted");
    const next =
      Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
    set({}, { faceUnits: units });
    return next;
  }, faceUnits);
  await page
    .locator(`[data-figure="ready"][data-generation="${generation}"]`)
    .waitFor({ timeout: 60_000 });
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 0;
        const tick = () => (++frames >= 4 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
}

/** Mean RGB of each horizontal band of the frame's middle third (0 = top). */
async function bands(page: Page, count: number): Promise<number[][]> {
  return page.locator("canvas").evaluate((el, n) => {
    const c = el as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(c, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const out: number[][] = [];
    for (let b = 0; b < n; b++) {
      const y0 = Math.floor((b * c.height) / n);
      const y1 = Math.floor(((b + 1) * c.height) / n);
      const sum = [0, 0, 0];
      let count = 0;
      for (let y = y0; y < y1; y++)
        for (let x = Math.floor(c.width / 3); x < Math.floor((2 * c.width) / 3); x++) {
          const i = (y * c.width + x) * 4;
          for (let k = 0; k < 3; k++) sum[k] = (sum[k] as number) + (data[i + k] as number);
          count++;
        }
      out.push(sum.map((s) => s / count));
    }
    return out;
  }, count);
}

const change = (a: number[], b: number[]) =>
  Math.abs((a[0] as number) - (b[0] as number)) +
  Math.abs((a[1] as number) - (b[1] as number)) +
  Math.abs((a[2] as number) - (b[2] as number));

/** The lowest row of the frame (0 top, 1 bottom) that is not the key background. */
async function lowestFigureRow(page: Page): Promise<number> {
  return page.locator("canvas").evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(c, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    for (let y = c.height - 1; y >= 0; y--)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const d =
          Math.abs((data[i] as number) - 255) +
          Math.abs(data[i + 1] as number) +
          Math.abs((data[i + 2] as number) - 255);
        if (d > 60) return y / c.height;
      }
    return 0;
  });
}

test.describe("grounding", () => {
  test.use({ viewport: { width: 240, height: 360 } });
  test.setTimeout(budget(180_000));

  test("a kneeling figure comes down to the ground it stands on", async ({ page }) => {
    // The camera sits at floor height, looking level, so every point of the
    // floor projects onto the horizon (the middle row) whatever its depth: a
    // grounded figure's lowest pixel is on that row, a floating one's above it.
    // The magenta background keys out everything but the figure.
    await openSilentGame(page, "./", { cam: "0,0,4.2,0,0,0", bg: "ff00ff" });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
    await show(page, {});
    const standing = await lowestFigureRow(page);
    await page.evaluate(() => {
      window.hkSetRecipe?.({}, { body: "benchmark" });
    });
    await page.locator('[data-figure="ready"][data-generation="2"]').waitFor({ timeout: 60_000 });
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    const kneeling = await lowestFigureRow(page);
    // Both on the horizon, within a few pixels.
    expect(Math.abs(standing - 0.5)).toBeLessThan(0.015);
    expect(Math.abs(kneeling - 0.5)).toBeLessThan(0.015);
  });
});

test.describe("posing", () => {
  test.use({ viewport: { width: 240, height: 300 } });
  test.setTimeout(budget(180_000));

  test("face units move the face where they act and nowhere else", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await openSilentGame(page, "./", { cam: CAMERA });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });

    // Ten bands: the brow near the top, the eyes about a third down, the mouth near the bottom.
    await show(page, {});
    const rest = await bands(page, 10);
    await show(page, { JawDrop: 1 });
    const jaw = await bands(page, 10);
    await show(page, { LeftUpperLidClosed: 1, RightUpperLidClosed: 1 });
    const lids = await bands(page, 10);

    const moved = (posed: number[][]) => posed.map((b, i) => change(b, rest[i] as number[]));
    const jawMoved = moved(jaw);
    const lidsMoved = moved(lids);
    // Measured on the default figure: the open jaw moves the mouth bands by
    // about 36 and 21 and nothing above the nose; closed lids move the eye band
    // by about 6 and nothing below the nose.
    expect(Math.max(...jawMoved.slice(6))).toBeGreaterThan(15);
    for (const b of jawMoved.slice(0, 5)) expect(b).toBeLessThan(0.5);
    expect(Math.max(...lidsMoved.slice(3, 6))).toBeGreaterThan(3);
    for (const b of lidsMoved.slice(7)) expect(b).toBeLessThan(0.5);
    expect(errors).toEqual([]);
  });
});
