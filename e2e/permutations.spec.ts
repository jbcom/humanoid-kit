/**
 * Figure permutations: ages, genders, builds and tones, each rendered in the
 * QA shot. Every figure must render without errors and fill a plausible part
 * of the frame for its age. With HK_EVIDENCE=1 the renders are also composed
 * into one contact sheet, docs/evidence/figures.webp, the milestone's visual
 * record.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

interface Permutation {
  label: string;
  init: Record<string, unknown>;
}

const AGES = [3, 9, 14, 25, 50, 85];
const GENDERS = [0, 0.5, 1];
const BUILDS: Permutation[] = [
  { label: "lean", init: { macros: { muscle: 0.2, weight: 0.15 } } },
  { label: "muscular", init: { macros: { muscle: 1, weight: 0.5 } } },
  { label: "heavy", init: { macros: { muscle: 0.4, weight: 1 } } },
  { label: "tall", init: { macros: { height: 1 } } },
  { label: "short", init: { macros: { height: 0 } } },
];
const TONES = [0, 0.33, 0.66, 1];

const merge = (a: Record<string, unknown>, b: Record<string, unknown>) => ({
  ...a,
  ...b,
  macros: { ...(a.macros as object), ...(b.macros as object) },
});

const PERMUTATIONS: Permutation[] = [
  ...AGES.flatMap((age, i) =>
    GENDERS.map((gender) => ({
      label: `age ${age}, gender ${gender}`,
      init: { macros: { age, gender }, skin: { melanin: TONES[i % TONES.length] } },
    })),
  ),
  ...BUILDS.flatMap((b, i) =>
    [0, 1].map((gender) => ({
      label: `${b.label}, gender ${gender}`,
      init: merge(b.init, {
        macros: { gender, age: 32 },
        skin: { melanin: TONES[(i + gender) % TONES.length] },
      }),
    })),
  ),
];

const BACKGROUND = [0xff, 0x00, 0xff];
/** Fits MakeHuman's full height range: its max-height target makes a 2.48 m man. */
const CAMERA = "0,1.15,5.4,0,1.15,0";

async function show(page: Page, init: Record<string, unknown>): Promise<void> {
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
    .waitFor({ timeout: 60_000 });
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 0;
        const tick = () => (++frames >= 4 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
  );
}

/** Fraction of the frame the figure covers, and its top and bottom rows (0..1). */
async function coverage(page: Page) {
  return page.locator("canvas").evaluate((el, bg) => {
    const c = el as HTMLCanvasElement;
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    const ctx = copy.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(c, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let covered = 0;
    let top = c.height;
    let bottom = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const d =
          Math.abs((data[i] as number) - (bg[0] as number)) +
          Math.abs((data[i + 1] as number) - (bg[1] as number)) +
          Math.abs((data[i + 2] as number) - (bg[2] as number));
        if (d > 30) {
          covered++;
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    return {
      fraction: covered / (c.width * c.height),
      top: top / c.height,
      bottom: bottom / c.height,
    };
  }, BACKGROUND);
}

test.describe("figure permutations", () => {
  test.use({ viewport: { width: 240, height: 420 } });
  test.setTimeout(15 * 60_000);

  test("every age, gender, build and tone renders cleanly", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    // Far enough back for the tallest figure; magenta keys the background exactly.
    await page.goto(`/?muted&cam=${CAMERA}&bg=ff00ff`);
    await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });

    for (const p of PERMUTATIONS) {
      await show(page, p.init);
      const c = await coverage(page);
      // Feet stand on the floor near the bottom of the frame; the head is lower for children.
      // A three-year-old at this distance covers about 2.7% of the frame.
      expect(c.fraction, `${p.label}: figure visible`).toBeGreaterThan(0.015);
      expect(c.bottom, `${p.label}: feet in frame`).toBeGreaterThan(0.7);
      expect(c.top, `${p.label}: head in frame`).toBeGreaterThan(0.02);
    }
    expect(errors).toEqual([]);

    if (process.env.HK_EVIDENCE) {
      // The record is shot on the studio's own background, not the test key.
      await page.goto(`/?muted&cam=${CAMERA}`);
      await page.locator('[data-figure="ready"]').waitFor({ timeout: 120_000 });
      const shots: { label: string; png: Buffer }[] = [];
      for (const p of PERMUTATIONS) {
        await show(page, p.init);
        shots.push({ label: p.label, png: await page.locator("canvas").screenshot() });
      }
      // Compose the contact sheet in the page, where the images can be drawn.
      const columns = 6;
      const webp = await page.evaluate(
        async ({ images, columns }) => {
          const bitmaps = await Promise.all(
            images.map(async (b64) =>
              createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()),
            ),
          );
          const w = bitmaps[0]?.width ?? 1;
          const h = bitmaps[0]?.height ?? 1;
          const sheet = document.createElement("canvas");
          sheet.width = w * columns;
          sheet.height = h * Math.ceil(bitmaps.length / columns);
          const ctx = sheet.getContext("2d") as CanvasRenderingContext2D;
          ctx.fillStyle = "#1b2530";
          ctx.fillRect(0, 0, sheet.width, sheet.height);
          bitmaps.forEach((b, i) => {
            ctx.drawImage(b, (i % columns) * w, Math.floor(i / columns) * h);
          });
          return sheet.toDataURL("image/webp", 0.82).split(",")[1] as string;
        },
        { images: shots.map((s) => s.png.toString("base64")), columns },
      );
      const out = path.resolve(import.meta.dirname, "../docs/evidence/figures.webp");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(webp, "base64"));
      fs.writeFileSync(
        out.replace(/\.webp$/, ".md"),
        `# Figure permutations\n\n![Figure permutations](./figures.webp)\n\nLeft to right, top to bottom:\n\n${shots
          .map((s, i) => `${i + 1}. ${s.label}`)
          .join("\n")}\n`,
      );
    }
  });
});
