/**
 * Direct body-hair lab contract. This drives the deliberately finite controls
 * and proves each selection reaches a settled adult figure. It does not call a
 * contact sheet a visual acceptance: screenshots still need root review.
 */
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { budget } from "./budget.ts";

const REGIONS = ["Face", "Chest", "Axillary", "Legs"] as const;
const FORMS = ["Feminine", "Mixed", "Masculine"] as const;

async function selectedRecipe(page: Page) {
  const raw = await page.locator("[data-body-hair-recipe]").getAttribute("data-body-hair-recipe");
  if (!raw) throw new Error("the direct lab did not expose its rendered recipe");
  return JSON.parse(raw) as {
    age: number;
    gender: number;
    bodyHair: { coverage: Record<string, number>; follicleDensity: Record<string, number> };
  };
}

async function choose(page: Page, name: string) {
  const figure = page.locator("[data-body-hair-figure]");
  const before = Number(await figure.getAttribute("data-body-hair-generation"));
  await page.getByRole("button", { name, exact: true }).click();
  await expect(figure).toHaveAttribute("data-body-hair-generation", String(before + 1));
  await expect(figure).toHaveAttribute("data-body-hair-figure", "ready", { timeout: 120_000 });
}

/** A fixed studio background makes a blank or off-camera canvas distinguishable from a visible figure. */
async function visiblePixels(page: Page): Promise<number> {
  return page.locator("canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext("2d");
    if (!context) throw new Error("could not read the direct lab canvas");
    context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const background = [pixels[0], pixels[1], pixels[2]];
    let visible = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const distance =
        Math.abs((pixels[index] as number) - (background[0] as number)) +
        Math.abs((pixels[index + 1] as number) - (background[1] as number)) +
        Math.abs((pixels[index + 2] as number) - (background[2] as number));
      if (distance > 36) visible++;
    }
    return visible;
  });
}

test.describe("the direct body-hair lab", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("keeps adult regional probes, forms, coverage and follicle density independently inspectable", async ({
    page,
  }, info) => {
    test.setTimeout(budget(8 * 60_000));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await openSilentGame(page, "./", { bodyHairLab: "", muted: "", coatprobe: "" });
    await page.locator('[data-body-hair-figure="ready"]').waitFor({ timeout: 120_000 });
    await expect(page.getByRole("heading", { name: "Body hair controls" })).toBeVisible();
    await expect(page.locator("[data-body-hair-stage]")).toBeVisible();
    await expect(page.locator("[data-body-hair-controls]")).toBeVisible();

    for (const region of REGIONS) {
      await choose(page, region);
      const recipe = await selectedRecipe(page);
      expect(recipe.age, `${region}: uses the declared adult probe age`).toBe(30);
      expect(recipe.bodyHair.coverage).toHaveProperty(region.toLowerCase());
      expect(
        await visiblePixels(page),
        `${region}: model remains in its regional camera`,
      ).toBeGreaterThan(1_000);
      await choose(page, "None");
      expect((await selectedRecipe(page)).bodyHair.coverage).toEqual({ [region.toLowerCase()]: 0 });
      await choose(page, "Full");
      expect((await selectedRecipe(page)).bodyHair.coverage).toEqual({ [region.toLowerCase()]: 1 });
      await choose(page, "Sparse follicles");
      expect((await selectedRecipe(page)).bodyHair.follicleDensity).toEqual({
        [region.toLowerCase()]: 0.25,
      });
      await choose(page, "Dense follicles");
      expect((await selectedRecipe(page)).bodyHair.follicleDensity).toEqual({
        [region.toLowerCase()]: 2,
      });
      if (region === "Chest") {
        const coats = await page.evaluate(() => window.hkCoatProbe?.() ?? []);
        const chest = coats
          .flatMap((coat) => coat.uniforms.rows)
          .find((row) => row.region === "hair-chest");
        expect(chest).toMatchObject({ cover: expect.closeTo(0.84375, 5), density: 44 });
      }
      await page.screenshot({
        path: info.outputPath(`body-hair-${region.toLowerCase()}.png`),
        fullPage: true,
      });
    }

    for (const form of FORMS) {
      await choose(page, form);
      await expect(page.getByText(`Form: ${form}`, { exact: true })).toBeVisible();
      expect((await selectedRecipe(page)).gender).toBe(
        FORMS.indexOf(form as (typeof FORMS)[number]) / 2,
      );
    }

    const controlScroll = await page.locator("[data-body-hair-controls]").evaluate((element) => {
      const node = element as HTMLElement;
      node.scrollTop = node.scrollHeight;
      return {
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    });
    expect(controlScroll.scrollHeight).toBeGreaterThan(controlScroll.clientHeight);
    expect(controlScroll.scrollTop).toBeGreaterThan(0);
    await expect(page.locator('[data-body-hair-figure="ready"]')).toBeVisible();
    await page.screenshot({ path: info.outputPath("body-hair-direct-lab.png"), fullPage: true });
    expect(errors).toEqual([]);
  });
});
