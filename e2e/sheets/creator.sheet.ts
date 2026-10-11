/**
 * Review screenshots of the creator itself, for a change to its panels or stage. Like
 * the figure sheets (`render.sheet.ts`) it runs against the playground's dev server,
 * through the `sheets` project, so on the agents' machines it goes to the render pool:
 *
 *   heavy-slot --remote-render pnpm exec playwright test e2e/sheets/creator.sheet.ts \
 *     --project sheets [-g <scene>]
 *
 * (The file goes first: `--project` takes every name after it.)
 *
 * Each scene writes `<name>.png` to its test output (test-results/), which the pool
 * returns. Figures are always clothed here: the scenes wear a suit, and none loads the
 * adult pack. A scene waits for the figure to be drawn before it shoots, and the page
 * erring while it does fails the scene.
 */
import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";

interface Scene {
  name: string;
  /** What a host sets on the creator's root, as it would from its own stylesheet. */
  theme?: Record<string, string>;
  /** What a person does once the creator is up. */
  steps?: (page: Page) => Promise<void>;
  width?: number;
  height?: number;
}

const FIGURE = {
  macros: { age: 30, gender: 0.15 },
  outfit: ["suits/female_casualsuit01"],
  hair: { style: "long01" },
};
const QUERY = `clothing&recipe=${encodeURIComponent(JSON.stringify(FIGURE))}`;

/** Two animation frames, so what is on the canvas is what was last drawn. */
const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
  );

const SCENES: Scene[] = [
  {
    name: "creator-eyes",
    // The Eye texture choice, with a slit-pupil material worn, framed on the face.
    steps: async (page) => {
      await page.getByRole("tab", { name: /^Skin, eyes/ }).click();
      await page
        .getByRole("group", { name: "Slit pupil", exact: true })
        .getByRole("button", { name: "Green", exact: true })
        .click();
      // The camera glides to the face, and the texture loads.
      await page.waitForTimeout(3000);
    },
  },
  {
    name: "creator-themed",
    // A host's own stage colour: the canvas follows `--hk-bg` rather than painting its own.
    theme: { "--hk-bg": "#3b2a55" },
    steps: async (page) => {
      await page.getByRole("tab", { name: "Main" }).click();
      await page.waitForTimeout(2500);
    },
  },
];

// One page at a time: the first compiles the playground on the dev server, and a second
// page opened beside it meets the half-built server and fails its wait for the page.
test.describe.configure({ mode: "serial" });

for (const scene of SCENES) {
  test(scene.name, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scene.width ?? 1280, height: scene.height ?? 800 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    // The dev server compiles the playground on its first page: the mute marker waits for it.
    await openSilentGame(page, `/?${QUERY}`, {}, { markerTimeout: 120_000 });
    // Vite optimises the playground's dependencies on a first visit and answers requests it
    // made meanwhile with a 504. That visit only warms the server: the scene is the next.
    await page.locator('.hk-stage[data-pick="ready"]').waitFor({ timeout: 300_000 });
    await page.reload();
    errors.length = 0;
    await page.locator('.hk-stage[data-pick="ready"]').waitFor({ timeout: 300_000 });
    await expect(page.locator(".hk-status")).toHaveCount(0, { timeout: 300_000 });
    if (scene.theme)
      await page.evaluate((theme) => {
        const root = document.querySelector<HTMLElement>(".hk-creator");
        if (!root) throw new Error("no creator");
        for (const [name, value] of Object.entries(theme)) root.style.setProperty(name, value);
      }, scene.theme);
    await scene.steps?.(page);
    await frames(page);
    const out = testInfo.outputPath(`${scene.name}.png`);
    fs.writeFileSync(out, await page.locator(".hk-creator").screenshot());
    await testInfo.attach(scene.name, { path: out, contentType: "image/png" });
    expect(errors, `page errors while drawing ${scene.name}`).toEqual([]);
  });
}
