/**
 * Renders a contact sheet of figures for visual review.
 *
 *   node scripts/contact-sheet.mjs <out.png> <query> <recipes.json> [columns] [width] [height]
 *
 * <query> is the playground QA-shot query (e.g. "cam=0,1.5,0.85,0,1.48,0&exp=1.1");
 * <recipes.json> is a JSON array of createRecipe() inputs (or a file holding
 * one); an entry's `$pose` key, if any, poses that figure (a `HumanoidPose`,
 * e.g. {"faceUnits":{"JawDrop":1}}) and its `$signals` key sets its skin state
 * (e.g. {"cold":1}). The playground dev server must be running on HK_PLAYGROUND (default
 * http://localhost:5173). One page renders every recipe in turn, waiting for
 * each figure to be evaluated and drawn, so the sheet never shows a stale or
 * half-loaded figure.
 */
import fs from "node:fs";
import { chromium } from "@playwright/test";

const [
  out,
  query = "view=front",
  recipesArg = "[{}]",
  columns = "5",
  width = "360",
  height = "420",
] = process.argv.slice(2);
if (!out)
  throw new Error(
    "usage: node scripts/contact-sheet.mjs <out.png> <query> <recipes.json> [columns] [w] [h]",
  );
const recipes = JSON.parse(
  fs.existsSync(recipesArg) ? fs.readFileSync(recipesArg, "utf8") : recipesArg,
);
const base = process.env.HK_PLAYGROUND ?? "http://localhost:5173";

const browser = await chromium.launch({ headless: false, args: ["--mute-audio"] });
try {
  const page = await browser.newPage({
    viewport: { width: Number(width), height: Number(height) },
    deviceScaleFactor: Number(process.env.DPR ?? 1),
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}/?muted&${query}`);
  await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
  const shots = [];
  for (const recipe of recipes) {
    const generation = await page.evaluate((r) => {
      const next =
        Number(document.querySelector("[data-generation]")?.getAttribute("data-generation")) + 1;
      const { $pose, $signals, ...init } = r;
      window.hkSetRecipe?.(init, $pose, $signals);
      return next;
    }, recipe);
    await page
      .locator(`[data-figure="ready"][data-generation="${generation}"]`)
      .waitFor({ timeout: 60_000 });
    await page.evaluate(
      () =>
        new Promise((done) => {
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
      const w = images[0].width;
      const h = images[0].height;
      const sheet = document.createElement("canvas");
      sheet.width = w * Math.min(columns, images.length);
      sheet.height = h * Math.ceil(images.length / columns);
      const ctx = sheet.getContext("2d");
      for (const [i, im] of images.entries())
        ctx.drawImage(im, (i % columns) * w, Math.floor(i / columns) * h);
      return sheet.toDataURL("image/png").split(",")[1];
    },
    { shots, columns: Number(columns) },
  );
  fs.writeFileSync(out, Buffer.from(png, "base64"));
  if (errors.length) console.error(`page errors:\n${errors.join("\n")}`);
  console.log(`contact-sheet: ${recipes.length} figures -> ${out}`);
} finally {
  await browser.close();
}
