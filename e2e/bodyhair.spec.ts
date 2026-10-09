/**
 * Body hair in the playground: the coat's shells draw on a real figure, posed
 * and skinned. A man's beard styles each change the face and the fuller ones
 * cover more, his chest hair shows against the same chest shaven, and a child
 * asked for a beard draws none (the model gives a child no terminal hair).
 * Figures are shot against a keyed background and compared with the same
 * figure without, so what is measured is exactly the pixels hair covers.
 */
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";
import { budget } from "./budget.ts";

const FACE = "0.25,1.55,0.55,0,1.5,0";
const CHEST = "0,1.25,0.8,0,1.22,0";
const KEY = "ff00ff";
const MAN = { macros: { age: 35, gender: 1 }, skin: { melanin: 0.2 } };
const BLACK = { eumelanin: 0.9, pheomelanin: 0, grey: 0, override: null };

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

/** How many pixels of `name` differ from `base` (summed channel difference over 24). */
function changed(page: Page, base: string, name: string): Promise<number> {
  return page.evaluate(
    ([a, b]) => {
      const x = window.hkShots?.[a as string] as Uint8ClampedArray;
      const y = window.hkShots?.[b as string] as Uint8ClampedArray;
      let n = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d =
          Math.abs((x[i] as number) - (y[i] as number)) +
          Math.abs((x[i + 1] as number) - (y[i + 1] as number)) +
          Math.abs((x[i + 2] as number) - (y[i + 2] as number));
        if (d > 24) n++;
      }
      return n;
    },
    [base, name],
  );
}

test.describe("body hair in the playground", () => {
  test.use({ viewport: { width: 360, height: 420 } });

  test("beards and chest hair draw on a man, and nothing on a child", async ({ page }) => {
    test.setTimeout(budget(6 * 60_000));
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await openSilentGame(page, "./", { cam: FACE, bg: KEY });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });

    const man = (beard: string) => ({
      ...MAN,
      hair: { style: null, colour: BLACK },
      bodyHair: { beard },
    });
    await shoot(page, "shaven", man("none"));
    await shoot(page, "stubble", man("stubble"));
    await shoot(page, "goatee", man("goatee"));
    await shoot(page, "full", man("full"));
    const stubble = await changed(page, "shaven", "stubble");
    const goatee = await changed(page, "shaven", "goatee");
    const full = await changed(page, "shaven", "full");
    expect(stubble, "stubble draws").toBeGreaterThan(200);
    expect(full, "a full beard covers more than a goatee").toBeGreaterThan(goatee);
    expect(goatee, "a goatee draws").toBeGreaterThan(100);

    // A child asked for a beard has no terminal hair to grow one.
    const child = (beard: string) => ({
      macros: { age: 8, gender: 1 },
      hair: { style: null, colour: BLACK },
      bodyHair: { beard },
    });
    await shoot(page, "child-shaven", child("none"));
    await shoot(page, "child-full", child("full"));
    expect(await changed(page, "child-shaven", "child-full"), "a child grows no beard").toBe(0);

    await openSilentGame(page, "./", { cam: CHEST, bg: KEY });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
    const trunk = (m: number) => ({
      ...MAN,
      hair: { style: null, colour: BLACK },
      bodyHair: { density: { chest: m, abdomen: m } },
    });
    await shoot(page, "bare-chest", trunk(0));
    await shoot(page, "hairy-chest", trunk(1.5));
    expect(await changed(page, "bare-chest", "hairy-chest"), "chest hair draws").toBeGreaterThan(
      500,
    );
    expect(errors).toEqual([]);
  });

  test("records the coat's frame cost", async ({ page }, info) => {
    test.setTimeout(budget(4 * 60_000));
    await openSilentGame(page, "./", { cam: FACE, bg: KEY });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
    /** Mean milliseconds a frame over 120 frames, after the figure is drawn. */
    const frameMs = async (name: string, recipe: Record<string, unknown>) => {
      await shoot(page, name, recipe);
      return page.evaluate(
        () =>
          new Promise<number>((done) => {
            let frames = 0;
            const start = performance.now();
            const tick = () => {
              if (++frames < 120) return requestAnimationFrame(tick);
              done((performance.now() - start) / frames);
            };
            requestAnimationFrame(tick);
          }),
      );
    };
    const none = await frameMs("none", {
      ...MAN,
      bodyHair: { beard: "none", density: { chest: 0, abdomen: 0, back: 0 } },
    });
    const coat = await frameMs("coat", {
      ...MAN,
      bodyHair: { beard: "full", density: { chest: 2, abdomen: 2, back: 2 } },
    });
    // Recorded, not asserted: the browser here may render in software, where the
    // numbers are an upper bound (docs/ARCHITECTURE.md, "The coat", costs).
    info.annotations.push({
      type: "coat-frame-ms",
      description: `none ${none.toFixed(2)}, coat ${coat.toFixed(2)}`,
    });
    console.log(`coat frame cost: without ${none.toFixed(2)} ms, with ${coat.toFixed(2)} ms`);
    expect(coat).toBeGreaterThan(0);
  });
});
