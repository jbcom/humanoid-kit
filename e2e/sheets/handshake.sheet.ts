/**
 * Tall/short handshake review sheet. This is an explicit visual-review command,
 * never part of the browser suite:
 *
 *   heavy-slot pnpm exec playwright test e2e/sheets/handshake.sheet.ts --project sheets
 *
 * It opens the playground only through `openSilentGame`, which adds the runtime
 * mute marker. The lab itself rejects an unmuted route, a missing clothing pack,
 * non-adult recipes, an unloaded animation source, and anything other than the
 * live presence registry plus interaction runtime. Each cell shows the yellow
 * shared target and the two RGB hand frames from that live sample.
 *
 * The package does not yet contain an authored handshake clip. The lab samples
 * the packaged `idle1` source on the interaction clock so this sheet exposes
 * the missing pose/IK work to a reviewer rather than placing fabricated arms.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openSilentGame } from "game-harness/playwright";

test.use({ screenshot: "off", video: "off", trace: "off" });

const outDir = process.env.HK_HANDSHAKE_SHEET_OUT;
const stages = ["approach", "grip", "release", "cancel"] as const;
const views = ["front", "three-quarter", "side"] as const;

type Stage = (typeof stages)[number];
type View = (typeof views)[number];

interface LabState {
  stage: Stage;
  view: View;
  phase: string;
  ready: boolean;
  held: boolean;
  mode: "inspect" | "play";
  animationTime: number;
  settled: { tall: boolean; short: boolean };
  animationStarted: { tall: boolean; short: boolean };
  muted: boolean;
  adults: boolean;
  clothed: boolean;
  consent: { tall: true; short: true };
  source: string;
  animation: string;
  target: number[] | null;
  hands: { tall: number[]; short: number[] } | null;
  targetGap: { tall: number; short: number } | null;
  bindingFailure: string | null;
}

const frames = (page: Page, n = 4) =>
  page.evaluate(
    (count) =>
      new Promise<void>((done) => {
        let seen = 0;
        const tick = () => (++seen >= count ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

async function state(page: Page): Promise<LabState> {
  return page.evaluate(() => {
    if (!window.hkHandshake) throw new Error("handshake lab did not mount");
    return window.hkHandshake.state();
  });
}

/** Stops immediately when the lab reports a terminal binding error; never turns it into a blank cell. */
async function waitForReady(page: Page, label: string): Promise<LabState> {
  await page.waitForFunction(
    () => {
      const lab = window.hkHandshake;
      if (!lab) return false;
      const current = lab.state();
      return current.held || current.bindingFailure !== null;
    },
    undefined,
    { timeout: 120_000 },
  );
  const current = await state(page);
  expect(current.bindingFailure, `${label} has no settled-affordance binding failure`).toBeNull();
  expect(current.held, `${label} holds a real runtime state`).toBe(true);
  expect(
    current.ready,
    `${label} source readiness: ${JSON.stringify({
      phase: current.phase,
      held: current.held,
      clothed: current.clothed,
      settled: current.settled,
      animationStarted: current.animationStarted,
      target: current.target !== null,
      hands: current.hands !== null,
    })}`,
  ).toBe(true);
  return current;
}

async function show(page: Page, stage: Stage, view: View): Promise<string> {
  await page.evaluate(
    ({ stage: nextStage, view: nextView }) => {
      const lab = window.hkHandshake;
      if (!lab) throw new Error("handshake lab did not mount");
      lab.setView(nextView);
      lab.setStage(nextStage);
    },
    { stage, view },
  );
  await waitForReady(page, stage);
  await frames(page);
  const checked = await state(page);
  expect(checked.stage).toBe(stage);
  expect(checked.view).toBe(view);
  expect(checked.held, `${stage}/${view} freezes the reached runtime state`).toBe(true);
  expect(checked.phase, `${stage}/${view} reports the actual held phase`).toBe(
    stage === "grip"
      ? "act"
      : stage === "release"
        ? "release"
        : stage === "cancel"
          ? "cancelled"
          : "approach",
  );
  const reviewUrl = new URL(page.url());
  expect(reviewUrl.searchParams.get("stage"), `${stage}/${view} persists a linkable stage`).toBe(
    stage,
  );
  expect(reviewUrl.searchParams.get("view"), `${stage}/${view} persists a linkable view`).toBe(
    view,
  );
  expect(checked.hands, `${stage}/${view} has both live hand frames`).not.toBeNull();
  if (stage === "cancel") {
    expect(checked.target, `${stage}/${view} has no stale target after cancellation`).toBeNull();
    expect(checked.targetGap, `${stage}/${view} has no stale target-to-hand gaps`).toBeNull();
  } else {
    expect(checked.target, `${stage}/${view} has a runtime target`).not.toBeNull();
    expect(checked.targetGap, `${stage}/${view} exposes both target-to-hand gaps`).not.toBeNull();
    expect(Number.isFinite(checked.targetGap?.tall), `${stage}/${view} tall gap is finite`).toBe(
      true,
    );
    expect(Number.isFinite(checked.targetGap?.short), `${stage}/${view} short gap is finite`).toBe(
      true,
    );
  }
  return (await page.locator("canvas").screenshot()).toString("base64");
}

/** Draws stage rows and camera columns into one reviewer-facing sheet. */
async function composite(page: Page, cells: Map<string, string>): Promise<string> {
  return page.evaluate(
    async ({ cells: entries, stages: rows, views: columns }) => {
      const cells = new Map(entries);
      const decode = async (b64: string) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const first = await decode(cells.get(`${rows[0]}/${columns[0]}`) as string);
      const width = first.width;
      const height = first.height;
      const title = 60;
      const label = 34;
      const sheet = document.createElement("canvas");
      sheet.width = width * columns.length + 110;
      sheet.height = title + (height + label) * rows.length;
      const ctx = sheet.getContext("2d");
      if (!ctx) throw new Error("2D canvas is unavailable for handshake sheet");
      ctx.fillStyle = "#15202b";
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 24px system-ui, sans-serif";
      ctx.fillText("Tall / short clothed handshake: target + live hand frames", 16, 36);
      ctx.font = "600 18px system-ui, sans-serif";
      ctx.textAlign = "center";
      for (const [column, view] of columns.entries())
        ctx.fillText(view, 110 + column * width + width / 2, title - 16);
      ctx.textAlign = "right";
      for (const [row, stage] of rows.entries()) {
        const top = title + row * (height + label);
        ctx.fillText(stage, 100, top + height / 2);
        ctx.textAlign = "center";
        for (const [column, view] of columns.entries()) {
          const png = cells.get(`${stage}/${view}`);
          if (!png) throw new Error(`missing ${stage}/${view} cell`);
          ctx.drawImage(await decode(png), 110 + column * width, top);
        }
        ctx.textAlign = "right";
      }
      return sheet.toDataURL("image/png").split(",")[1] as string;
    },
    { cells: [...cells.entries()], stages, views },
  );
}

test("tall/short clothed handshake", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Outdated Optimize Dep"))
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await openSilentGame(
    page,
    "/?scene=handshake&clothing=1&stage=grip&view=side",
    {},
    { markerTimeout: 120_000 },
  );
  await expect(
    page.locator("canvas"),
    "the mounted review route renders its R3F canvas",
  ).toBeVisible();
  await expect(
    page.locator("[data-handshake-error]"),
    "the mounted review route does not fall back to a blank-screen boot error",
  ).toHaveCount(0);
  const source = await waitForReady(page, "initial handshake source");
  expect(source.stage, "the direct review link restores its requested stage").toBe("grip");
  expect(source.view, "the direct review link restores its requested view").toBe("side");
  expect(source.held, "the inspection link holds its actual selected runtime phase").toBe(true);
  expect(source.muted, "the harness supplied the non-persistent mute route").toBe(true);
  expect(source.adults, "both recipe ages are adult").toBe(true);
  expect(source.clothed, "both source garments are drawn").toBe(true);
  expect(source.consent, "both neutral fixture participants explicitly consent").toEqual({
    tall: true,
    short: true,
  });
  await expect(
    page.getByRole("region", { name: "Tall and short handshake diagnostic" }),
  ).toBeVisible();
  expect(source.source, "the lab samples live runtime state").toBe(
    "presence-registry+interaction-runtime+animation-library",
  );
  expect(source.animation, "the installed source clip is present").toBe("idle1");

  const cells = new Map<string, string>();
  for (const stage of stages)
    for (const view of views) cells.set(`${stage}/${view}`, await show(page, stage, view));
  const png = Buffer.from(await composite(page, cells), "base64");
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "tall-short-clothed-handshake.png"), png);
  }
  const output = testInfo.outputPath("tall-short-clothed-handshake.png");
  fs.writeFileSync(output, png);
  await testInfo.attach("tall-short-clothed-handshake", { path: output, contentType: "image/png" });
  expect(errors, "page errors while building the handshake sheet").toEqual([]);
});
