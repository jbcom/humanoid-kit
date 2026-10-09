/**
 * The creator, driven as a person would: tapping a part of the figure opens
 * the controls that shape that part, framed, and dragging the view does not.
 */
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { budget } from "./budget.ts";

// Tap positions are fractions of the canvas for this viewport, with the whole
// figure framed from the front (the Main tab's view).
test.use({ viewport: { width: 1280, height: 800 } });

async function wholeFigure(page: Page) {
  await page.getByRole("tab", { name: "Main" }).click();
  // The camera glides to the new framing.
  await page.waitForTimeout(1500);
}

async function tap(page: Page, fx: number, fy: number) {
  const box = await page.locator(".hk-stage canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/**
 * The canvas, scaled down to 64 × 64 RGBA in the page (the creator preserves
 * its drawing buffer): enough to tell one framing from another, small to ship.
 */
const canvasPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector(".hk-stage canvas") as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = 64;
    copy.height = 64;
    const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0, 64, 64);
    return Array.from(ctx.getImageData(0, 0, 64, 64).data);
  });

/** Mean absolute difference per channel, 0–255. */
const meanDifference = (a: number[], b: number[]) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] as number) - (b[i] as number));
  return sum / a.length;
};

const selectedTab = (page: Page) => page.locator('[role="tab"][aria-selected="true"]');
const revealedGroup = (page: Page) => page.locator("details[data-revealed] > summary span").first();

test("tapping a part of the figure opens the controls that shape it", async ({ page }) => {
  // Each step waits for the camera to glide; the figure load is the rest.
  test.setTimeout(budget(180_000));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await openSilentGame(page, "./");
  await page.locator('.hk-stage[data-pick="ready"]').waitFor({ timeout: 120_000 });
  await expect(page.locator(".hk-status")).toHaveCount(0);

  for (const { at, task, group } of [
    { at: [0.499, 0.204], task: "Face", group: /^Nose/ },
    { at: [0.689, 0.465], task: "Arms and Legs", group: /^Left hand$/ },
    { at: [0.431, 0.828], task: "Arms and Legs", group: /^Right foot$/ },
    { at: [0.499, 0.413], task: "Torso", group: /^Stomach$/ },
  ] as const) {
    await wholeFigure(page);
    await tap(page, at[0], at[1]);
    await expect(selectedTab(page)).toHaveText(task);
    await expect(revealedGroup(page)).toHaveText(group);
    // Revealed means open and in view.
    await expect(page.locator("details[data-revealed]")).toHaveAttribute("open", "");
    await expect(page.locator("details[data-revealed]")).toBeInViewport();
  }

  // Tapping the face again after orbiting away frames the head from the front
  // again, although the requested framing (head, front) has not changed.
  await wholeFigure(page);
  await tap(page, 0.499, 0.204);
  await page.waitForTimeout(2000);
  const framed = await canvasPixels(page);
  const stage = await page.locator(".hk-stage canvas").boundingBox();
  if (!stage) throw new Error("no canvas");
  await page.mouse.move(stage.x + stage.width * 0.35, stage.y + stage.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.65, stage.y + stage.height * 0.6, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  expect(meanDifference(await canvasPixels(page), framed)).toBeGreaterThan(5);
  // The orbit keeps the head at the centre of the view.
  await tap(page, 0.5, 0.5);
  await page.waitForTimeout(2500);
  await expect(selectedTab(page)).toHaveText("Face");
  expect(meanDifference(await canvasPixels(page), framed)).toBeLessThan(1);

  // Dragging to orbit is not a tap: nothing opens. The drag starts and ends on
  // the figure (three only clicks when press and release hit the same object),
  // and moves further than a tap may.
  await wholeFigure(page);
  const box = await page.locator(".hk-stage canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  const y = box.y + box.height * 0.413;
  await page.mouse.move(box.x + box.width * 0.49, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.51, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(selectedTab(page)).toHaveText("Main");
  await expect(page.locator("details[data-revealed]")).toHaveCount(0);

  expect(errors).toEqual([]);
});
