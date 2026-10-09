/**
 * The creator, driven as a person would: tapping a part of the figure opens
 * the controls that shape that part, framed, and dragging the view does not.
 */
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";

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

const selectedTab = (page: Page) => page.locator('[role="tab"][aria-selected="true"]');
const revealedGroup = (page: Page) => page.locator("details[data-revealed] > summary span").first();

test("tapping a part of the figure opens the controls that shape it", async ({ page }) => {
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
