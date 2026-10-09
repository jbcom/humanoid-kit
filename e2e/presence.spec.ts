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
import { budget } from "./budget.ts";

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
  // Stand still at one fixed place: the same still frame (and ground-to-pixel mapping) every run.
  await page.evaluate(() => {
    window.hkWalk?.setWalking(false);
    window.hkWalk?.setZ(0);
  });
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
  test.setTimeout(budget(180_000));

  test("two figures walking together share one shadow that separates as they part", async ({
    page,
  }) => {
    await openSilentGame(page, "./", { scene: "walk", bg: GROUND });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: budget(120_000) });

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
    await page.locator('[data-figure="ready"]').waitFor({ timeout: budget(120_000) });

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

  test("a kneeling figure's presence follows its pose, and the shadow follows what touches the ground", async ({
    page,
  }) => {
    await openSilentGame(page, "./", { scene: "walk", bg: GROUND });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: budget(120_000) });
    await stage(page, 1.8, 1);
    await save(page, "standing");
    const [standing] = await figures(page);
    if (!standing) throw new Error("the figure should be published");

    // Kneel: no new evaluation, only the pose, and the presence comes down.
    await page.evaluate(() => window.hkWalk?.setPose("benchmark"));
    await page.waitForFunction(
      (head) => (window.hkWalk?.figures()[0]?.head ?? head) < head - 0.25,
      standing.head,
      { timeout: budget(60_000) },
    );
    await frames(page);
    await save(page, "kneeling");
    const [kneeling] = await figures(page);
    if (!kneeling) throw new Error("the figure should still be published");
    expect(kneeling.head).toBeLessThan(standing.head - 0.25);
    // The pose raises both arms overhead, and the hand anchor went with them: it is
    // derived from the posed joints, not the rest body lifted.
    expect(standing.hand).toBeLessThan(standing.head);
    expect(kneeling.hand).toBeGreaterThan(kneeling.head);
    // Grounded: the posed body's lowest point is on the floor.
    expect(Math.abs(kneeling.floor)).toBeLessThan(0.01);
    // The contact is whatever touches the floor now: the benchmark pose is a
    // lunge, so one foot and not two, while standing had both.
    expect(standing.feet).toHaveLength(2);
    expect(kneeling.feet).toHaveLength(1);

    // The pooled shadow is under that contact, as dark as the model says: just in front of the patch.
    const patch = kneeling.feet[0] as number[];
    const x = patch[0] as number;
    const z = (patch[1] as number) + kneeling.radius + 0.02;
    const model = await expectedShadow(page, x, z);
    expect(model).toBeGreaterThan(0.08);
    const seen = await darkness(page, x, z);
    expect(Math.abs(seen - model)).toBeLessThan(0.06);

    // Standing again restores the standing presence.
    await page.evaluate(() => window.hkWalk?.setPose(null));
    await page.waitForFunction(
      (head) => Math.abs((window.hkWalk?.figures()[0]?.head ?? 0) - head) < 0.02,
      standing.head,
      { timeout: budget(60_000) },
    );
  });

  test("a relaxed figure's arms come in and nothing else in its presence moves", async ({
    page,
  }) => {
    await openSilentGame(page, "./", { scene: "walk", bg: GROUND });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: budget(120_000) });
    await stage(page, 1.8, 1);
    const [standing] = await figures(page);
    if (!standing) throw new Error("the figure should be published");

    // `relaxed` is standing at ease, arms at the sides: a pose that changes the
    // arms and leaves the legs, the head and the ground contact where they were.
    await page.evaluate(() => window.hkWalk?.setPose("relaxed"));
    await page.waitForFunction(
      (out) => (window.hkWalk?.figures()[0]?.handOut ?? out) < out - 0.1,
      standing.handOut,
      { timeout: budget(60_000) },
    );
    await frames(page);
    await save(page, "relaxed");
    const [relaxed] = await figures(page);
    if (!relaxed) throw new Error("the figure should still be published");
    // The hand is closer to the body and the whole figure is narrower.
    expect(relaxed.handOut).toBeLessThan(standing.handOut - 0.1);
    expect(relaxed.width).toBeLessThan(standing.width - 0.15);
    // The head, the floor and the two soles are as standing had them.
    expect(Math.abs(relaxed.head - standing.head)).toBeLessThan(0.02);
    expect(Math.abs(relaxed.floor)).toBeLessThan(0.01);
    expect(relaxed.feet).toHaveLength(2);
    expect(Math.abs(relaxed.radius - standing.radius)).toBeLessThan(0.02);
    for (let i = 0; i < 2; i++) {
      expect(
        Math.abs((relaxed.feet[i]?.[0] as number) - (standing.feet[i]?.[0] as number)),
      ).toBeLessThan(0.02);
      expect(
        Math.abs((relaxed.feet[i]?.[1] as number) - (standing.feet[i]?.[1] as number)),
      ).toBeLessThan(0.02);
    }
    // So the stage's shadow is where it was: under the same feet.
    const x = standing.feet[0]?.[0] as number;
    const z = (standing.feet[0]?.[1] as number) + 0.17;
    expect(await expectedShadow(page, x, z)).toBeGreaterThan(0.1);
    expect(
      Math.abs((await darkness(page, x, z)) - (await expectedShadow(page, x, z))),
    ).toBeLessThan(0.06);
  });
});
