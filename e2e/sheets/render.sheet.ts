/**
 * Contact sheets for visual review, rendered by Playwright so the render pool
 * runs them like any browser job:
 *
 *   heavy-slot --remote-render pnpm exec playwright test --project sheets [-g <sheet>]
 *
 * The job is one JSON file, `.sheets/job.json` (gitignored; `HK_SHEETS_JOB` names
 * another for a local run, the pool forwarding no environment):
 *
 *   { "sheets": [{ "name": "groin-seated-below",
 *                  "query": "adult&pose=seated&cam=0,0.55,0.35,0,0.8,0.05&span=0.3",
 *                  "recipes": [{ "macros": { "age": 30, "gender": 1 } }],
 *                  "columns": 4, "width": 420, "height": 420 }] }
 *
 * `query` is the playground's QA-shot query (`?adult` loads the adult pack, which
 * only the dev server the `sheets` project starts can do). `recipes` is an array of
 * createRecipe inputs or a repository path to a JSON file of one; an entry's `$pose`
 * key poses that figure (a `HumanoidPose`) and its `$signals` key sets its skin state.
 * Each sheet is one test, named by its sheet, so `-g` picks sheets; each writes
 * `<name>.png` to its test output (test-results/), which the pool returns. The page
 * renders every recipe in turn and waits for each figure to be evaluated and drawn,
 * so a sheet never shows a stale or half-loaded figure.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";

interface Sheet {
  name: string;
  query: string;
  recipes: Record<string, unknown>[] | string;
  columns?: number;
  width?: number;
  height?: number;
}

const root = path.resolve(import.meta.dirname, "../..");
const jobFile = path.resolve(root, process.env.HK_SHEETS_JOB ?? ".sheets/job.json");
if (!fs.existsSync(jobFile))
  throw new Error(`no sheets job at ${jobFile}: write one (e2e/sheets/render.sheet.ts says how)`);
const job = JSON.parse(fs.readFileSync(jobFile, "utf8")) as { sheets: Sheet[] };
const names = job.sheets.map((s) => s.name);
if (new Set(names).size !== names.length) throw new Error(`sheet names repeat in ${jobFile}`);

const recipesOf = (sheet: Sheet): Record<string, unknown>[] =>
  typeof sheet.recipes === "string"
    ? JSON.parse(fs.readFileSync(path.resolve(root, sheet.recipes), "utf8"))
    : sheet.recipes;

for (const sheet of job.sheets) {
  test(sheet.name, async ({ page }, testInfo) => {
    const recipes = recipesOf(sheet);
    const columns = sheet.columns ?? 5;
    await page.setViewportSize({ width: sheet.width ?? 360, height: sheet.height ?? 420 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    // The dev server compiles the playground on its first page: the mute marker waits for it.
    await openSilentGame(page, `/?${sheet.query}`, {}, { markerTimeout: 120_000 });
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 300_000 });
    const shots: string[] = [];
    for (const recipe of recipes) {
      const generation = await page.evaluate((r) => {
        const set = window.hkSetRecipe;
        if (!set) throw new Error("the QA shot is not mounted");
        const next =
          Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
        const { $pose, $signals, ...init } = r as Record<string, unknown>;
        set(init as never, $pose as never, $signals as never);
        return next;
      }, recipe);
      await page
        .locator(`[data-figure="ready"][data-generation="${generation}"]`)
        .waitFor({ timeout: 300_000 });
      // A few frames, so the figure drawn is the one evaluated.
      await page.evaluate(
        () =>
          new Promise<void>((done) => {
            let n = 0;
            const tick = () => (++n >= 4 ? done() : requestAnimationFrame(tick));
            requestAnimationFrame(tick);
          }),
      );
      shots.push((await page.locator("canvas").screenshot()).toString("base64"));
    }
    const png = await page.evaluate(
      async ({ shots, columns }) => {
        const images = await Promise.all(
          shots.map(async (b64) =>
            createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()),
          ),
        );
        const first = images[0] as ImageBitmap;
        const w = first.width;
        const h = first.height;
        const sheetCanvas = document.createElement("canvas");
        sheetCanvas.width = w * Math.min(columns, images.length);
        sheetCanvas.height = h * Math.ceil(images.length / columns);
        const ctx = sheetCanvas.getContext("2d") as CanvasRenderingContext2D;
        // Cells to spare in the last row take the stage's background, read from a
        // corner of the first shot, not the canvas default.
        const probe = new OffscreenCanvas(1, 1).getContext(
          "2d",
        ) as OffscreenCanvasRenderingContext2D;
        probe.drawImage(first, 2, 2, 1, 1, 0, 0, 1, 1);
        const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
        for (const [i, im] of images.entries())
          ctx.drawImage(im, (i % columns) * w, Math.floor(i / columns) * h);
        return sheetCanvas.toDataURL("image/png").split(",")[1] as string;
      },
      { shots, columns },
    );
    const out = testInfo.outputPath(`${sheet.name}.png`);
    fs.writeFileSync(out, Buffer.from(png, "base64"));
    await testInfo.attach(sheet.name, { path: out, contentType: "image/png" });
    // The sheet is written either way; a page that erred while drawing it is not to be trusted.
    expect(errors, `page errors while drawing ${sheet.name}`).toEqual([]);
  });
}
