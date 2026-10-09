/**
 * Presence in the studio: two figures walking side by side share one contact
 * shadow on the ground. The shadow fills the ground between them while they
 * are together, clears as they part, and where they overlap is exactly as dark
 * as one figure's, never doubled. Each reading is taken from the rendered
 * canvas and checked against what the presence model (`sampleGroundOcclusion`
 * over the registry) says the ground should be.
 *
 * Set HK_PRESENCE_SHOTS to a directory to also save each state's screenshot.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";

/** A light ground, so a shadow on it is measurable (the default studio ground is near black). */
const GROUND = "c8c8c8";
const shots = process.env.HK_PRESENCE_SHOTS;

const frames = (page: Page, n = 3) =>
  page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        let left = count;
        const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

/** Eases the gap to `metres`, then stops the walk so a reading is taken of a still frame. */
async function stage(page: Page, gap: number, count: 1 | 2 = 2) {
  await page.evaluate(
    ({ gap, count }) => {
      const walk = window.hkWalk;
      if (!walk) throw new Error("the walk scene is not mounted");
      walk.setCount(count);
      walk.setGap(gap);
    },
    { gap, count },
  );
  await page.waitForFunction(
    ({ gap, count }) => {
      const walk = window.hkWalk;
      return !!walk && Math.abs(walk.state().gap - gap) < 1e-3 && walk.figures().length === count;
    },
    { gap, count },
  );
  await page.evaluate(() => window.hkWalk?.setWalking(false));
  await frames(page);
}

/** How much darker than the open ground the canvas is at ground point (x, z): 0 none … 1 black. */
async function darkness(page: Page, x: number, z: number): Promise<number> {
  return page.evaluate(
    ([x, z]) => {
      const walk = window.hkWalk;
      const canvas = document.querySelector("canvas");
      if (!walk || !canvas) throw new Error("the walk scene is not mounted");
      const luma = (cx: number, cy: number) => {
        const copy = document.createElement("canvas");
        copy.width = 5;
        copy.height = 5;
        const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(canvas, Math.round(cx) - 2, Math.round(cy) - 2, 5, 5, 0, 0, 5, 5);
        const px = ctx.getImageData(0, 0, 5, 5).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 4)
          sum += ((px[i] as number) + (px[i + 1] as number) + (px[i + 2] as number)) / 3;
        return sum / 25 / 255;
      };
      const [px, py] = walk.groundPixel(x as number, z as number);
      // The top-left corner is open background: the ground's own brightness.
      return 1 - luma(px, py) / luma(4, 4);
    },
    [x, z] as const,
  );
}

const figures = (page: Page) => page.evaluate(() => window.hkWalk?.figures() ?? []);
const expectedShadow = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => window.hkWalk?.expectedShadow(x as number, z as number) ?? 0, [
    x,
    z,
  ] as const);

async function save(page: Page, name: string) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

test.describe("presence in the studio", () => {
  test.use({ viewport: { width: 640, height: 480 } });
  test.setTimeout(5 * 60_000);

  test("two figures walking together share one shadow that separates as they part", async ({
    page,
  }) => {
    await openSilentGame(page, "./", { scene: "walk", bg: GROUND });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });

    // Walking: both figures move toward the camera at the same pace, and the
    // registry measured it.
    await page.waitForFunction(() => {
      const f = window.hkWalk?.figures() ?? [];
      return f.length === 2 && f.every((p) => Math.abs((p.velocity[2] ?? 0) - 0.9) < 0.3);
    });

    // Together: the ground between their nearest feet is shadowed, and as dark
    // as the model says.
    await stage(page, 0.9);
    await save(page, "together");
    const [a, b] = await figures(page);
    if (!a || !b) throw new Error("both figures should be published");
    const x =
      (Math.max(...a.feet.map((f) => f[0] as number)) +
        Math.min(...b.feet.map((f) => f[0] as number))) /
      2;
    const z = a.feet[0]?.[1] as number;
    const between = await darkness(page, x, z);
    const modelBetween = await expectedShadow(page, x, z);
    expect(modelBetween).toBeGreaterThan(0.1);
    expect(between).toBeGreaterThan(0.08);
    expect(Math.abs(between - modelBetween)).toBeLessThan(0.06);

    // Apart: the same ground point is open again.
    await stage(page, 1.8);
    await save(page, "apart");
    const apart = await darkness(page, x, z);
    expect(await expectedShadow(page, x, z)).toBe(0);
    expect(apart).toBeLessThan(0.02);
    expect(between - apart).toBeGreaterThan(0.06);
  });

  test("where figures overlap the ground is no darker than under one figure", async ({ page }) => {
    await openSilentGame(page, "./", { scene: "walk", bg: GROUND });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });

    // Two figures with the same feet, standing on the same spot: their soles coincide.
    await page.evaluate(() => window.hkWalk?.setTwins(true));
    await page.waitForFunction(() => {
      const f = window.hkWalk?.figures() ?? [];
      const sole = (p: (typeof f)[number]) => (p.feet[0]?.[0] ?? 0) - (p.position[0] ?? 0);
      return (
        f.length === 2 &&
        Math.abs((f[0]?.radius ?? 0) - (f[1]?.radius ?? 1)) < 1e-6 &&
        Math.abs(sole(f[0] as (typeof f)[number]) - sole(f[1] as (typeof f)[number])) < 1e-6
      );
    });
    await stage(page, 0, 2);
    await save(page, "overlapped");
    const [a] = await figures(page);
    if (!a) throw new Error("the figures should be published");
    // In front of the left toes, where the ground is in view and shadowed.
    const x = a.feet[0]?.[0] as number;
    const z = (a.feet[0]?.[1] as number) + 0.17;
    const overlapped = await darkness(page, x, z);
    const modelOverlapped = await expectedShadow(page, x, z);

    await stage(page, 0, 1);
    await save(page, "single");
    const single = await darkness(page, x, z);
    const modelSingle = await expectedShadow(page, x, z);

    expect(modelSingle).toBeGreaterThan(0.1);
    // The model pools with max, and so does the render.
    expect(modelOverlapped).toBeCloseTo(modelSingle, 6);
    expect(single).toBeGreaterThan(0.08);
    expect(Math.abs(single - modelSingle)).toBeLessThan(0.06);
    expect(Math.abs(overlapped - single)).toBeLessThan(0.02);
  });
});
