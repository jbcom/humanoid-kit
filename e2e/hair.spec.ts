/**
 * Hair in the playground: every style draws, every colour reads as its place on
 * the scale from black to white at both ends of the skin range, and the
 * creator's controls change what is drawn. Figures are shot against a keyed
 * background and compared with the same figure bald, so what is measured is
 * exactly the pixels hair covers.
 */
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { budget } from "./budget.ts";

const STYLES = [
  "short02",
  "bob02",
  "long01",
  "afro01",
  "short04",
  "short03",
  "ponytail01",
  "short01",
  "bob01",
  "braid01",
];
// Black to white, in the order lightness should rise (the reds sit with the browns).
const COLOURS = {
  black: { eumelanin: 0.9, pheomelanin: 0, grey: 0, override: null },
  "dark-brown": { eumelanin: 0.62, pheomelanin: 0.05, grey: 0, override: null },
  brown: { eumelanin: 0.5, pheomelanin: 0.15, grey: 0, override: null },
  "light-brown": { eumelanin: 0.42, pheomelanin: 0.05, grey: 0, override: null },
  blonde: { eumelanin: 0.22, pheomelanin: 0.2, grey: 0, override: null },
  "light-blonde": { eumelanin: 0.14, pheomelanin: 0.12, grey: 0, override: null },
  platinum: { eumelanin: 0.08, pheomelanin: 0.03, grey: 0, override: null },
  white: { eumelanin: 0, pheomelanin: 0, grey: 0, override: null },
};
const EXTRA = {
  auburn: { eumelanin: 0.3, pheomelanin: 0.5, grey: 0, override: null },
  red: { eumelanin: 0.1, pheomelanin: 0.55, grey: 0, override: null },
  ginger: { eumelanin: 0.02, pheomelanin: 0.45, grey: 0, override: null },
  grey: { eumelanin: 0.62, pheomelanin: 0.05, grey: 0.6, override: null },
};
const CAMERA = "0.4,1.6,0.8,0,1.54,0";
const KEY = "ff00ff";

declare global {
  interface Window {
    hkShots?: Record<string, Uint8ClampedArray>;
  }
}

/** Sets the recipe, waits for the figure to be drawn, and keeps its pixels under `name`. */
async function shoot(page: Page, name: string, init: Record<string, unknown>): Promise<void> {
  const generation = await page.evaluate((recipe) => {
    const set = window.hkSetRecipe;
    if (!set) throw new Error("the QA shot is not mounted");
    const next =
      Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
    set(recipe);
    return next;
  }, init);
  await page
    .locator(`[data-figure="ready"][data-generation="${generation}"]`)
    .waitFor({ timeout: 90_000 });
  // Hair evaluates with the figure, but its strand map streams in after: let it land.
  await page.waitForTimeout(400);
  await page.evaluate(
    (key) =>
      new Promise<void>((done) => {
        let frames = 0;
        const tick = () => {
          if (++frames < 6) return requestAnimationFrame(tick);
          const c = document.querySelector("canvas") as HTMLCanvasElement;
          const copy = document.createElement("canvas");
          copy.width = c.width;
          copy.height = c.height;
          const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
          ctx.drawImage(c, 0, 0);
          window.hkShots ??= {};
          window.hkShots[key] = ctx.getImageData(0, 0, c.width, c.height).data;
          done();
        };
        requestAnimationFrame(tick);
      }),
    name,
  );
}

/**
 * How `name` differs from `base`: the pixels that changed (sum of channel
 * differences over 24) and the mean display luminance (0..255) of the changed
 * pixels in `name`.
 */
function compare(page: Page, base: string, name: string) {
  return page.evaluate(
    ([a, b]) => {
      const x = window.hkShots?.[a as string] as Uint8ClampedArray;
      const y = window.hkShots?.[b as string] as Uint8ClampedArray;
      let changed = 0;
      let luma = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d =
          Math.abs((x[i] as number) - (y[i] as number)) +
          Math.abs((x[i + 1] as number) - (y[i + 1] as number)) +
          Math.abs((x[i + 2] as number) - (y[i + 2] as number));
        if (d <= 24) continue;
        changed++;
        luma +=
          0.2126 * (y[i] as number) + 0.7152 * (y[i + 1] as number) + 0.0722 * (y[i + 2] as number);
      }
      return { changed, luma: changed ? luma / changed : 0 };
    },
    [base, name],
  );
}

test.describe("hair in the playground", () => {
  test.use({ viewport: { width: 360, height: 420 } });

  test("every style draws, and every colour lands where it belongs from black to white", async ({
    page,
  }) => {
    test.setTimeout(budget(10 * 60_000));
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await openSilentGame(page, "./", { cam: CAMERA, bg: KEY });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });

    await shoot(page, "bald", {});
    const brown = COLOURS.brown;
    for (const style of STYLES) {
      await shoot(page, style, { hair: { style, colour: brown } });
      const { changed } = await compare(page, "bald", style);
      // The head fills a few thousand pixels of this frame; any style covers many of them.
      expect(changed, `${style} draws`).toBeGreaterThan(1500);
    }

    // The same style in each colour: the pixels hair covers get lighter as the colour does.
    let previous = 0;
    for (const [name, colour] of Object.entries(COLOURS)) {
      await shoot(page, `long01 ${name}`, { hair: { style: "long01", colour } });
      const { changed, luma } = await compare(page, "bald", `long01 ${name}`);
      expect(changed, `${name} is drawn`).toBeGreaterThan(3000);
      expect(luma, `${name} is lighter than the colour before it`).toBeGreaterThan(previous);
      previous = luma;
    }
    // Black hair is dark and white hair light on screen, after lighting and tone mapping.
    await shoot(page, "black", { hair: { style: "long01", colour: COLOURS.black } });
    await shoot(page, "white", { hair: { style: "long01", colour: COLOURS.white } });
    expect((await compare(page, "bald", "black")).luma).toBeLessThan(60);
    expect((await compare(page, "bald", "white")).luma).toBeGreaterThan(170);
    expect(errors).toEqual([]);
  });

  test("hair is told from the skin at both ends of the tone range, in every natural colour", async ({
    page,
  }) => {
    test.setTimeout(budget(10 * 60_000));
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await openSilentGame(page, "./", { cam: CAMERA, bg: KEY });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });

    for (const melanin of [0, 1]) {
      await shoot(page, `bald ${melanin}`, { skin: { melanin } });
      for (const [name, colour] of Object.entries({ ...COLOURS, ...EXTRA })) {
        await shoot(page, `${name} ${melanin}`, {
          skin: { melanin },
          hair: { style: "bob02", colour },
        });
        const { changed } = await compare(page, `bald ${melanin}`, `${name} ${melanin}`);
        expect(changed, `${name} hair on skin tone ${melanin}`).toBeGreaterThan(1500);
      }
    }
    expect(errors).toEqual([]);
  });
});

test.describe("hair in the creator", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("choosing a style and a colour changes the figure, and undo changes it back", async ({
    page,
  }) => {
    test.setTimeout(budget(180_000));
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await openSilentGame(page, "./");
    await page.locator('.hk-stage[data-pick="ready"]').waitFor({ timeout: 120_000 });
    await page.getByRole("tab", { name: "Skin, eyes & hair" }).click();

    const pixels = () =>
      page.evaluate(() => {
        const c = document.querySelector(".hk-stage canvas") as HTMLCanvasElement;
        const copy = document.createElement("canvas");
        copy.width = 96;
        copy.height = 96;
        const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(c, 0, 0, 96, 96);
        return Array.from(ctx.getImageData(0, 0, 96, 96).data);
      });
    const difference = (a: number[], b: number[]) =>
      a.reduce((s, v, i) => s + Math.abs(v - (b[i] as number)), 0) / a.length;
    const settle = () => page.waitForTimeout(2500);

    // Any choice of hair frames the head, so the baseline is taken once it has.
    await page.getByRole("button", { name: "None" }).click();
    await settle();
    const bald = await pixels();
    await page.getByRole("button", { name: "Long, straight" }).click();
    await settle();
    const haired = await pixels();
    expect(difference(bald, haired)).toBeGreaterThan(2);
    await expect(page.getByRole("button", { name: "Long, straight" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "Platinum hair" }).click();
    await settle();
    const platinum = await pixels();
    expect(difference(haired, platinum)).toBeGreaterThan(2);

    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await settle();
    expect(difference(bald, await pixels())).toBeLessThan(1);
    expect(errors).toEqual([]);
  });

  test("a random figure can wear hair from the pack", async ({ page }) => {
    test.setTimeout(budget(180_000));
    await openSilentGame(page, "./");
    await page.locator('.hk-stage[data-pick="ready"]').waitFor({ timeout: 120_000 });
    await page.getByRole("tab", { name: "Main" }).click();
    // Seeds are random per click; some figure of the first several wears a style.
    let styled = false;
    for (let i = 0; i < 6 && !styled; i++) {
      await page.getByRole("button", { name: "Random figure" }).click();
      await page.waitForTimeout(800);
      await page.getByRole("tab", { name: "Skin, eyes & hair" }).click();
      styled = (await page.locator('.hk-chip[aria-pressed="true"]').first().innerText()) !== "None";
      await page.getByRole("tab", { name: "Main" }).click();
    }
    expect(styled).toBe(true);
  });
});
