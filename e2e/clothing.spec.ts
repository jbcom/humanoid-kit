/**
 * Clothing on the GPU: garments bound to the base mesh follow the pose, hide the
 * skin they cover without leaving it showing through, and cost nothing to a
 * visit that does not ask for the clothing pack.
 */
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { budget } from "./budget.ts";

/** The whole figure in frame, on a key colour no figure uses. */
const FULL = { cam: "0,0.95,4.2,0,0.9,0", bg: "ff00ff", clothing: "1" } as const;

const SWEATER = "suits/male_casualsuit02";
const SHOES = "shoes/shoes03";

async function show(
  page: Page,
  recipe: Record<string, unknown>,
  pose: Record<string, unknown> = {},
): Promise<void> {
  const generation = await page.evaluate(
    ({ recipe, pose }) => {
      const set = window.hkSetRecipe;
      if (!set) throw new Error("the QA shot is not mounted");
      const next =
        Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
      set(recipe, pose);
      return next;
    },
    { recipe, pose },
  );
  await page
    .locator(`[data-figure="ready"][data-generation="${generation}"]`)
    .waitFor({ timeout: 90_000 });
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 0;
        const tick = () => (++frames >= 6 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
}

interface Counts {
  /** Pixels of the sweater's blue (not skin, not the key colour). */
  blue: number;
  /** Pixels of skin tone. */
  skin: number;
  /** Pixels of anything that is not the key colour. */
  figure: number;
}

/** Classifies the pixels of a horizontal slice of the frame (fractions of its height and width). */
async function count(
  page: Page,
  rows: [number, number],
  columns: [number, number] = [0, 1],
): Promise<Counts> {
  return page.locator("canvas").evaluate(
    (el, [r, c]) => {
      const canvas = el as HTMLCanvasElement;
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
      ctx.drawImage(canvas, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const out = { blue: 0, skin: 0, figure: 0 };
      for (let y = Math.floor(r[0] * canvas.height); y < Math.floor(r[1] * canvas.height); y++)
        for (let x = Math.floor(c[0] * canvas.width); x < Math.floor(c[1] * canvas.width); x++) {
          const i = (y * canvas.width + x) * 4;
          const [R, G, B] = [data[i] as number, data[i + 1] as number, data[i + 2] as number];
          // The key colour is magenta: red and blue high, green low.
          if (R > 200 && B > 200 && G < 90) continue;
          out.figure++;
          if (B > R + 35 && B > G + 15) out.blue++;
          else if (R > B + 25 && R > G + 10 && G > B) out.skin++;
        }
      return out;
    },
    [rows, columns] as const,
  );
}

test.describe("clothing", () => {
  test.use({ viewport: { width: 240, height: 360 } });
  test.setTimeout(budget(240_000));

  test("a sweater covers the torso, follows the arms into a T-pose, and no skin shows through", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await openSilentGame(page, "./", FULL);
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });

    // The chest, between the shoulders: bare, then dressed.
    // Below the neckline (the crew neck shows the neck), above the hem.
    const chest: [number, number] = [0.4, 0.5];
    const middle: [number, number] = [0.4, 0.6];
    await show(page, { macros: { gender: 1 } });
    const bare = await count(page, chest, middle);
    expect(bare.skin).toBeGreaterThan(bare.figure * 0.6);
    expect(bare.blue).toBe(0);

    await show(page, { macros: { gender: 1 }, outfit: [SWEATER] });
    const dressed = await count(page, chest, middle);
    // The sweater is the chest: no skin shows through it.
    expect(dressed.blue).toBeGreaterThan(dressed.figure * 0.9);
    expect(dressed.skin).toBeLessThan(dressed.figure * 0.02);

    // The sleeves go where the arms go: out to the sides in a T-pose, down in a relaxed one.
    const sides = (c: Counts) => c.blue;
    const shoulderRows: [number, number] = [0.27, 0.36];
    const outer: [number, number] = [0, 0.25];
    await show(page, { macros: { gender: 1 }, outfit: [SWEATER] }, { body: "tpose" });
    const tpose = sides(await count(page, shoulderRows, outer));
    await show(page, { macros: { gender: 1 }, outfit: [SWEATER] }, { body: "relaxed" });
    const relaxed = sides(await count(page, shoulderRows, outer));
    expect(tpose).toBeGreaterThan(40);
    expect(tpose).toBeGreaterThan(relaxed * 4);
    expect(errors).toEqual([]);
  });

  test("draws only what nothing covers: the body loses the faces a garment hides, and gets them back", async ({
    page,
  }) => {
    await openSilentGame(page, "./", FULL);
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
    const drawn = () => page.evaluate(() => window.hkDrawn?.() ?? []);
    const body = async () => (await drawn()).find((p) => p.part === "body")?.triangles ?? 0;
    const garment = async (id: string) =>
      (await drawn()).find((p) => p.garment === id)?.triangles ?? 0;

    await show(page, { macros: { gender: 1 } });
    const bare = await body();
    expect(bare).toBeGreaterThan(100_000);
    expect((await drawn()).filter((p) => p.part === "garment")).toEqual([]);

    await show(page, { macros: { gender: 1 }, outfit: [SWEATER] });
    const dressed = await body();
    // The sweater and jeans hide the torso, arms and legs (about a quarter of the
    // faces, the rest being the head, hands and feet and the faces that keep a
    // corner under the cloth's edge), and the garment is drawn.
    expect(dressed).toBeLessThan(bare * 0.85);
    expect(dressed).toBeGreaterThan(bare * 0.5);
    const alone = await garment(SWEATER);
    expect(alone).toBeGreaterThan(5_000);

    // A jacket over it hides part of the sweater (and a little more skin), not the jacket.
    const JACKET = "suits/male_elegantsuit01";
    await show(page, { macros: { gender: 1 }, outfit: [SWEATER, JACKET] });
    expect(await garment(SWEATER)).toBeLessThan(alone);
    expect(await garment(JACKET)).toBeGreaterThan(5_000);

    // Undressed again: the same body, face for face.
    await show(page, { macros: { gender: 1 } });
    expect(await body()).toBe(bare);
    expect((await drawn()).filter((p) => p.part === "garment")).toEqual([]);
  });

  test("changing the outfit keeps the figure on screen and the ground under its shoes", async ({
    page,
  }) => {
    await openSilentGame(page, "./", FULL);
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
    await show(page, { macros: { gender: 1 }, outfit: [SWEATER] });
    const started = Date.now();
    await show(page, { macros: { gender: 1 }, outfit: [SWEATER, SHOES] });
    await show(page, { macros: { gender: 1 }, outfit: [SHOES] });
    await show(page, { macros: { gender: 1 } });
    // Three changes of outfit, each a new evaluation with its masks, well inside a load's budget.
    expect(Date.now() - started).toBeLessThan(budget(30_000));
    const lower = await count(page, [0.55, 0.9]);
    // Undressed again: the legs are skin.
    expect(lower.skin).toBeGreaterThan(lower.figure * 0.6);
    expect(lower.blue).toBe(0);
  });

  test("a visit that does not ask for the clothing pack never fetches it", async ({
    page,
    context,
  }) => {
    const requested: string[] = [];
    context.on("request", (request) => requested.push(request.url()));
    await openSilentGame(page, "./", { view: "front" });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    expect(requested.filter((u) => /garments|clothing/.test(u))).toEqual([]);
  });
});
